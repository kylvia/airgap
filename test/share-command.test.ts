import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "../src/i18n/index.js";
import { extractLangArg } from "../src/cli.js";

interface LifecycleServer {
  url: string;
  closed: Promise<void>;
  close(): Promise<void>;
}

const cliLifecycle = vi.hoisted(() => ({ server: undefined as LifecycleServer | undefined }));

vi.mock("../src/discovery.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/discovery.js")>();
  return {
    ...actual,
    discoverSessions: vi.fn(async () => [
      {
        source: "claude" as const,
        id: "cli-lifecycle-session",
        file: "/tmp/cli-lifecycle-session.jsonl",
        cwd: null,
        project: "cli-lifecycle",
        mtimeMs: 1,
        sizeBytes: 0,
        sidecars: { subagents: [], toolResults: [] },
      },
    ]),
  };
});

vi.mock("../src/server/share-server.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/server/share-server.js")>();
  return {
    ...actual,
    startShareServer: async (...args: Parameters<typeof actual.startShareServer>) => {
      const server = await actual.startShareServer(...args);
      cliLifecycle.server = server as LifecycleServer;
      return server;
    },
  };
});

const { runShare, shareLanguageOptions, shareStartupLines } = await import("../src/commands/share.js");

const root = fileURLToPath(new URL("../", import.meta.url));
const shareModuleUrl = new URL("../src/commands/share.ts", import.meta.url).href;
const tsxCli = createRequire(import.meta.url).resolve("tsx/cli");
const indexFile = path.join(root, "src/index.ts");

afterEach(async () => {
  await cliLifecycle.server?.close();
  cliLifecycle.server = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("share command", () => {
  it("extracts global language options before Commander builds localized help", () => {
    expect(extractLangArg(["share", "--lang", "zh-CN"])).toBe("zh-CN");
    expect(extractLangArg(["--lang=en", "share"])).toBe("en");
    expect(extractLangArg(["share"])).toBeUndefined();
  });

  it("renders startup guidance in the resolved language", () => {
    expect(shareStartupLines(createI18n("en"), true, "http://127.0.0.1:1/").join("\n")).toContain(
      "Select turns",
    );
    expect(shareStartupLines(createI18n("zh-CN"), false, "http://127.0.0.1:1/").join("\n")).toContain(
      "勾选轮次",
    );
  });

  it("passes the resolved locale and its preference source into Share", () => {
    expect(
      shareLanguageOptions({
        locale: "zh-CN",
        source: "macOS AppleLanguages",
        detectedLocale: "zh-Hans-CN",
      }),
    ).toEqual({ locale: "zh-CN", languagePreference: "auto" });
    expect(
      shareLanguageOptions({ locale: "en", source: "AIRGAP_LANG", detectedLocale: "en" }),
    ).toEqual({ locale: "en", languagePreference: "en" });
  });

  it("localizes the real Commander share help", () => {
    const result = spawnSync(process.execPath, [tsxCli, indexFile, "--lang", "zh-CN", "share", "--help"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("用法：");
    expect(result.stdout).toContain("选项：");
    expect(result.stdout).toContain("打开本地网页");
    expect(result.stdout).not.toContain("Open a local web UI");
  });

  it("keeps running when the browser launcher emits an asynchronous error", () => {
    const script = [
      "(async () => {",
      `  const { openBrowser } = await import(${JSON.stringify(shareModuleUrl)});`,
      '  openBrowser("http://127.0.0.1:43210/");',
      "  await new Promise((resolve) => setTimeout(resolve, 100));",
      "})().catch((error) => {",
      "  console.error(error);",
      "  process.exitCode = 1;",
      "});",
    ].join("\n");
    const result = spawnSync(
      process.execPath,
      [tsxCli, "--eval", script],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: path.join(root, ".missing-browser-launcher-bin"),
        },
      },
    );

    const failure = [result.error?.message, result.stderr].filter(Boolean).join("\n");
    expect(result.status, failure).toBe(0);
  });

  it("keeps the default ten-minute idle shutdown on the CLI path", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    vi.spyOn(console, "log").mockImplementation(() => {});

    await runShare({ open: false });
    expect(cliLifecycle.server).toBeDefined();

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000 - 1);
    expect(exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(exit).not.toHaveBeenCalled();
    await expect(cliLifecycle.server?.closed).resolves.toBeUndefined();
  });
});
