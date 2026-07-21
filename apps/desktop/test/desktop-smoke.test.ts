import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { build } from "tsup";
import { readDesktopSmokeConfig } from "../src/smoke.js";

const shouldRun = process.platform === "darwin" &&
  process.arch === "arm64" &&
  process.env["AIRGAP_RUN_ELECTRON_SMOKE"] === "1";
const smokeTest = shouldRun ? test : test.skip;
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe("desktop smoke gate", () => {
  test("ignores every smoke variable in packaged builds", () => {
    expect(readDesktopSmokeConfig({
      isPackaged: true,
      env: {
        AIRGAP_DESKTOP_SMOKE: "1",
        AIRGAP_DESKTOP_SMOKE_RESULT: "/tmp/result.json",
        AIRGAP_DESKTOP_SMOKE_USER_DATA: "/tmp/user-data",
      },
    })).toBeNull();
  });

  test("requires the exact gate and absolute paths in development", () => {
    expect(readDesktopSmokeConfig({
      isPackaged: false,
      env: {
        AIRGAP_DESKTOP_SMOKE: "true",
        AIRGAP_DESKTOP_SMOKE_RESULT: "/tmp/result.json",
        AIRGAP_DESKTOP_SMOKE_USER_DATA: "/tmp/user-data",
      },
    })).toBeNull();

    expect(() => readDesktopSmokeConfig({
      isPackaged: false,
      env: {
        AIRGAP_DESKTOP_SMOKE: "1",
        AIRGAP_DESKTOP_SMOKE_RESULT: "result.json",
        AIRGAP_DESKTOP_SMOKE_USER_DATA: "/tmp/user-data",
      },
    })).toThrow(/absolute paths/);

    expect(readDesktopSmokeConfig({
      isPackaged: false,
      env: {
        AIRGAP_DESKTOP_SMOKE: "1",
        AIRGAP_DESKTOP_SMOKE_RESULT: "/tmp/result.json",
        AIRGAP_DESKTOP_SMOKE_USER_DATA: "/tmp/user-data",
        AIRGAP_DESKTOP_SMOKE_CHILD: "1",
      },
    })).toEqual({
      resultPath: "/tmp/result.json",
      userDataPath: "/tmp/user-data",
      isSecondLaunch: true,
    });
  });
});

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Electron desktop smoke timed out"));
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

async function createFixtureHome(root: string): Promise<void> {
  const fixtureDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
  const claudeDirectory = path.join(root, ".claude", "projects", "-Users-smoke-claude-project");
  const codexDirectory = path.join(root, ".codex", "sessions", "2026", "07", "20");
  await Promise.all([
    mkdir(claudeDirectory, { recursive: true }),
    mkdir(codexDirectory, { recursive: true }),
  ]);
  await Promise.all([
    copyFile(
      path.join(fixtureDirectory, "claude-project.jsonl"),
      path.join(claudeDirectory, "11111111-1111-4111-8111-111111111111.jsonl"),
    ),
    copyFile(
      path.join(fixtureDirectory, "codex-session.jsonl"),
      path.join(
        codexDirectory,
        "rollout-2026-07-20T09-00-00-22222222-2222-4222-8222-222222222222.jsonl",
      ),
    ),
  ]);
}

smokeTest("runs the real secure Share window from discovery through shutdown", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "airgap-desktop-smoke-"));
  temporaryDirectories.push(temporaryDirectory);
  const homePath = path.join(temporaryDirectory, "home");
  const userDataPath = path.join(temporaryDirectory, "user-data");
  const resultPath = path.join(temporaryDirectory, "result.json");
  await createFixtureHome(homePath);
  await mkdir(userDataPath, { recursive: true });

  const mainPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/main.ts");
  await build({
    entry: { main: mainPath },
    outDir: temporaryDirectory,
    format: ["cjs"],
    platform: "node",
    target: "node22",
    external: ["electron"],
    clean: false,
    silent: true,
  });

  const require = createRequire(import.meta.url);
  const electronPath = require("electron") as string;
  const child = spawn(electronPath, [path.join(temporaryDirectory, "main.cjs")], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      HOME: homePath,
      AIRGAP_DESKTOP_SMOKE: "1",
      AIRGAP_DESKTOP_SMOKE_RESULT: resultPath,
      AIRGAP_DESKTOP_SMOKE_USER_DATA: userDataPath,
      ELECTRON_ENABLE_LOGGING: "0",
    },
  });

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr?.on("data", (chunk) => { stderr += String(chunk); });

  let exitCode: number | null = null;
  try {
    exitCode = await waitForExit(child, 30_000);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }

  const result = JSON.parse(await readFile(resultPath, "utf8")) as Record<string, unknown>;
  const originMatch = /^AIRGAP_SMOKE_ORIGIN=(http:\/\/127\.0\.0\.1:\d+)$/m.exec(stdout);
  expect(exitCode, stderr).toBe(0);
  expect(originMatch?.[1]).toBeTruthy();
  expect(result).toMatchObject({
    ok: true,
    authenticatedRedirect: true,
    nodeGlobalsAbsent: true,
    sessionsDiscovered: true,
    settingsDialogOpened: true,
    settingsBackdropInputSent: true,
    settingsDialogClosed: true,
    settingsInteractionSettled: true,
    settingsFocusRestored: true,
    conversationChanged: true,
    turnSelected: true,
    rawIdsHidden: true,
    secondInstanceObserved: true,
    secondLaunchExited: true,
  });
  expect(result["appVersion"]).toMatch(/^\d+\.\d+\.\d+/);
  expect(result["textClipboardBytes"]).toEqual(expect.any(Number));
  expect(result["imageClipboardBytes"]).toEqual(expect.any(Number));
  expect(result["textClipboardBytes"]).toBeGreaterThan(0);
  expect(result["imageClipboardBytes"]).toBeGreaterThan(8);
  expect(result["lifecycleEvents"]).toEqual([
    "ready",
    "authenticated",
    "settings-dialog",
    "conversation-selected",
    "turn-selected",
    "text-exported",
    "image-exported",
    "second-instance",
    "second-launch-exited",
    "result-written",
    "window-close-requested",
  ]);
  expect(Object.keys(result).sort()).toEqual([
    "appVersion",
    "authenticatedRedirect",
    "conversationChanged",
    "imageClipboardBytes",
    "lifecycleEvents",
    "nodeGlobalsAbsent",
    "ok",
    "rawIdsHidden",
    "secondInstanceObserved",
    "secondLaunchExited",
    "sessionsDiscovered",
    "settingsBackdropInputSent",
    "settingsDialogClosed",
    "settingsDialogOpened",
    "settingsInteractionSettled",
    "settingsFocusRestored",
    "textClipboardBytes",
    "turnSelected",
  ].sort());

  const origin = originMatch![1]!;
  await expect(fetch(origin, { signal: AbortSignal.timeout(2_000) })).rejects.toThrow();
}, 40_000);
