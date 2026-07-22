# Tool Display Tooltip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an accessible bilingual tooltip beside the Share Tool display setting that accurately explains Hidden, Summary, and Full.

**Architecture:** Render the tooltip server-side inside the existing settings popover. Use a semantic information button, `aria-describedby`, and pure CSS hover/`focus-within` visibility so the feature needs no new client-side state or API behavior.

**Tech Stack:** TypeScript ESM, server-rendered HTML/CSS, existing i18n dictionaries, inline SVG, Vitest.

---

### Task 1: Add the accessible localized tooltip

**Files:**
- Modify: `src/server/page.ts`
- Modify: `src/i18n/locales/zh-CN.ts`
- Modify: `src/i18n/locales/en.ts`
- Test: `test/share-server.test.ts`

- [ ] **Step 1: Write the failing renderer test**

Add this test under `describe("renderPage (share picker shell)")` in
`test/share-server.test.ts`:

```ts
it("renders an accessible bilingual Tool display tooltip", () => {
  const zh = renderPage(undefined, "summary", true, "zh-CN");
  expect(zh).toContain('id="tool-help-trigger"');
  expect(zh).toContain('type="button"');
  expect(zh).toContain('aria-label="工具展示说明"');
  expect(zh).toContain('aria-describedby="tool-help"');
  expect(zh).toContain('id="tool-help" role="tooltip"');
  expect(zh).toContain("完全不展示工具调用。");
  expect(zh).toContain("展示工具名、关键参数和执行状态。");
  expect(zh).toContain("富文本预览中展示输入与结果摘要；Markdown 和检索类工具仍使用摘要。");
  expect(zh).toContain(".tool-help-wrap:hover .tool-help-tooltip");
  expect(zh).toContain(".tool-help-wrap:focus-within .tool-help-tooltip");

  const en = renderPage(undefined, "summary", true, "en");
  expect(en).toContain('aria-label="About tool display"');
  expect(en).toContain("Omits tool calls completely.");
  expect(en).toContain("Shows the tool name, key argument, and execution status.");
  expect(en).toContain("Shows input and result excerpts in rich previews; Markdown and search tools still use summaries.");
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npx vitest run test/share-server.test.ts
```

Expected: FAIL because `tool-help-trigger`, the localized tooltip copy, and the
hover/focus selectors do not exist.

- [ ] **Step 3: Add the localized copy**

Add the following keys beside the existing `share.page.tool.*` keys in
`src/i18n/locales/zh-CN.ts`:

```ts
"share.page.toolHelpAria": "工具展示说明",
"share.page.toolHelp.none": "完全不展示工具调用。",
"share.page.toolHelp.summary": "展示工具名、关键参数和执行状态。",
"share.page.toolHelp.full": "富文本预览中展示输入与结果摘要；Markdown 和检索类工具仍使用摘要。",
```

Add the matching keys in `src/i18n/locales/en.ts`:

```ts
"share.page.toolHelpAria": "About tool display",
"share.page.toolHelp.none": "Omits tool calls completely.",
"share.page.toolHelp.summary": "Shows the tool name, key argument, and execution status.",
"share.page.toolHelp.full": "Shows input and result excerpts in rich previews; Markdown and search tools still use summaries.",
```

- [ ] **Step 4: Add the tooltip icon and markup**

Define an inline information mark beside `prefsMark` in `renderPage()`:

```ts
const infoMark = '<svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true"><circle cx="6" cy="6" r="4.8" stroke="currentColor"/><path d="M6 5.3v3" stroke="currentColor" stroke-linecap="round"/><circle cx="6" cy="3.6" r=".55" fill="currentColor"/></svg>';
```

Replace only the Tool display row in `src/server/page.ts` with:

```ts
<div class="prow">
  <span class="pref-label">
    <span>${escapeHtml(t("share.page.toolDisplay"))}</span>
    <span class="tool-help-wrap">
      <button type="button" id="tool-help-trigger" class="tool-help-trigger" aria-label="${escapeHtml(t("share.page.toolHelpAria"))}" aria-describedby="tool-help">${infoMark}</button>
      <span id="tool-help" role="tooltip" class="tool-help-tooltip">
        <span><strong>${escapeHtml(t("share.page.tool.none"))}</strong> ${escapeHtml(t("share.page.toolHelp.none"))}</span>
        <span><strong>${escapeHtml(t("share.page.tool.summary"))}</strong> ${escapeHtml(t("share.page.toolHelp.summary"))}</span>
        <span><strong>${escapeHtml(t("share.page.tool.full"))}</strong> ${escapeHtml(t("share.page.toolHelp.full"))}</span>
      </span>
    </span>
  </span>
  <select id="tools">${toolsOptions}</select>
</div>
```

Do not change the `#tools` select, its options, or its change handler.

- [ ] **Step 5: Add token-only tooltip styling**

Add these rules after the existing `#prefpanel .prow` rules:

```css
#prefpanel .pref-label { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
#prefpanel .tool-help-wrap { position: relative; display: inline-flex; }
#prefpanel .tool-help-trigger { width: 17px; height: 17px; display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid var(--border); border-radius: 50%; background: var(--bg); color: var(--fg-muted); cursor: help; }
#prefpanel .tool-help-trigger:hover { border-color: var(--border-strong); color: var(--fg); background: var(--bg-hover); }
#prefpanel .tool-help-trigger:focus-visible { outline: none; box-shadow: var(--focus-ring); }
#prefpanel .tool-help-tooltip { visibility: hidden; position: absolute; top: calc(100% + 7px); right: -4px;
  z-index: 30; width: 310px; padding: 9px 11px; background: var(--bg); color: var(--fg);
  border: 1px solid var(--border-strong); border-radius: var(--radius-card); font-size: 12px; line-height: 1.55;
  white-space: normal; }
#prefpanel .tool-help-tooltip > span { display: block; }
#prefpanel .tool-help-tooltip > span + span { margin-top: 5px; }
#prefpanel .tool-help-tooltip strong { font-weight: 600; }
#prefpanel .tool-help-wrap:hover .tool-help-tooltip,
#prefpanel .tool-help-wrap:focus-within .tool-help-tooltip { visibility: visible; }
```

The rules deliberately avoid hard-coded colors, opacity transitions,
backdrop filters, and JavaScript-controlled classes.

- [ ] **Step 6: Run focused tests and typecheck**

Run:

```bash
npx vitest run test/share-server.test.ts test/i18n.test.ts
npm run typecheck
```

Expected: both test files PASS; TypeScript emits no diagnostics. Existing
Dossier tests still confirm token colors, no backdrop filter, and no emoji.

- [ ] **Step 7: Commit the tooltip feature**

```bash
git add src/server/page.ts src/i18n/locales/zh-CN.ts src/i18n/locales/en.ts test/share-server.test.ts
git commit -m "feat: explain tool display options"
```

### Task 2: Verify the complete change

**Files:**
- Verify only; no new files expected

- [ ] **Step 1: Run the full verification set**

Run each command independently:

```bash
npm test
npm run typecheck
npm run build
git diff --check
```

Expected: all commands exit 0; Vitest reports no failed tests; TypeScript emits
no diagnostics; `tsup` builds `dist/index.js`; `git diff --check` is silent.

- [ ] **Step 2: Inspect scope and history**

Run:

```bash
git status --short
git log -3 --oneline
git diff 27342b2...HEAD --stat
```

Expected: the worktree is clean; history contains the tooltip design, plan, and
feature commits; the tooltip range contains two documentation files and the
four implementation/test files listed in Task 1.

- [ ] **Step 3: Record the verification receipt in the handoff**

Report the exact test count, typecheck/build results, final feature commit, and
the worktree path. Do not create a receipt file, start another service, or alter
unrelated documentation.
