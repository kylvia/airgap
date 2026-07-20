# Desktop Share Update, Signing, and Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Complete the core and Electron MVP plans first. Use superpowers:test-driven-development for updater code and superpowers:verification-before-completion before release claims. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the local desktop MVP into a Developer ID-signed, hardened, notarized Apple Silicon DMG distributed through GitHub Releases, with signed automatic updates enabled by default and user-controlled in Settings.

**Architecture:** Keep update policy in a testable state machine owned by Electron main. Expose only a narrow authenticated desktop-control adapter through the existing loopback API. Package DMG plus ZIP with Electron Forge, notarize in GitHub Actions, and use Electron's public `update.electronjs.org` feed backed by Airgap GitHub Releases.

**Tech Stack:** Electron `autoUpdater`, Electron Forge, Apple Developer ID/notarytool, GitHub Actions and Releases, Vitest.

---

### Task 1: Add the shared automatic-update preference

**Files:**
- Modify: `src/config.ts`
- Modify: `test/config.test.ts`
- Modify: `src/server/share-server.ts`
- Modify: `src/server/page.ts`
- Modify: `src/i18n/locales/en.ts`
- Modify: `src/i18n/locales/zh-CN.ts`
- Modify: `test/share-server.test.ts`

- [ ] Add failing configuration tests proving a missing value defaults to `true`, explicit `false` round-trips, malformed values fall back to `true`, and unrelated/unknown configuration keys survive an update.
- [ ] Extend the config shape without changing existing CLI preferences:

```ts
export interface AirgapConfig {
  updateCheck?: boolean;
  language?: string;
  share?: {
    sessionListLimit?: number;
    toolDisplay?: ToolDisplay;
  };
  desktop?: {
    autoUpdate?: boolean;
  };
}

export function desktopAutoUpdateEnabled(config: AirgapConfig): boolean {
  return config.desktop?.autoUpdate !== false;
}
```

- [ ] Add `autoUpdate?: boolean` to `ConfigPatch` and `autoUpdate: boolean` to `ConfigUpdateResult`. Persist only `desktop.autoUpdate`, using the existing queued atomic writer so concurrent language/Share/update-setting writes cannot overwrite one another.
- [ ] Define a narrow optional server bridge:

```ts
export interface DesktopControlAdapter {
  getUpdateStatus(): DesktopUpdateStatus;
  setAutoUpdate(enabled: boolean): Promise<DesktopUpdateStatus>;
  checkForUpdates(): Promise<DesktopUpdateStatus>;
  restartToInstall(): Promise<void>;
}
```

- [ ] Add authenticated desktop-only routes: `GET /api/desktop/update`, `POST /api/desktop/update/preference`, `POST /api/desktop/update/check`, and `POST /api/desktop/update/restart`. Return `404` when no desktop adapter is supplied so the CLI surface gains no update controls.
- [ ] Test that all POST routes retain capability-cookie and exact-Origin checks, reject extra fields, and never expose feed URLs, filesystem paths, credentials, or exception stacks.
- [ ] Add Settings copy in both locales: automatic updates, the default-on explanation, network disclosure, Check now, checking, up to date, downloaded, Restart now, Later, and concise manual-check failure. Scheduled failures remain silent outside Settings.
- [ ] Have desktop Settings poll status only while the panel is open. Turning the toggle off updates `~/.airgap/config.json` immediately; Check now remains enabled and is explicitly one-time.
- [ ] Run `npm test -- test/config.test.ts test/share-server.test.ts test/i18n.test.ts`, then `npm run typecheck`.
- [ ] Commit only the seven task files with `feat: add desktop update preference`.

### Task 2: Implement a deterministic updater policy state machine

**Files:**
- Create: `apps/desktop/src/updater-policy.ts`
- Create: `apps/desktop/test/updater-policy.test.ts`

- [ ] Define status values `disabled`, `idle`, `checking`, `downloading`, `downloaded`, and `error`, plus trigger values `scheduled` and `manual`.
- [ ] Write failing table tests for:
  - automatic updates defaulting on;
  - scheduled checks disabled by the preference;
  - a 24-hour scheduled-attempt throttle;
  - manual checks bypassing both preference and throttle;
  - concurrent calls returning the same Promise;
  - one download per process;
  - disabling during download preserving `downloading`/`downloaded` without restart;
  - scheduled errors remaining non-blocking; and
  - restart being legal only after `downloaded`.
- [ ] Store this non-sensitive cache at `path.join(app.getPath("userData"), "update-state.json")`:

```ts
export interface UpdateAttemptCache {
  lastAttemptAt?: string;
  latestValidVersion?: string;
}
```

- [ ] Parse the cache defensively, write it atomically, and treat future, invalid, or unreadable timestamps as no valid throttle. Do not store project names, conversation data, paths, the capability token, or full update URLs.
- [ ] Make scheduled and manual check functions accept an injected clock and updater port. Coalesce repeated calls until the underlying check resolves; Electron warns that duplicate `checkForUpdates()` calls can download twice.
- [ ] Run `npm run desktop:test -- updater-policy.test.ts` and confirm all table cases pass.
- [ ] Commit only the two task files with `feat: add desktop updater policy`.

### Task 3: Connect Electron's signed updater without coupling it to Share

**Files:**
- Create: `apps/desktop/src/electron-updater.ts`
- Create: `apps/desktop/test/electron-updater.test.ts`
- Modify: `apps/desktop/src/main.ts`
- Modify: `apps/desktop/src/app-controller.ts`

- [ ] Write fake-`autoUpdater` tests for feed setup, event-to-status mapping, scheduled/manual errors, download prompt state, Later, and clean restart. Inject a public-build verifier and assert development, unsigned, wrong-Team-ID, and unpackaged builds never call `setFeedURL()` or `checkForUpdates()`.
- [ ] Configure the stable public feed exactly as:

```ts
const feedUrl = `https://update.electronjs.org/kylvia/airgap/darwin-arm64/${app.getVersion()}`;
autoUpdater.setFeedURL({ url: feedUrl });
```

Do not add a prerelease channel, downgrade flag, custom update server, headers, analytics, or conversation-derived query parameters.
- [ ] Start at most one scheduled check after the main window is ready. Read the preference and 24-hour cache first. `checkForUpdates()` downloads an available update automatically; map its events rather than starting a second downloader.
- [ ] Enable the updater only when `app.isPackaged` is true, the generated stable-release marker exists, `/usr/bin/codesign --verify --deep --strict` succeeds, and the signing metadata's TeamIdentifier equals the marker's expected Team ID.
- [ ] On `update-downloaded`, expose Restart now and Later in Settings and show one native prompt. Later closes only the prompt; Electron applies the downloaded signed update on a future clean app launch.
- [ ] Implement Restart now in this exact order: reject new exports, await `exportCoordinator.whenIdle()`, await `shareServer.close()`, mark updater shutdown, then call `autoUpdater.quitAndInstall()`. Handle Electron's `before-quit-for-update` event because ordinary `before-quit` ordering differs.
- [ ] Contain updater exceptions: preserve the Share window and current selection, keep exports enabled, and surface concise details only after a manual check or inside open Settings.
- [ ] Run `npm run desktop:test -- electron-updater.test.ts updater-policy.test.ts` and `npm run desktop:build`.
- [ ] Commit only the four task files with `feat: enable signed desktop updates`.

### Task 4: Add the Airgap app icon and hardened packaging configuration

**Files:**
- Create: `apps/desktop/assets/icon.svg`
- Create: `apps/desktop/scripts/build-icon.cjs`
- Create: `apps/desktop/scripts/write-public-release.cjs`
- Create: `apps/desktop/assets/entitlements.plist`
- Create: `apps/desktop/assets/entitlements.inherit.plist`
- Create: `apps/desktop/scripts/collect-release-artifacts.mjs`
- Modify: `apps/desktop/package.json`
- Modify: `apps/desktop/forge.config.mjs`
- Modify: `.gitignore`

- [ ] Build `icon.svg` from the approved Airgap mark: two rounded vertical bars on a warm monochrome square. Include no text, remote asset, gradient, or third-party mark.
- [ ] Make `build-icon.cjs` run under the pinned Electron binary, render 16, 32, 64, 128, 256, 512, and 1024 pixel PNGs with Electron `nativeImage`, populate an `.iconset`, invoke `/usr/bin/iconutil -c icns`, and fail if the resulting ICNS is missing or empty.
- [ ] Add the minimum hardened-runtime entitlements required by the pinned Electron runtime, including JIT support in the child-process inherit file. Do not enable App Sandbox, arbitrary network loads, microphone, camera, contacts, automation, or library-validation bypass without a reproduced need.
- [ ] Make `write-public-release.cjs` remove only the generated marker directory by default. When `AIRGAP_PUBLIC_RELEASE=1` and `APPLE_TEAM_ID` is non-empty, write `assets/generated/public-release.json` containing only repository `kylvia/airgap`, channel `stable`, and that Team ID. Configure Forge to include this generated file as a resource only when present.
- [ ] Configure Forge:
  - application bundle ID `com.kylvia.airgap`;
  - name `Airgap` and Apple Silicon only;
  - `asar: true`, minimum system version macOS 13;
  - hardened runtime and both entitlement files;
  - Developer ID signing when `APPLE_CODESIGN_IDENTITY` exists;
  - notarization only when all three `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` exist;
  - DMG plus ZIP makers; and
  - no Mac App Store target.
- [ ] Prefix both desktop `package` and `make` scripts with `node scripts/write-public-release.cjs` so a normal local build actively removes any stale public marker before packaging.
- [ ] Make the collector copy exactly one DMG and one ZIP from Forge output into `dist/release/`, naming them `Airgap-<version>-arm64.dmg` and `Airgap-<version>-darwin-arm64.zip`; fail on zero or multiple matches.
- [ ] Ignore generated ICNS/iconset, `out/`, and `dist/release/`, but keep source SVG, entitlements, and scripts tracked.
- [ ] Run `npm run desktop:make` without credentials and confirm it produces unsigned internal artifacts for development. Confirm the updater remains disabled in that build.
- [ ] Commit only the nine task files with `build: configure desktop packaging`.

### Task 5: Add signed and notarized desktop release automation

**Files:**
- Create: `.github/workflows/desktop-release.yml`
- Modify: `.github/workflows/ci.yml`
- Modify: `apps/desktop/README.md`

- [ ] Before editing Actions configuration, verify the current official major versions for checkout, setup-node, and upload-artifact; retain the repository's existing versions when still supported. Record any required migration in the commit message body.
- [ ] Extend CI with an Apple Silicon macOS job that runs `npm ci`, core typecheck/tests/build, desktop tests/build, and `npm pack --dry-run`. Do not make unsigned CI claim signing or notarization success.
- [ ] Create a release workflow triggered only by SemVer tags matching `v*`. Give it `contents: write`, run on Apple Silicon macOS, and reject the tag unless it equals `v` plus `apps/desktop/package.json` version. Do not use a `desktop-` tag prefix: `update.electronjs.org` ignores release tags that are not valid SemVer.
- [ ] Import `APPLE_CERTIFICATE_BASE64` into a temporary keychain using `APPLE_CERTIFICATE_PASSWORD` and `KEYCHAIN_PASSWORD`; list the resolved Developer ID Application identity and pass it as `APPLE_CODESIGN_IDENTITY`. Always delete the temporary keychain in a final step.
- [ ] Supply notarization credentials only through GitHub Actions secrets: `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`. Set `AIRGAP_PUBLIC_RELEASE=1` only for this signed job. Never write passwords or certificates to repository files, logs, artifacts, or the updater cache; the generated marker may contain the non-secret Team ID.
- [ ] Run `npm ci`, the full core and desktop verification commands, `npm run desktop:make`, and the artifact collector. Submit the resulting DMG with `xcrun notarytool submit --wait`, staple it with `xcrun stapler staple`, and fail before publishing if notarization, stapling, DMG, or ZIP is absent.
- [ ] Verify inside CI:

```sh
codesign --verify --deep --strict --verbose=2 "out/Airgap-darwin-arm64/Airgap.app"
spctl --assess --type execute --verbose=2 "out/Airgap-darwin-arm64/Airgap.app"
xcrun stapler validate "dist/release/Airgap-${DESKTOP_VERSION}-arm64.dmg"
```

- [ ] Create the GitHub Release with the exact tag, generated release notes, notarized DMG, and signed ZIP. Do not publish npm from this workflow.
- [ ] Document the required Apple/GitHub secrets, tag convention, local unsigned build distinction, and rollback procedure (remove a bad Release; do not issue a downgrade feed).
- [ ] Run a workflow syntax check available in the repository, `git diff --check`, and review permissions/secrets line by line.
- [ ] Commit only the three task files with `ci: release signed desktop builds`.

### Task 6: Perform clean-machine and update acceptance

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `apps/desktop/README.md`
- Create: `docs/desktop-release-checklist.md`

- [ ] Publish the first signed desktop release from `v0.3.0` only after explicit release authorization. Download the DMG from GitHub rather than testing the workflow workspace copy.
- [ ] On a clean Apple Silicon macOS 13+ account with no Node.js and no external Chrome, verify Gatekeeper opens the app, the DMG drag-install works, and `spctl`, `codesign`, and `xcrun stapler validate` all succeed.
- [ ] Install Claude Code and Codex fixture conversations. Verify discovery, friendly labels, default redaction, risk confirmation when disabled, text clipboard, image clipboard, save dialog, long PNG capture, locale, permission error, and empty state.
- [ ] Launch Airgap twice and confirm one window/service. Close the window and confirm the exact PID exits and its loopback port closes.
- [ ] Verify default update behavior with a second signed `v0.3.1` release: one background download, Restart now/Later prompt, Later preserving the running version, clean later installation, and preserved settings.
- [ ] Disable automatic updates, wait beyond the test throttle interval, and confirm no scheduled request. Then use Check now and confirm one explicit request still works. Re-enable it and confirm the stored preference.
- [ ] Exercise an offline check, invalid feed response, insufficient disk simulation where practical, and closing during export. Confirm Share and the current selection remain usable and no forced restart occurs.
- [ ] Add the verified public desktop installation section to both READMEs only after the release URL exists. Keep CLI upgrade instructions separate and truthful.
- [ ] Record every command, artifact checksum, macOS version, app versions, result, and unresolved exception in `docs/desktop-release-checklist.md`.
- [ ] Run final repository verification: `npm run typecheck`, `npm test`, `npm run build`, `npm run desktop:test`, `npm run desktop:build`, `npm pack --dry-run`, and `git diff --check`.
- [ ] Commit only the four documentation files with `docs: publish desktop installation guide`.
- [ ] Acceptance result: a GitHub-downloaded, signed, notarized DMG installs on a clean Apple Silicon Mac; Share works without terminal dependencies; default-on updates respect opt-out and never force restart.

## Implementation References

- Electron updater guide: `https://www.electronjs.org/docs/latest/tutorial/updates`
- Electron `autoUpdater` API: `https://www.electronjs.org/docs/latest/api/auto-updater/`
- Official update service routes and asset naming: `https://github.com/electron/update.electronjs.org`
- Apple distribution preparation: `https://developer.apple.com/documentation/xcode/preparing-your-app-for-distribution`
