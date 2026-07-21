# Share Tool Display Default Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make unconfigured desktop and browser Share sessions hide tool calls by default while preserving saved preferences and the CLI `show` default of `summary`.

**Architecture:** Add a Share-specific default in the configuration layer instead of changing the global renderer default. Keep `renderPage()` consistent with that Share default for direct calls; all explicit values and existing persistence paths remain unchanged.

**Tech Stack:** TypeScript, Commander, Vitest, tsup, Electron workspace

---

## File map

- Modify `src/config.ts`: own and apply the Share-specific tool-display default.
- Modify `src/server/page.ts`: make the standalone Share page renderer default to hidden tools.
- Modify `test/config.test.ts`: cover missing, invalid, and saved Share preferences while pinning the global renderer default.
- Modify `test/share-server.test.ts`: cover the generated page's default and explicit tool selections.

### Task 1: Give Share its own hidden-tools configuration default

**Files:**
- Modify: `test/config.test.ts:5-13,182-190`
- Modify: `src/config.ts:5-7,27,70-72`

- [ ] **Step 1: Write the failing configuration test**

Add `DEFAULT_SHARE_TOOL_DISPLAY` to the imports from `src/config.ts`, keep importing `DEFAULT_TOOL_DISPLAY` from `src/types.ts`, and replace the existing `share.toolDisplay` case with:

```ts
describe("share.toolDisplay 加载", () => {
  it("合法值生效，非法值与缺失值回退 Share 默认，且不改变通用默认", async () => {
    expect(DEFAULT_SHARE_TOOL_DISPLAY).toBe("none");
    expect(DEFAULT_TOOL_DISPLAY).toBe("summary");
    expect(shareToolDisplay(await loadConfig(await homeWith('{"share":{"toolDisplay":"none"}}')))).toBe("none");
    expect(shareToolDisplay(await loadConfig(await homeWith('{"share":{"toolDisplay":"full"}}')))).toBe("full");
    expect(shareToolDisplay(await loadConfig(await homeWith('{"share":{"toolDisplay":"summary"}}')))).toBe("summary");
    expect(shareToolDisplay(await loadConfig(await homeWith('{"share":{"toolDisplay":"bogus"}}')))).toBe(
      DEFAULT_SHARE_TOOL_DISPLAY,
    );
    expect(shareToolDisplay(await loadConfig(await homeWith(null)))).toBe(DEFAULT_SHARE_TOOL_DISPLAY);
  });
});
```

- [ ] **Step 2: Run the focused test and verify the new contract fails**

Run:

```bash
npm test -- test/config.test.ts
```

Expected: FAIL because `src/config.ts` does not yet export `DEFAULT_SHARE_TOOL_DISPLAY` and missing/invalid Share configuration still resolves to `summary`.

- [ ] **Step 3: Implement the Share-specific default**

In `src/config.ts`, stop importing `DEFAULT_TOOL_DISPLAY`, add the Share-owned constant beside the session-list default, and use it in `shareToolDisplay()`:

```ts
import { TOOL_DISPLAYS } from "./types.js";

export const DEFAULT_SESSION_LIST_LIMIT = 20;
export const DEFAULT_SHARE_TOOL_DISPLAY: ToolDisplay = "none";

export function shareToolDisplay(cfg: AirgapConfig): ToolDisplay {
  return cfg.share?.toolDisplay ?? DEFAULT_SHARE_TOOL_DISPLAY;
}
```

Do not write the default into `~/.airgap/config.json`; `loadConfig()` must continue returning `{}` when the file is absent.

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
npm test -- test/config.test.ts
```

Expected: all `test/config.test.ts` cases PASS, including saved `summary`/`full`, invalid fallback to `none`, and global `DEFAULT_TOOL_DISPLAY === "summary"`.

- [ ] **Step 5: Commit the configuration behavior**

```bash
git add src/config.ts test/config.test.ts
git commit -m "feat: hide tools by default in Share config"
```

### Task 2: Align the standalone Share page renderer

**Files:**
- Modify: `test/share-server.test.ts:448-452`
- Modify: `src/server/page.ts:20-25`

- [ ] **Step 1: Write the failing page-renderer test**

Replace the existing default-browser equality test with:

```ts
it("defaults Share pages to hidden tools while preserving explicit summary", () => {
  const defaultPage = renderPage();
  const summaryPage = renderPage(undefined, "summary");

  expect(defaultPage).toBe(renderPage(undefined, "none", true, "zh-CN", "zh-CN", "browser", "9.9.9"));
  expect(defaultPage).toContain('<option value="none" selected>');
  expect(summaryPage).toContain('<option value="summary" selected>');
  expect(defaultPage).toContain('id="done"');
  expect(defaultPage).toContain("claude --resume");
  expect(defaultPage).not.toContain("9.9.9");
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npm test -- test/share-server.test.ts
```

Expected: FAIL because `renderPage()` still selects `summary` when the caller omits `toolDisplay`.

- [ ] **Step 3: Change only the renderer's Share default**

In `src/server/page.ts`, change the parameter default and leave all explicit call paths untouched:

```ts
export function renderPage(
  defaultSession?: string,
  toolDisplay = "none",
  isMac = true,
  locale: Locale = "zh-CN",
  languagePreference: LanguagePreference = locale,
  surface: ShareSurface = "browser",
  appVersion?: string,
): string {
```

- [ ] **Step 4: Run both focused suites and verify they pass**

Run:

```bash
npm test -- test/config.test.ts test/share-server.test.ts
```

Expected: both suites PASS; direct Share rendering selects hidden tools, explicit `summary` still selects summary, and persisted config behavior remains intact.

- [ ] **Step 5: Commit the page behavior**

```bash
git add src/server/page.ts test/share-server.test.ts
git commit -m "fix: align Share page with hidden tool default"
```

### Task 3: Verify the complete product boundary

**Files:**
- Verify only; no planned source changes.

- [ ] **Step 1: Run core checks**

```bash
npm test
npm run typecheck
npm run build
```

Expected: the full Vitest suite passes, TypeScript exits 0, and tsup produces the CLI bundle.

- [ ] **Step 2: Verify the CLI `show` default did not change**

```bash
node dist/index.js show --help
```

Expected: the `--tools <level>` help line still includes `default: summary`.

- [ ] **Step 3: Run desktop checks**

```bash
npm run desktop:test
npm run desktop:build
```

Expected: all desktop tests pass and the Electron main/preload/renderer build exits 0. Do not start the desktop application.

- [ ] **Step 4: Inspect the publish boundary and diff hygiene**

```bash
npm pack --dry-run --json
git diff --check
git status --short
```

Expected: the npm package contains only the existing CLI publication surface (`dist`, both READMEs, `LICENSE`, and package metadata), excludes `apps/desktop`, `git diff --check` prints nothing, and status contains no uncommitted task files.
