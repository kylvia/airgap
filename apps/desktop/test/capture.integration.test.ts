import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";
import { build } from "tsup";

const shouldRun = process.platform === "darwin" &&
  process.arch === "arm64" &&
  process.env["AIRGAP_RUN_ELECTRON_INTEGRATION"] === "1";
const integrationTest = shouldRun ? test : test.skip;
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

function waitForExit(child: ReturnType<typeof spawn>, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Electron capture integration timed out"));
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

integrationTest("captures a long 900px PNG with its bottom marker on Apple Silicon", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "airgap-capture-integration-"));
  temporaryDirectories.push(temporaryDirectory);
  const runnerPath = path.join(temporaryDirectory, "runner.ts");
  const resultPath = path.join(temporaryDirectory, "result.json");
  const adapterPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../src/electron-export-adapter.ts",
  );
  const resultPathLiteral = JSON.stringify(resultPath);
  const adapterPathLiteral = JSON.stringify(adapterPath);

  await writeFile(runnerPath, `
import { writeFile } from "node:fs/promises";
import { app, BrowserWindow, clipboard, dialog, nativeImage } from "electron";
import { createElectronExportAdapter } from ${adapterPathLiteral};

app.commandLine.appendSwitch("force-device-scale-factor", "2");

async function run() {
  await app.whenReady();
  const adapter = createElectronExportAdapter({
    createCaptureWindow: (options) => new BrowserWindow(options),
    nativeImage,
    clipboard: {
      writeImage: (image) => clipboard.writeImage(image),
      writeText: (text) => clipboard.writeText(text),
    },
    dialog: {
      showSaveDialog: (_parent, options) => dialog.showSaveDialog(options),
    },
  });
  const html = '<!doctype html><html><head><style>' +
    'html,body{width:900px;margin:0;padding:0;background:#fff}' +
    '.spacer{height:7800px}.marker{height:120px;background:rgb(17,203,91)}' +
    '</style></head><body><div class="spacer"></div><div class="marker"></div></body></html>';
  const png = await adapter.renderPng(html);
  const image = nativeImage.createFromBuffer(png);
  const size = image.getSize();
  const bottom = image.crop({ x: 0, y: size.height - 100, width: size.width, height: 100 });
  const bitmap = bottom.toBitmap({ scaleFactor: 1 });
  let markerFound = false;
  const near = (value, expected) => Math.abs(value - expected) <= 4;
  for (let index = 0; index + 3 < bitmap.length; index += 4) {
    const bgra = near(bitmap[index], 91) && near(bitmap[index + 1], 203) && near(bitmap[index + 2], 17);
    const rgba = near(bitmap[index], 17) && near(bitmap[index + 1], 203) && near(bitmap[index + 2], 91);
    if ((bgra || rgba) && bitmap[index + 3] === 255) {
      markerFound = true;
      break;
    }
  }
  await writeFile(${resultPathLiteral}, JSON.stringify({
    ok: true,
    width: size.width,
    height: size.height,
    markerFound,
    validPng: png.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])),
  }));
}

run().catch(async (error) => {
  process.exitCode = 1;
  const safeMessage = String(error?.message ?? "")
    .replace(/data:[^\\s]+/g, "[data-url]")
    .slice(0, 500);
  const safeStack = String(error?.stack ?? "")
    .split("\\n")
    .slice(0, 6)
    .map((line) => line.replace(/data:[^\\s]+/g, "[data-url]"));
  await writeFile(${resultPathLiteral}, JSON.stringify({
    ok: false,
    errorName: error?.name ?? "Error",
    safeMessage,
    safeStack,
  }));
}).finally(() => app.quit());
`, "utf8");

  await build({
    entry: { runner: runnerPath },
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
  const child = spawn(electronPath, [path.join(temporaryDirectory, "runner.cjs")], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: "0" },
  });
  let stderr = "";
  child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
  const exitCode = await waitForExit(child, 30_000);
  const result = JSON.parse(await readFile(resultPath, "utf8")) as {
    ok: boolean;
    width?: number;
    height?: number;
    markerFound?: boolean;
    validPng?: boolean;
    errorName?: string;
    safeMessage?: string;
    safeStack?: string[];
  };

  expect(exitCode, `${result.errorName ?? "unknown error"}: ${stderr}`).toBe(0);
  expect(result, JSON.stringify(result)).toMatchObject({
    ok: true,
    width: 900,
    markerFound: true,
    validPng: true,
  });
  expect(result.height).toBeGreaterThan(780);
}, 40_000);
