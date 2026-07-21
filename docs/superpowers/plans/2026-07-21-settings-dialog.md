# Airgap Share Settings Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the shared Share settings popover with one accessible centered modal dialog on both the browser and desktop surfaces.

**Architecture:** Keep `renderPage()` as the single UI source and retain the existing `prefpanel` ID and settings handlers. Replace only the container, presentation, and open/close state machine with native `<dialog>` behavior; extend the existing isolated Electron smoke harness to verify the real modal interaction.

**Tech Stack:** TypeScript, server-rendered HTML/CSS/JavaScript, native HTML `<dialog>`, Vitest, Electron 43.

---

## File map

- `src/server/page.ts`: render the shared dialog, centered styles, and accessible open/close behavior.
- `src/i18n/locales/en.ts`: English close-settings label.
- `src/i18n/locales/zh-CN.ts`: Simplified Chinese close-settings label.
- `test/share-server.test.ts`: renderer structure and interaction contract tests for both surfaces.
- `test/i18n.test.ts`: ensure the new label exists in both catalogs.
- `apps/desktop/src/smoke.ts`: exercise the dialog in a real sandboxed Electron renderer and record only booleans/events.
- `apps/desktop/test/desktop-smoke.test.ts`: assert the new smoke result fields and lifecycle event.

### Task 1: Replace the shared popover with a native dialog

**Files:**
- Modify: `test/share-server.test.ts`
- Modify: `test/i18n.test.ts`
- Modify: `src/i18n/locales/en.ts`
- Modify: `src/i18n/locales/zh-CN.ts`
- Modify: `src/server/page.ts`

- [ ] **Step 1: Write failing renderer tests**

Add a renderer test next to the existing Share shell tests. It must exercise both surfaces and assert the desired semantic container and controls:

```ts
it("renders settings as one accessible modal dialog on both surfaces", () => {
  for (const surface of ["browser", "desktop"] as const) {
    const rendered = renderPage(undefined, "summary", true, "en", "en", surface, "0.3.0");
    expect(rendered).toContain('<dialog id="prefpanel" tabindex="-1" aria-labelledby="settings-title">');
    expect(rendered).toContain('<h2 id="settings-title">Settings</h2>');
    expect(rendered).toContain('id="prefclose"');
    expect(rendered).toContain('aria-label="Close settings"');
    expect(rendered).toContain('aria-expanded="false" aria-controls="prefpanel"');
  }
});
```

Replace the old desktop-only settings-state assertions with the native-dialog contract:

```ts
it("opens and closes the modal while restoring settings-button focus", () => {
  expect(page).toContain("function openPreferences() {");
  expect(page).toContain("panel.showModal()");
  expect(page).toContain("panel.focus()");
  expect(page).toContain('button.setAttribute("aria-expanded", "true")');
  expect(page).toContain("function closePreferences() {");
  expect(page).toContain("if (panel.open) panel.close()");
  expect(page).toContain('$("prefclose").onclick = closePreferences');
  expect(page).toContain("if (event.target === panel) closePreferences()");
  expect(page).toContain('panel.addEventListener("close", () => {');
  expect(page).toContain('button.setAttribute("aria-expanded", "false")');
  expect(page).toContain("button.focus()");
  expect(page).not.toContain("setPreferencesOpen(");
  expect(page).not.toContain('document.addEventListener("click"');
});
```

Extend the desktop copy list in `test/i18n.test.ts` with the shared label and assert its translations:

```ts
expect(en.t("share.page.closeSettings")).toBe("Close settings");
expect(zh.t("share.page.closeSettings")).toBe("关闭设置");
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```sh
npx vitest run test/share-server.test.ts test/i18n.test.ts
```

Expected: FAIL because the page still renders `<div id="prefpanel" hidden>`, has no `prefclose`, and the catalogs do not contain `share.page.closeSettings`.

- [ ] **Step 3: Add the two localized close labels**

Add the same key to both locale catalogs near the existing settings label:

```ts
// src/i18n/locales/en.ts
"share.page.closeSettings": "Close settings",

// src/i18n/locales/zh-CN.ts
"share.page.closeSettings": "关闭设置",
```

- [ ] **Step 4: Render one dialog structure for both surfaces**

In `src/server/page.ts`, derive the title once and replace both old `prefpanel` wrappers with a shared dialog shell. Keep the existing per-surface contents unchanged inside `settingsBody`:

```ts
const settingsTitle = t(isDesktop ? "share.desktop.settings" : "share.page.settings");
const settingsBody = isDesktop
  ? `<div class="prow"><span>${escapeHtml(t("share.page.language"))}</span><select id="language" aria-label="${escapeHtml(t("share.page.language"))}">${languageOptions}</select></div>
    <details><summary>${escapeHtml(t("share.desktop.advanced"))}</summary>
      <div class="prow"><span>${escapeHtml(t("share.desktop.conversationList"))}</span><select id="limit" aria-label="${escapeHtml(t("share.desktop.sessionListLabel"))}">
        <option value="10">${escapeHtml(t("share.page.recent", { count: 10 }))}</option>
        <option value="20">${escapeHtml(t("share.page.recent", { count: 20 }))}</option>
        <option value="50">${escapeHtml(t("share.page.recent", { count: 50 }))}</option>
      </select></div>
      <div class="prow"><span>${escapeHtml(t("share.page.toolDisplay"))}</span><select id="tools" aria-label="${escapeHtml(t("share.desktop.toolDisplayLabel"))}">${toolsOptions}</select></div>
    </details>
    <section class="about" aria-label="${escapeHtml(t("share.desktop.about"))}">
      <h2>${escapeHtml(t("share.desktop.about"))}</h2>
      ${appVersion ? `<p>${escapeHtml(t("share.desktop.version", { version: appVersion }))}</p>` : ""}
      <p><a href="https://github.com/kylvia/airgap" target="_blank" rel="noreferrer">${escapeHtml(t("share.desktop.repository"))}</a></p>
      <p><a href="https://github.com/kylvia/airgap/releases" target="_blank" rel="noreferrer">${escapeHtml(t("share.desktop.downloadPage"))}</a></p>
    </section>`
  : `<div class="prow"><span>${escapeHtml(t("share.page.sessionList"))}</span><select id="limit">
      <option value="10">${escapeHtml(t("share.page.recent", { count: 10 }))}</option>
      <option value="20">${escapeHtml(t("share.page.recent", { count: 20 }))}</option>
      <option value="50">${escapeHtml(t("share.page.recent", { count: 50 }))}</option>
    </select></div>
    <div class="prow"><span>${escapeHtml(t("share.page.toolDisplay"))}</span><select id="tools">${toolsOptions}</select></div>
    <div class="prow"><span>${escapeHtml(t("share.page.language"))}</span><select id="language">${languageOptions}</select></div>`;
const settingsMarkup = `<dialog id="prefpanel" tabindex="-1" aria-labelledby="settings-title">
  <div class="settings-sheet">
    <div class="settings-head">
      <h2 id="settings-title">${escapeHtml(settingsTitle)}</h2>
      <button type="button" id="prefclose" aria-label="${escapeHtml(t("share.page.closeSettings"))}">${escapeHtml(t("share.page.closeSettings"))}</button>
    </div>
    ${settingsBody}
  </div>
</dialog>`;
```

Give the settings button the same state contract on both surfaces:

```ts
<button id="prefs"${testId("settings")} aria-expanded="false" aria-controls="prefpanel" ...>
```

- [ ] **Step 5: Replace popover CSS with centered modal CSS**

Replace the old absolute positioning and hidden selector with a solid, compact dialog and backdrop:

```css
#prefpanel { width: min(440px, calc(100vw - 32px)); max-height: min(680px, calc(100vh - 32px));
  margin: auto; padding: 0; overflow: auto; color: var(--fg); background: var(--bg);
  border: 1px solid var(--border-strong); border-radius: var(--radius-card); }
#prefpanel:not([open]) { display: none; }
#prefpanel::backdrop { background: rgba(26, 24, 20, 0.28); }
#prefpanel .settings-sheet { padding: 18px 20px 20px; }
#prefpanel .settings-head { display: flex; align-items: center; justify-content: space-between;
  gap: 20px; padding-bottom: 12px; border-bottom: 1px solid var(--border-subtle); }
#prefpanel .settings-head h2 { font-family: var(--font-serif); font-size: 21px; font-weight: 600;
  letter-spacing: -0.02em; }
#prefpanel #prefclose { border: 0; border-radius: var(--radius-button); padding: 6px 8px;
  background: transparent; color: var(--fg-muted); font: 500 12px var(--font-sans); cursor: pointer; }
#prefpanel #prefclose:hover { color: var(--fg); background: var(--bg-hover); }
#prefpanel #prefclose:focus-visible { outline: none; box-shadow: var(--focus-ring); }
#prefpanel .prow { display: flex; align-items: center; justify-content: space-between; gap: 18px;
  min-height: 48px; }
#prefpanel .prow + .prow { border-top: 1px solid var(--border-subtle); }
```

Remove the desktop `width: 310px` override. Keep the existing desktop `details` and `.about` rules, but scope the title rule to `.settings-head h2` so the About heading retains its intended hierarchy.

- [ ] **Step 6: Replace the popover state machine with native dialog operations**

Replace `setPreferencesOpen()` and the document click/keydown listeners with:

```js
const preferencesPanel = $("prefpanel");
const preferencesButton = $("prefs");

function openPreferences() {
  if (preferencesPanel.open || interactionBusy()) return;
  preferencesPanel.showModal();
  preferencesButton.setAttribute("aria-expanded", "true");
  preferencesPanel.focus();
}

function closePreferences() {
  if (preferencesPanel.open) preferencesPanel.close();
}

preferencesButton.onclick = openPreferences;
$("prefclose").onclick = closePreferences;
preferencesPanel.onclick = (event) => {
  if (event.target === preferencesPanel) closePreferences();
};
preferencesPanel.addEventListener("close", () => {
  preferencesButton.setAttribute("aria-expanded", "false");
  preferencesButton.focus();
});
```

Do not add an Escape key handler: native modal dialogs emit `cancel`, close, and then trigger the shared `close` listener.

- [ ] **Step 7: Run focused and full shared-page tests and verify GREEN**

Run:

```sh
npx vitest run test/share-server.test.ts test/i18n.test.ts
npm run typecheck
```

Expected: both commands exit 0; all selected tests pass with no warnings.

- [ ] **Step 8: Commit the shared dialog implementation**

```sh
git add src/server/page.ts src/i18n/locales/en.ts src/i18n/locales/zh-CN.ts test/share-server.test.ts test/i18n.test.ts
git commit -m "feat: show Share settings in a dialog"
```

### Task 2: Verify the dialog in the real Electron smoke flow

**Files:**
- Modify: `apps/desktop/test/desktop-smoke.test.ts`
- Modify: `apps/desktop/src/smoke.ts`

- [ ] **Step 1: Add failing real-smoke assertions**

In `apps/desktop/test/desktop-smoke.test.ts`, extend the expected result:

```ts
expect(result).toMatchObject({
  ok: true,
  settingsDialogOpened: true,
  settingsDialogClosed: true,
  settingsFocusRestored: true,
});
```

Add the three keys to the exact result-key assertion, and insert `"settings-dialog"` after `"authenticated"` in the expected lifecycle events.

- [ ] **Step 2: Run the real smoke test and verify RED**

Run on Apple Silicon macOS:

```sh
AIRGAP_RUN_ELECTRON_SMOKE=1 npm run desktop:test -- desktop-smoke.test.ts
```

Expected: FAIL because the smoke result has no settings-dialog booleans or lifecycle event yet. The spawned Electron PID must still exit through the test's existing `finally` cleanup.

- [ ] **Step 3: Extend the smoke result without recording UI text**

Add these booleans to `DesktopSmokeResult` and initialize them to false in `createInitialResult()`:

```ts
settingsDialogOpened: boolean;
settingsDialogClosed: boolean;
settingsFocusRestored: boolean;
```

Immediately after the authenticated step in `runDesktopSmoke()`, execute the real renderer interaction:

```ts
stage = "settings-dialog";
const settingsState = await dependencies.window.webContents.executeJavaScript<{
  opened: boolean;
  closed: boolean;
  focusRestored: boolean;
}>(`(() => {
  const button = document.querySelector('[data-testid="settings"]');
  const panel = document.getElementById('prefpanel');
  if (!(button instanceof HTMLButtonElement) || !(panel instanceof HTMLDialogElement)) {
    return { opened: false, closed: false, focusRestored: false };
  }
  button.click();
  const opened = panel.open && document.activeElement === panel;
  panel.click();
  return {
    opened,
    closed: !panel.open,
    focusRestored: document.activeElement === button,
  };
})()`);
result.settingsDialogOpened = settingsState.opened;
result.settingsDialogClosed = settingsState.closed;
result.settingsFocusRestored = settingsState.focusRestored;
if (!settingsState.opened || !settingsState.closed || !settingsState.focusRestored) {
  throw new Error("settings dialog check failed");
}
result.lifecycleEvents.push("settings-dialog");
```

This records only booleans and a fixed lifecycle label; it never returns setting values, conversation text, paths, IDs, or the capability token.

- [ ] **Step 4: Run the normal and real Electron tests and verify GREEN**

Run:

```sh
npm run desktop:test -- desktop-smoke.test.ts
AIRGAP_RUN_ELECTRON_SMOKE=1 npm run desktop:test -- desktop-smoke.test.ts
```

Expected: normal run passes two gate tests and skips the real GUI test; explicit run passes all three tests and exits within 30 seconds.

- [ ] **Step 5: Commit the smoke coverage**

```sh
git add apps/desktop/src/smoke.ts apps/desktop/test/desktop-smoke.test.ts
git commit -m "test: cover settings dialog in desktop smoke"
```

### Task 3: Final regression verification

**Files:**
- Verify only; no source changes expected.

- [ ] **Step 1: Run all repository checks**

Run:

```sh
npm run typecheck
npm test
npm run build
npm run desktop:test
npm run desktop:build
```

Expected: every command exits 0. The two explicit Electron integration tests remain skipped in the default suites.

- [ ] **Step 2: Check packaging and worktree hygiene**

Run:

```sh
npm pack --dry-run --json
git diff --check
git status --short
```

Expected: the npm tarball contains only the CLI files already allowed by root `package.json`; it contains no Electron, Forge, `apps/desktop`, or desktop assets. `git diff --check` emits nothing, and `git status --short` is empty after the two task commits.
