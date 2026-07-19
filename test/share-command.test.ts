import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createI18n } from "../src/i18n/index.js";
import { extractLangArg } from "../src/cli.js";
import { shareStartupLines } from "../src/commands/share.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const shareModuleUrl = new URL("../src/commands/share.ts", import.meta.url).href;
const tsxCli = createRequire(import.meta.url).resolve("tsx/cli");

describe("share command", () => {
  it("extracts global language options before Commander builds localized help", () => {
    expect(extractLangArg(["share", "--lang", "zh-CN"])).toBe("zh-CN");
    expect(extractLangArg(["--lang=en", "share"])).toBe("en");
    expect(extractLangArg(["share"])).toBeUndefined();
  });

  it("renders startup guidance in the resolved language", () => {
    expect(shareStartupLines(createI18n("en"), true, "http://localhost:1/").join("\n")).toContain(
      "Select turns",
    );
    expect(shareStartupLines(createI18n("zh-CN"), false, "http://localhost:1/").join("\n")).toContain(
      "勾选轮次",
    );
  });

  it("keeps running when the browser launcher emits an asynchronous error", () => {
    const script = [
      "(async () => {",
      `  const { openBrowser } = await import(${JSON.stringify(shareModuleUrl)});`,
      '  openBrowser("http://localhost:43210/");',
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
});
