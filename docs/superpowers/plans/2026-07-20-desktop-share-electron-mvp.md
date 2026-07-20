# Electron Desktop Share MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Complete `2026-07-20-desktop-share-core.md` first. Use superpowers:test-driven-development per task and superpowers:verification-before-completion before commits. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a locally runnable Apple Silicon Electron application that opens directly into the shared Share surface, requires no external Node.js or Chrome installation, exports through native macOS facilities, and quits completely with its last window.

**Architecture:** Add a private npm workspace under `apps/desktop`; keep the published root CLI package unchanged through its existing `files` allowlist. Electron main owns lifecycle, the authenticated loopback server, BrowserWindow, capture, clipboard, and save dialog. The sandboxed renderer is the existing shared Share page and has no Node or IPC bridge.

**Tech Stack:** Electron 43.1.0, Electron Forge 7.11.2, TypeScript, tsup, Vitest, macOS APIs exposed by Electron.

---

### Task 1: Verify and install the desktop toolchain

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `apps/desktop/package.json`
- Create: `apps/desktop/tsconfig.json`
- Create: `apps/desktop/forge.config.mjs`

- [ ] Re-run the dependency preflight on the implementation date before editing manifests:

```sh
npm view electron@43.1.0 name version repository engines time.43.1.0 scripts
npm view @electron-forge/cli@7.11.2 name version repository engines time.7.11.2 scripts
npm view @electron-forge/maker-dmg@7.11.2 name version repository engines time.7.11.2 scripts
npm view @electron-forge/maker-zip@7.11.2 name version repository engines time.7.11.2 scripts
```

Confirm each package is from the official Electron GitHub organization and has been public for at least seven days. Electron's install step downloads its pinned runtime from Electron GitHub Releases; record any newly reported install script before approving it. If any fact differs, stop and update this plan rather than silently selecting `latest`.
- [ ] Add `"workspaces": ["apps/desktop"]` to the root package. Keep the existing root `files` list unchanged so `npm pack --dry-run` still excludes `apps/desktop`.
- [ ] Add root scripts:

```json
"desktop:build": "npm run build --workspace @airgap/desktop",
"desktop:start": "npm run start --workspace @airgap/desktop",
"desktop:test": "npm run test --workspace @airgap/desktop --",
"desktop:make": "npm run make --workspace @airgap/desktop"
```

- [ ] Create the private workspace manifest:

```json
{
  "name": "@airgap/desktop",
  "version": "0.3.0",
  "private": true,
  "type": "module",
  "main": "dist/main.cjs",
  "scripts": {
    "build": "tsup src/main.ts --format cjs --platform node --target node22 --out-dir dist --clean --external electron",
    "start": "npm run build && electron .",
    "test": "vitest run --config vitest.config.ts",
    "package": "npm run build && electron-forge package --arch=arm64",
    "make": "npm run build && electron-forge make --arch=arm64"
  },
  "devDependencies": {
    "@electron-forge/cli": "7.11.2",
    "@electron-forge/maker-dmg": "7.11.2",
    "@electron-forge/maker-zip": "7.11.2",
    "electron": "43.1.0"
  }
}
```

- [ ] Make the desktop TypeScript config extend `../../tsconfig.json`, set `rootDir` to `../..`, and include `src/**/*.ts` plus `test/**/*.ts`. Configure Forge with `packagerConfig.asar: true`, the DMG and ZIP makers, and no publisher yet; signing is added only in the release plan.
- [ ] Run `npm install` once to update the root lockfile, then run `npm ls electron @electron-forge/cli @electron-forge/maker-dmg @electron-forge/maker-zip` and confirm the exact versions.
- [ ] Run `npm pack --dry-run` and confirm no `apps/desktop` path appears.
- [ ] Commit only the five task files with `build: scaffold desktop workspace`.

### Task 2: Implement and test application lifecycle independently of Electron globals

**Files:**
- Create: `apps/desktop/src/app-controller.ts`
- Create: `apps/desktop/test/app-controller.test.ts`
- Create: `apps/desktop/vitest.config.ts`

- [ ] Define small injected ports so lifecycle tests use fakes rather than launching a GUI:

```ts
export interface DesktopWindow {
  show(): void;
  focus(): void;
  restore(): void;
  isMinimized(): boolean;
  isDestroyed(): boolean;
  once(event: "ready-to-show" | "closed", listener: () => void): void;
  loadURL(url: string): Promise<void>;
}

export interface DesktopRuntime {
  acquireSingleInstanceLock(): boolean;
  onSecondInstance(listener: () => void): void;
  createWindow(): DesktopWindow;
  getVersion(): string;
  quit(): void;
}
```

- [ ] Write failing tests for first launch, second-launch focus, service startup failure with retry/quit actions, last-window shutdown, and simultaneous retry/close. Assert exactly one service and one window exist at any time.
- [ ] Include a shutdown-order test that records `server.close`, `server.whenExportsIdle`, `window closed`, and `runtime.quit`; require the service port to be released and in-flight exports to settle before `quit()`.
- [ ] Run `npm run desktop:test -- app-controller.test.ts` and confirm failures.
- [ ] Implement an explicit state machine with states `starting`, `ready`, `closing`, and `closed`. Cache the startup and shutdown promises so reentrant calls share one operation.
- [ ] On shutdown, start `server.close()` first so no new export request can enter, then await it together with `server.whenExportsIdle()` before calling `runtime.quit()`.
- [ ] Start the shared server with exactly these desktop policies:

```ts
await startShareServer({
  surface: "desktop",
  idleTimeoutMs: null,
  accessToken,
  appVersion: runtime.getVersion(),
  exportAdapter
});
```

- [ ] Load only `server.entryUrl`, wait for `ready-to-show`, then show the window. A failed load must display a packaged local error document with Retry and Quit instead of a blank window.
- [ ] Run the focused tests and confirm all lifecycle and order assertions pass.
- [ ] Commit only the three task files with `feat: add desktop lifecycle controller`.

### Task 3: Wire the secure Electron main process

**Files:**
- Create: `apps/desktop/src/main.ts`
- Create: `apps/desktop/src/electron-runtime.ts`
- Create: `apps/desktop/test/electron-runtime.test.ts`
- Modify: `apps/desktop/src/app-controller.ts`

- [ ] Write fake-Electron tests that capture BrowserWindow options and navigation handlers. Require:

```ts
webPreferences: {
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
  devTools: !app.isPackaged
}
```

- [ ] Add tests that allow only the exact active loopback Origin in the application window. `will-navigate` and `setWindowOpenHandler` must deny every other destination. The repository and Releases URLs may be passed to `shell.openExternal()` only after an explicit click; all other external URLs are rejected.
- [ ] Run `npm run desktop:test -- electron-runtime.test.ts` and confirm failure before the runtime exists.
- [ ] In `main.ts`, call `app.requestSingleInstanceLock()` before `app.whenReady()`. Quit immediately when it returns false; otherwise register `second-instance` to restore and focus the existing window.
- [ ] Set the application name to `Airgap`, create a single 1180×780 window with minimum size 960×640, hide it until ready, and do not create a tray, login item, daemon, global shortcut, or macOS window-reopen behavior.
- [ ] Handle `window-all-closed` by invoking the controller shutdown on every platform, including macOS. Do not leave the server alive for the usual macOS dock behavior.
- [ ] Register `render-process-gone` and failed-load handling so a renderer crash or startup error reaches the stable local error surface and eventual shutdown.
- [ ] Run the focused tests, `npm run desktop:build`, and `npx electron --version`; confirm the pinned runtime is used.
- [ ] Commit only the four task files with `feat: wire secure Electron main process`.

### Task 4: Implement native desktop export adapters

**Files:**
- Create: `apps/desktop/src/electron-export-adapter.ts`
- Create: `apps/desktop/test/electron-export-adapter.test.ts`
- Create: `apps/desktop/test/capture.integration.test.ts`
- Modify: `apps/desktop/src/main.ts`

- [ ] Unit-test clipboard and save behavior with injected Electron APIs. Require image copy to use `nativeImage.createFromBuffer()` plus `clipboard.writeImage()`, text copy to use `clipboard.writeText()`, and save to use `dialog.showSaveDialog()` followed by an atomic temporary-file rename in the user-selected directory.
- [ ] Verify a canceled dialog returns `null`, never creates a file, and is not reported as a failure. Verify write failures remove Airgap's incomplete temporary file and preserve the current Share selection.
- [ ] Write an Electron integration test for `renderPng(html)` using a long deterministic fixture with a colored marker near the bottom. Require a valid PNG, width 900, height greater than the initial 780 viewport, and the bottom marker to be present when the image is decoded by Electron `nativeImage`.
- [ ] Run `npm run desktop:test -- electron-export-adapter.test.ts capture.integration.test.ts` and confirm failure before implementation.
- [ ] Implement capture with a hidden, sandboxed, same-process BrowserWindow. Load only a `data:text/html` document generated by the trusted renderer, wait for fonts/layout, read `document.documentElement.scrollWidth/scrollHeight`, cap dimensions at 900×30000 with a clear image-only error, resize the hidden content area, then call:

```ts
const image = await captureWindow.webContents.capturePage(
  { x: 0, y: 0, width: 900, height: contentHeight },
  { stayHidden: true }
);
return image.toPNG();
```

- [ ] Destroy the capture window in `finally`. Deny navigation, popups, permissions, downloads, and remote subresources. Keep `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, and `webSecurity: true`.
- [ ] Inject this adapter into the shared server; remove no CLI adapter code. Image capture must work when Google Chrome is absent because it uses Electron's bundled Chromium.
- [ ] Run the focused tests twice to expose leaked capture windows, then `npm run desktop:build`.
- [ ] Commit only the four task files with `feat: add native desktop exports`.

### Task 5: Add a deterministic desktop smoke harness

**Files:**
- Create: `apps/desktop/src/smoke.ts`
- Create: `apps/desktop/test/desktop-smoke.test.ts`
- Create: `apps/desktop/test/fixtures/claude-project.jsonl`
- Create: `apps/desktop/test/fixtures/codex-session.jsonl`
- Modify: `apps/desktop/src/main.ts`

- [ ] Gate the harness behind `AIRGAP_DESKTOP_SMOKE=1`; packaged production builds must ignore every other smoke-only environment variable unless that gate is exactly set.
- [ ] In the test, create an isolated temporary home, copy both fixtures into its `.claude` and `.codex` trees, and spawn the workspace's pinned Electron binary with a result JSON path.
- [ ] Have the gated harness exercise the real BrowserWindow: wait for authenticated redirect, assert `process` and `require` are absent in the renderer, select turns, confirm visible labels omit raw IDs, export text and PNG through the real adapter, issue a second-instance launch, then close the window.
- [ ] Record only booleans, app version, exported file sizes, and observed lifecycle events. Never record fixture conversation text or the capability token.
- [ ] Add a 30-second test timeout and a `finally` cleanup that terminates only the exact spawned PID if it failed to exit. Assert the app PID exits, the loopback port refuses connections, and the second launch did not create a second server.
- [ ] Run `npm run desktop:test -- desktop-smoke.test.ts` on Apple Silicon macOS and confirm the complete flow passes.
- [ ] Commit only the five task files with `test: cover desktop Share smoke flow`.

### Task 6: Document local desktop development and verify the MVP

**Files:**
- Create: `apps/desktop/README.md`
- Modify: `README.md`
- Modify: `README.zh-CN.md`

- [ ] Document that this stage is a developer preview, not the signed public download. Include prerequisites, `npm install`, `npm run desktop:start`, `npm run desktop:test`, and the exact distinction between closing the desktop window and the CLI ten-minute idle policy.
- [ ] Keep primary CLI installation instructions intact. Do not claim a downloadable desktop app until the signed release plan is complete.
- [ ] Run `npm run typecheck`, `npm test`, `npm run build`, `npm run desktop:test`, and `npm run desktop:build`; require exit code 0 for all.
- [ ] Run `npm pack --dry-run` again and confirm the published CLI tarball does not contain Electron, Forge, `apps/desktop`, or desktop assets.
- [ ] Run `git diff --check` and inspect `git status --short` for unrelated user work.
- [ ] Commit only the three documentation files with `docs: add desktop development guide`.
- [ ] Acceptance result: `npm run desktop:start` opens one secure Share window, native exports work without external Chrome, a second launch focuses it, and closing the window releases the process and port.
