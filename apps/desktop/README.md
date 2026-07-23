# Airgap Desktop (developer preview)

English · [简体中文](./README.zh-CN.md)

Airgap Desktop is a Share entry point for people who do not want to use a terminal. The current preview does one thing: it reads local Claude Code / Codex sessions, lets you select turns, and copies text or a long image. Scan, Pack, and Open are not part of the desktop application yet.

> This is a developer preview, not an end-user release. It has no Developer ID signature, Apple notarization, or desktop automatic updates. Do not distribute a locally produced `.app`, DMG, or ZIP as an official Airgap release.

## Run locally

The current target is **Apple Silicon macOS**. It requires Node.js 22.12.0 or newer and npm.

From the repository root:

```sh
npm install
npm run desktop:start
```

`desktop:start` builds the Electron main process and opens an Airgap Share window. It reads `~/.claude` and `~/.codex` for the current user and does not require a separately started service.

Closing the window stops both the desktop process and its loopback Share server. The CLI's `airgap share` lifecycle remains unchanged: it exits when you click **Done** or after ten minutes of inactivity. Desktop and CLI use the same Share server and export implementation.

## Verify

Run the normal desktop unit tests and build:

```sh
npm run desktop:test
npm run desktop:build
```

The real Electron smoke test on Apple Silicon macOS does not start by default. Run it explicitly:

```sh
AIRGAP_RUN_ELECTRON_SMOKE=1 npm run desktop:test -- desktop-smoke.test.ts
```

The smoke test uses a temporary home directory and synthetic sessions. It covers authorization, sandbox isolation, session switching, native text/image export, single-instance behavior, and port release without reading real sessions.

To verify that long-image capture remains complete under forced Retina scaling:

```sh
AIRGAP_RUN_ELECTRON_INTEGRATION=1 npm run desktop:test -- capture.integration.test.ts
```

## Package locally

```sh
npm run desktop:make
```

This creates local Apple Silicon artifacts only. A public download still requires a stable release version, Developer ID signing, Apple notarization, a release channel, and a signed update manifest. A GitHub download does not replace operating-system signature and notarization checks.

## Security and update boundary

- The main window enables the Chromium sandbox, context isolation, and web security, and disables Node.js in the renderer.
- The Share server binds only to `127.0.0.1` and uses a random capability token for one-time authorization; the token is then removed from the address bar and placed in an HttpOnly cookie.
- Main and image-capture windows use separate non-persistent sessions. Permission requests and unexpected navigation are denied by default.
- Text and images use Electron's native clipboard integration and do not require a system Chrome installation.
- This developer preview has no desktop automatic updater. The npm CLI's update-notice policy remains unchanged and never installs updates automatically.
