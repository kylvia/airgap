# Desktop Share Core and Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development while implementing each task, then superpowers:verification-before-completion before every commit. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the existing Share implementation into one reusable service whose CLI caller keeps the ten-minute idle policy while the future desktop caller owns window-bound lifecycle, authenticated access, and native export adapters.

**Architecture:** Keep one `startShareServer()` and one renderer. Add caller-supplied lifecycle, authentication, surface, and export policies instead of copying a desktop server. Defaults preserve `airgap share`; desktop callers opt into no idle timeout, a capability token, desktop copy, and injected adapters.

**Tech Stack:** TypeScript, Node.js HTTP, Vitest, existing Airgap parser/render/export modules.

---

### Task 1: Establish the lifecycle contract without changing CLI behavior

**Files:**
- Modify: `src/server/share-server.ts`
- Modify: `test/share-server.test.ts`
- Modify: `test/share-command.test.ts`

- [ ] Add focused tests for a caller-owned lifecycle. Use a short timeout only in tests:

```ts
it("closes after the configured idle timeout", async () => {
  const server = await startShareServer({ idleTimeoutMs: 20 });
  await expect(server.closed).resolves.toBeUndefined();
});

it("stays open when the caller disables idle shutdown", async () => {
  const server = await startShareServer({ idleTimeoutMs: null });
  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(server.isClosed()).toBe(false);
  await server.close();
});

it("allows concurrent close calls", async () => {
  const server = await startShareServer({ idleTimeoutMs: null });
  await Promise.all([server.close(), server.close()]);
  await expect(server.closed).resolves.toBeUndefined();
});
```

- [ ] Run `npm test -- test/share-server.test.ts -t "configured idle|caller disables|concurrent close"` and confirm the new tests fail because the options and lifecycle handles do not exist.
- [ ] Replace the server contract with this caller-owned shape:

```ts
export interface ShareServer {
  url: string;
  entryUrl: string;
  closed: Promise<void>;
  isClosed(): boolean;
  close(): Promise<void>;
}
```

- [ ] Add `idleTimeoutMs?: number | null` to the existing `ShareServerOptions` interface without removing its port, session, locale, config-home, or system-locale fields.
- [ ] Interpret `undefined` as the existing ten minutes, a positive number as an explicit timeout, and `null` as no timeout. Make `close()` idempotent, clear the timer inside it, and resolve `closed` only after the HTTP listener releases its port.
- [ ] Remove both internal `process.exit(0)` calls. `/api/close` and idle expiration must call the same idempotent `close()`; the CLI process exits naturally when no handles remain.
- [ ] Add a CLI regression that starts the normal command path with fake timers, advances ten minutes, and confirms the server closes. Keep the existing browser-opening assertions unchanged.
- [ ] Run `npm test -- test/share-server.test.ts test/share-command.test.ts` and confirm all tests pass.
- [ ] Commit only these files with `refactor: make Share lifecycle caller-owned`.

### Task 2: Add opt-in loopback authentication for desktop callers

**Files:**
- Create: `src/server/share-access.ts`
- Create: `test/share-access.test.ts`
- Modify: `src/server/share-server.ts`
- Modify: `test/share-server.test.ts`

- [ ] Write unit tests for exact cookie parsing, constant-time token comparison, and Origin validation. Cover missing, duplicate, malformed, and wrong tokens.
- [ ] Add integration tests proving:
  - `accessToken` omitted preserves current unauthenticated CLI behavior;
  - `GET /?access=<token>` returns `303`, sets an `HttpOnly; SameSite=Strict; Path=/` cookie, and redirects to `/`;
  - a request without the cookie returns `401` before its body is parsed;
  - a mutating request without `Origin`, or with the wrong Origin, returns `403`;
  - the authenticated cookie plus the exact loopback Origin succeeds; and
  - neither HTML nor server errors contain the raw token.
- [ ] Run `npm test -- test/share-access.test.ts test/share-server.test.ts -t "access|Origin|token"` and confirm failure before implementation.
- [ ] Implement the narrow access helpers:

```ts
export const SHARE_COOKIE = "airgap_share";

export function createShareAccessToken(): string;
export function readCookie(header: string | undefined, name: string): string | undefined;
export function tokensEqual(actual: string | undefined, expected: string): boolean;
export function isAllowedOrigin(origin: string | undefined, expectedOrigin: string): boolean;
```

Use `randomBytes(32).toString("base64url")` for generation and `timingSafeEqual` only after equal-length Buffer checks.
- [ ] Add `accessToken?: string` to `ShareServerOptions`. Compute the expected Origin from the actual listener address after binding to `127.0.0.1`.
- [ ] Keep `url` token-free for diagnostics. When authentication is enabled, return a process-local bootstrap URL as `entryUrl`; it remains replayable only until service shutdown so a lost `303` can be retried, and is never persisted. Otherwise set `entryUrl === url` for the CLI.
- [ ] Authenticate before reading POST bodies. Accept the token only on a `GET /` bootstrap request, set the cookie, then redirect so it disappears from the address bar. The Electron caller must call `webContents.navigationHistory.clear()` after the canonical `/` page loads so the bootstrap URL is also removed from renderer history.
- [ ] Keep `/favicon.ico` subject to the same cookie rule and never put the token into logs, rendered markup, local storage, or configuration.
- [ ] Run `npm test -- test/share-access.test.ts test/share-server.test.ts` and confirm all tests pass.
- [ ] Commit only the four task files with `feat: authenticate desktop Share access`.

### Task 3: Make desktop presentation an option on the shared renderer

**Files:**
- Modify: `src/server/share-server.ts`
- Modify: `src/server/page.ts`
- Modify: `src/i18n/locales/en.ts`
- Modify: `src/i18n/locales/zh-CN.ts`
- Modify: `test/share-server.test.ts`
- Modify: `test/i18n.test.ts`

- [ ] Add `surface?: "browser" | "desktop"` and `appVersion?: string` to `ShareServerOptions`; default the surface to `"browser"` and omit version copy on that surface.
- [ ] Add renderer contract tests. Desktop markup must contain stable `data-surface="desktop"` and `data-testid` anchors for `conversation-picker`, `refresh`, `turn-list`, `preview`, `redaction-toggle`, `copy-text`, `save-image`, `copy-image`, `settings`, and `empty-state`. It must not render raw session IDs, resume commands, ports, or the browser-only Done action.
- [ ] Preserve a browser-surface snapshot/anchor test proving the current CLI labels and Done action remain present.
- [ ] Add complete English and Simplified Chinese strings for:
  - Share conversation;
  - project and relative conversation labels;
  - Recheck;
  - Me, AI assistant, and Tool action;
  - Automatically hide possible secrets;
  - Copy text, Save image, and Copy image;
  - no-conversation, permission, startup, and image-only failure states;
  - Settings, Advanced, About, version, and download page.
- [ ] Run `npm test -- test/share-server.test.ts test/i18n.test.ts` and confirm failures identify the missing surface and strings.
- [ ] Pass a serializable `surface` value into the existing page builder. Use conditional labels and visibility within that builder; do not create `desktop-page.ts` or duplicate the Share state machine.
- [ ] Build friendly conversation labels from project basename, provider, and relative modification time. Retain the internal session ID only as an opaque value in application state; never place it in visible desktop text or accessibility labels.
- [ ] Put existing `toolDisplay` controls under a collapsed Advanced section on desktop. Keep redaction enabled by default and retain the existing two-step confirmation when disabled.
- [ ] Implement the nontechnical empty state: Airgap looks for Claude Code and Codex conversations on this Mac, does not upload them, requires no account, and offers Recheck.
- [ ] Represent discovery failures as typed provider/path errors. On desktop, name Claude Code or Codex plus the unreadable path and preserve the last successful selection during a failed Recheck; never change permissions or suggest running `chmod`.
- [ ] Render About with `appVersion` and only the two approved external-link targets: `https://github.com/kylvia/airgap` and `https://github.com/kylvia/airgap/releases`.
- [ ] Run the focused tests, then `npm test`, and confirm both surfaces pass.
- [ ] Commit only the six task files with `feat: add desktop Share surface`.

### Task 4: Extract export policy behind one adapter boundary

**Files:**
- Create: `src/server/share-export.ts`
- Create: `test/share-export.test.ts`
- Modify: `src/server/share-server.ts`
- Modify: `test/share-server.test.ts`

- [ ] Write adapter-first tests using a fake that records calls and never invokes Chrome, `osascript`, `pbcopy`, or the filesystem. Cover copy image, save image, copy text, save cancellation, capture failure, clipboard failure, and file-write failure.
- [ ] Add a security-order test that passes a detected secret and asserts the fake adapter receives only the redacted HTML/text. Add a blocked-export test that asserts the adapter receives no call.
- [ ] Run `npm test -- test/share-export.test.ts` and confirm failure because the adapter boundary does not exist.
- [ ] Introduce these contracts:

```ts
export interface SaveFileRequest {
  suggestedName: string;
  data: Buffer | string;
}

export interface ShareExportAdapter {
  renderPng(html: string): Promise<Buffer>;
  copyImage(png: Buffer): Promise<void>;
  copyText(text: string): Promise<void>;
  saveFile(request: SaveFileRequest): Promise<string | null>;
}

export interface ShareExportCoordinator {
  export(request: ExportRequest): Promise<ExportResult>;
  whenIdle(): Promise<void>;
}
```

- [ ] Move the current Chrome capture, macOS clipboard commands, and Desktop fallback save behavior into `createCliExportAdapter()`. Preserve byte-for-byte CLI output and existing platform guards.
- [ ] Make detection/redaction/rendering happen in the coordinator before invoking an adapter. Track only active explicit exports so `whenIdle()` can be used during desktop shutdown; settle it on both success and failure.
- [ ] Add `exportAdapter?: ShareExportAdapter` to `ShareServerOptions`; default to `createCliExportAdapter()` so the CLI requires no caller change.
- [ ] Route the existing export endpoint through the coordinator and retain distinct error codes for policy block, render, capture, clipboard, cancel, and save failures.
- [ ] Run `npm test -- test/share-export.test.ts test/share-server.test.ts`, then `npm run typecheck`.
- [ ] Commit only the four task files with `refactor: extract Share export adapters`.

### Task 5: Verify the shared-core milestone

**Files:**
- Verify all files changed in Tasks 1–4.

- [ ] Run `npm run typecheck` and confirm exit code 0.
- [ ] Run `npm test` and confirm the full suite passes.
- [ ] Run `npm run build` and confirm exit code 0.
- [ ] Run `git diff --check` and confirm no whitespace errors.
- [ ] Run `rg -n "process\.exit|10 \* 60 \* 1000|idleTimeoutMs" src/server test` and verify the server contains no process exit, the ten-minute default exists once, and tests cover both CLI and desktop policies.
- [ ] Review `git log --oneline -4` and `git status --short`; do not include unrelated documentation or user work.
- [ ] Acceptance result: one Share server implementation supports an unchanged ten-minute CLI lifecycle and a no-timeout, authenticated, adapter-driven desktop lifecycle.
