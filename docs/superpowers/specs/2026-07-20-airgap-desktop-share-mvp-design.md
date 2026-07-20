# Airgap Desktop Share MVP Design

**Date:** 2026-07-20
**Status:** Approved in conversation

## Goal

Airgap should provide a macOS desktop application for people who use Claude
Code or Codex locally but do not want to operate a terminal. The first release
does one job completely:

> Open Airgap, choose conversation turns, hide suspected secrets, and copy or
> save the result.

The release is successful when a person on a clean Apple Silicon Mac can
download a signed and notarized DMG, drag Airgap into Applications, open it
without installing Node.js or the Airgap CLI, and complete that flow without
seeing a port, session ID, shell command, or implementation detail.

## Product Scope

The first desktop release includes:

- automatic discovery of local Claude Code and Codex conversations;
- a friendly project and conversation picker;
- turn selection and live preview;
- secret detection with redaction enabled by default;
- copy image, save PNG, and copy text actions;
- a nontechnical empty state when no conversations are found;
- English and Simplified Chinese using Airgap's existing locale resolution;
- a small settings surface for language and automatic updates, with existing
  technical display controls placed under an explicitly advanced section;
- an About surface showing the installed version and a link to the official
  download page;
- signed automatic updates enabled by default, with background download and an
  explicit restart choice after download; and
- complete shutdown when the last window closes.

The first release explicitly excludes:

- desktop Scan, Pack, or Open workflows;
- Scan, Pack, or Open guide pages, placeholders, sidebar items, or “coming
  soon” cards;
- a home dashboard or multi-feature navigation shell;
- terminal commands or CLI installation instructions in the primary UI;
- menu-bar residence, launch-at-login, a daemon, or a global hotkey;
- silent restart, forced interruption, prerelease update channels, or
  downgrades;
- Mac App Store distribution or App Sandbox;
- Intel macOS, Windows, or Linux packages; and
- changes to the existing CLI command surface or npm distribution.

These exclusions prevent an incomplete product shell from obscuring the one
workflow the release is meant to validate. Scan is the first candidate for a
later desktop phase, but only after Share usage demonstrates demand.

## Audience and Language

The primary user understands “Claude Code conversation,” “Codex conversation,”
“copy image,” and “possible secret,” but may not understand JSONL, loopback,
session IDs, ports, Node.js, manifests, or shell aliases. Primary copy uses the
user's vocabulary:

- “conversation,” not “transcript” or “JSONL”;
- “automatically hide possible secrets,” not “redaction pipeline”;
- “copy text,” not “export Markdown”; and
- “recheck,” not “rerun discovery.”

Advanced details remain available where needed for diagnosis, but never block
the default path.

## Chosen Architecture

The desktop application uses Electron because the existing Airgap core and
Share implementation are TypeScript and Node.js. Electron's main process can
run that code directly while a renderer process hosts the interface. This
avoids a Rust or Swift rewrite and avoids shipping the CLI as a child process.

The implementation must pin a stable Electron release that has been public for
at least seven days at implementation time, unless a documented security fix
requires a newer exception. It must verify the package name, source, current
platform support, installation scripts, and signing tooling before adding the
dependency.

The application has four internal boundaries:

1. **Electron main process.** Owns application lifecycle, the single-instance
   lock, the BrowserWindow, the authenticated local Share service, native save
   dialogs, clipboard access, desktop PNG capture, and signed application
   updates.
2. **Renderer.** Owns the single-window interface. It has no Node.js access and
   communicates only with the authenticated local Share API.
3. **Shared TypeScript core.** Remains the sole implementation of session
   discovery, parsing, turn slicing, secret detection, redaction, HTML/text
   rendering, locale resolution, and configuration semantics.
4. **Desktop adapters.** Translate generic export requests into Electron
   clipboard, save-dialog, and Chromium capture operations. The CLI continues
   using its existing terminal, browser, and local-Chrome adapters.

Electron is responsible for packaging its runtime, so end users do not need a
separate Node.js installation. The renderer loads only packaged or Airgap-owned
loopback content. It never loads remote application code.

## Application Lifecycle

Airgap is a single-instance, single-window application.

1. On launch, the main process acquires Electron's single-instance lock.
2. A second launch focuses the existing window instead of starting another
   Share service.
3. The main process discovers conversations, starts the desktop Share service,
   and opens the window only after the first page is ready.
4. The desktop service has no idle timeout while the window exists.
5. Closing the last window closes the service and quits the application, even
   on macOS.
6. A later click on the Airgap icon starts a fresh process and reads current
   conversation data.

The existing `airgap share` CLI retains its browser behavior and ten-minute
idle shutdown. The shared server must therefore accept caller-owned lifecycle
options instead of calling `process.exit()` internally.

## User Interface

### Main window

The application launches directly into Share. There is no home screen or
sidebar.

The top bar contains:

- the Airgap name and “Share conversation” label;
- a picker labeled with a friendly project name and relative conversation
  time, never a raw session ID;
- a recheck action; and
- settings.

The content area keeps the proven two-pane Share model:

- the left pane lists selectable conversation turns with human labels such as
  “Me,” “AI assistant,” and “Tool action”;
- the right pane shows the exact export preview; and
- tool details remain hidden or summarized by default, with the full display
  level available only under Advanced settings.

The bottom action area contains:

- “Automatically hide possible secrets,” enabled by default, with a short
  explanation that Airgap checks again before export;
- “Copy text” as a secondary action;
- “Save image” as a secondary action; and
- “Copy image” as the primary action.

Turning secret hiding off preserves the existing two-step risk confirmation.
The default workflow never exposes raw detected secret text.

### Empty and error states

If no conversations are found, the window says that Airgap automatically looks
for Claude Code and Codex conversations on this Mac, suggests completing a
conversation first, and offers “Recheck.” It also repeats that Airgap does not
upload files or require an account.

If a conversation directory cannot be read, Airgap names the affected product
and path, explains that macOS or file permissions prevented access, and offers
recheck plus a help link. It never changes permissions or runs `chmod`.

If startup fails, the window shows a stable error page with Retry and Quit. A
backend exception must never result in an unlabelled white window.

If image capture fails, copy text remains available and the error explains that
only image export failed. Export failures do not clear the current selection.

## Export Adapters

The desktop build must not depend on a separately installed Chrome or
Chromium. PNG generation uses Electron's bundled Chromium through a hidden or
offscreen BrowserWindow controlled by the main process. The same rendered HTML
and theme used by the CLI remain the source for the captured image.

Desktop clipboard and file output use Electron APIs:

- image copy writes an Electron NativeImage to the clipboard;
- text copy writes the rendered textual representation to the clipboard; and
- image save presents a native save dialog and writes only to the location the
  user confirms.

Core detection and redaction complete before any adapter receives exportable
content. The adapter layer does not decide security policy.

## Local API Security

The desktop renderer runs with:

- `nodeIntegration: false`;
- `contextIsolation: true`;
- Chromium renderer sandboxing enabled with `sandbox: true`;
- `webSecurity: true`; and
- navigation and new-window handlers that reject non-Airgap destinations and
  open approved help/download links in the system browser.

The local service binds only to `127.0.0.1` on an operating-system-assigned
port. Every desktop launch creates a cryptographically random capability token.
Desktop API requests must present that token, and the service rejects requests
without it before parsing their body. Mutating requests also validate their
Origin. The token is not written to disk or logs and expires when the process
exits.

The application ships no CDN assets, analytics, telemetry, remote fonts, or
embedded remote pages. Its only application-initiated external runtime traffic
is the optional signed-update flow described below. The only approved external
links are the official `https://github.com/kylvia/airgap` repository and its
Releases page. Opening either is an explicit user action handled by the system
browser.

## Filesystem Truth and Configuration

Session truth remains in the existing local sources:

- `~/.claude` for Claude Code; and
- `~/.codex` for Codex.

The desktop application reads these sources and never writes into them. User
preferences continue to use `~/.airgap/config.json` so CLI and desktop language
and Share preferences cannot drift. Desktop-specific window geometry may use
Electron's application-data directory, but it must not become a second truth
source for Share behavior.

The only ordinary writes are explicit user exports, configuration changes, and
non-sensitive desktop window state. No conversation cache or API token is
persisted.

## Distribution

The MVP targets Apple Silicon on macOS 13 or newer. It is distributed outside
the Mac App Store as a Developer ID-signed, hardened-runtime, notarized DMG.
The release artifact must contain the application runtime and all required
assets.

Mac App Store distribution is excluded because App Sandbox does not grant
unrestricted access to the user's home directory. Requiring a nontechnical
person to locate and authorize hidden `~/.claude` and `~/.codex` directories
would undermine the intended first-run experience. This decision does not
bypass normal POSIX permissions or macOS privacy controls.

The public GitHub Release contains the notarized DMG plus the signed archive and
metadata required by Electron's macOS updater. Development and unsigned
internal builds do not start the updater.

The About surface shows the current version and an explicit “Visit download
page” action targeting `https://github.com/kylvia/airgap/releases`.

## Automatic Updates

Automatic updates are enabled by default for packaged, signed public builds.
The setting is stored as `desktop.autoUpdate` in `~/.airgap/config.json` and
defaults to true. Setting it to false prevents future scheduled checks and
downloads. If the user disables it after a signed download has already begun,
that in-flight download may finish, but it never forces a restart; Settings
shows the pending state. The Settings page also provides “Check for updates
now,” which is an explicit one-time request even when automatic updates are
disabled.

The Electron main process owns the updater and uses Electron's signed macOS
`autoUpdater` path with the Electron project's `update.electronjs.org` service,
backed by official Airgap GitHub Releases. Airgap does not operate a separate
update server. The normal flow is:

1. After the main window is ready, read the preference and the last-attempt
   cache.
2. If automatic updates are enabled and no check has been attempted in the
   previous 24 hours, request the stable release feed.
3. When a newer signed release exists, download it in the background without
   blocking Share.
4. After download completes, show “Restart now” and “Later.” Never close the
   window or interrupt an export without the user's restart choice.
5. “Restart now” performs a clean Share-service shutdown and invokes the
   updater's install-and-restart path. “Later” keeps the current version running
   and explains that the downloaded update will apply on a later clean launch.

The attempt cache lives in Electron's application-data directory and records
only the attempt time and latest valid desktop version. A manual check bypasses
the 24-hour throttle. Concurrent or repeated calls in one process are
coalesced so the same release cannot download twice.

Update requests to `update.electronjs.org` and the GitHub release download
hosts contain ordinary HTTPS metadata plus the current application version,
macOS platform, and architecture required to select the artifact. They never
include conversation content, findings, project names, filesystem paths, or
Airgap configuration values. Settings discloses this network boundary next to
the default-on toggle.

Downloaded updates must be Developer ID-signed and delivered through the
configured stable feed. Signature, feed, download, disk-space, and install
errors are contained by the updater: they do not change Share data, close the
window, or change export results. A concise failure appears only in Settings or
after a manual check; scheduled failures remain non-blocking.

## Failure Containment

- Renderer crashes must not leave the local service running after the app
  exits.
- Service startup and shutdown are idempotent so retry and window close cannot
  race into duplicate listeners or stale ports.
- A second application launch focuses the existing window and cannot create a
  second service.
- Session refresh swaps visible data only after a successful read; failed
  refreshes preserve the current selection and preview.
- Configuration errors fall back to safe defaults and surface a concise
  settings warning without blocking Share.
- Detection, redaction, capture, clipboard, and file-save failures retain
  distinct error messages and do not claim another stage succeeded.
- Closing during export cancels or contains the operation and removes any
  incomplete temporary artifact owned by Airgap.
- Update checks and downloads cannot overlap an install request, and updater
  failure cannot change the current app's exit behavior.
- Restart-for-update first stops the Share service and waits for an in-flight
  explicit file write to finish or cancel; it never terminates midway through a
  user-confirmed save.

## Verification

Existing core and CLI tests remain mandatory. Desktop-specific automated tests
must cover:

- main-process lifecycle and single-instance behavior;
- service startup, retry, shutdown, and port release;
- token rejection, Origin validation, and blocked external navigation;
- renderer operation with Node integration disabled;
- normal, no-session, permission-error, and startup-error states;
- friendly conversation labels that do not expose raw session IDs;
- redaction enabled by default and double confirmation when disabled;
- PNG capture without an externally installed Chrome;
- image clipboard, text clipboard, save dialog, and adapter failures;
- locale and shared configuration behavior; and
- automatic-update default, opt-out, manual check, 24-hour throttle, request
  boundary, duplicate-check coalescing, download prompt, clean restart, and
  failure containment; and
- preservation of the existing CLI Share idle timeout and browser behavior.

End-to-end acceptance uses a clean Apple Silicon macOS account with local
Claude Code and Codex fixtures. It verifies DMG installation, Gatekeeper,
notarization, first launch, conversation discovery, image/text export, a second
launch focusing the first window, and complete process/port shutdown after the
window closes. A second signed test release verifies background download,
restart deferral, clean install, and preservation of settings.

Before any release claim, fresh verification must include the repository test,
typecheck, and build commands; desktop unit and integration tests; package
content inspection; code-signature verification; notarization assessment; DMG
installation on a clean account; and a scoped diff review proving unrelated
user files were not included.

## Later Phases

Later phases are separate specs rather than implied MVP work:

1. desktop Scan, after Share usage validates the application channel;
2. desktop Pack and Open, with their own write and risk-confirmation designs;
3. Intel macOS support based on user demand;
4. prerelease channels or staged update rollout; and
5. Windows or Linux distribution.

Adding a second real desktop workflow is the trigger to design persistent
navigation. The MVP must not prebuild that shell.

## Primary References

- [Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model)
- [Electron security recommendations](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron distribution overview](https://www.electronjs.org/docs/latest/tutorial/distribution-overview)
- [Electron automatic updates](https://www.electronjs.org/docs/latest/tutorial/updates)
- [Electron autoUpdater API](https://www.electronjs.org/docs/latest/api/auto-updater/)
- [Apple: Preparing your app for distribution](https://developer.apple.com/documentation/xcode/preparing-your-app-for-distribution)
- [Apple: Accessing files from the macOS App Sandbox](https://developer.apple.com/documentation/security/accessing-files-from-the-macos-app-sandbox)
