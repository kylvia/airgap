# Share Language Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent, immediately applied Follow system / Simplified Chinese / English selector to the Share settings panel while keeping page, API, preview, and export locale consistent.

**Architecture:** The top-level config language preference remains the persistent truth, while the running Share server owns a mutable locale snapshot. The config API validates and persists a preference before mutating runtime state; the browser reloads only after success so every server-rendered and client-injected string changes together.

**Tech Stack:** TypeScript, Node.js HTTP/fs APIs, Commander, server-rendered HTML/JavaScript, Vitest; no new dependencies.

---

### Task 1: Language preference model and atomic config persistence

**Files:**
- Modify: `src/i18n/types.ts`
- Modify: `src/i18n/resolve.ts`
- Modify: `src/i18n/index.ts`
- Modify: `src/config.ts`
- Test: `test/i18n.test.ts`
- Test: `test/config.test.ts`

- [ ] **Step 1: Write failing preference-resolution and config tests**

Add tests that define the public behavior:

```ts
expect(languagePreferenceFromSelection({
  locale: "zh-CN",
  source: "macOS AppleLanguages",
  detectedLocale: "zh-Hans-CN",
})).toBe("auto");
expect(languagePreferenceFromSelection({
  locale: "en",
  source: "--lang",
  detectedLocale: "en",
})).toBe("en");
expect(languagePreferenceFromSelection({
  locale: "zh-CN",
  source: "config.language",
  detectedLocale: "zh-CN",
})).toBe("zh-CN");
```

In `test/config.test.ts`, use the existing temporary home helper and assert:

```ts
const home = await homeWith('{"future":{"keep":true},"share":{"toolDisplay":"full"}}');
expect(await updateConfig({ language: "zh-CN" }, home)).toMatchObject({ language: "zh-CN" });
expect(await loadConfig(home)).toEqual({ language: "zh-CN", share: { toolDisplay: "full" } });

await updateConfig({ language: "auto" }, home);
const raw = JSON.parse(await readFile(path.join(home, ".airgap", "config.json"), "utf8"));
expect(raw).toEqual({ future: { keep: true }, share: { toolDisplay: "full" } });

await expect(updateConfig({ language: "fr" as never }, home)).rejects.toThrow(/language/);
```

Also assert a combined `{ language, sessionListLimit, toolDisplay }` patch is written in one file update, and malformed JSON is left byte-for-byte unchanged.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run:

```sh
npm test -- test/i18n.test.ts test/config.test.ts
```

Expected: failures because `LanguagePreference`, `languagePreferenceFromSelection()`, and `updateConfig()` do not exist.

- [ ] **Step 3: Implement the preference type and source mapping**

In `src/i18n/types.ts` add:

```ts
export type LanguagePreference = "auto" | Locale;
export const LANGUAGE_PREFERENCES = ["auto", "en", "zh-CN"] as const;
```

In `src/i18n/resolve.ts` add:

```ts
const EXPLICIT_LOCALE_SOURCES = new Set(["--lang", "AIRGAP_LANG", "config.language"]);

export function languagePreferenceFromSelection(selection: LocaleSelection): LanguagePreference {
  return EXPLICIT_LOCALE_SOURCES.has(selection.source) ? selection.locale : "auto";
}
```

Export the new function and types from `src/i18n/index.ts`.

- [ ] **Step 4: Implement one atomic config updater**

In `src/config.ts`, define:

```ts
export interface ConfigPatch {
  language?: LanguagePreference;
  sessionListLimit?: number;
  toolDisplay?: ToolDisplay;
}

export interface ConfigUpdateResult {
  language: LanguagePreference;
  sessionListLimit: number;
  toolDisplay: ToolDisplay;
}
```

Extract the existing safe read-modify-write flow into `updateConfig(patch, home)`. Validate language against `LANGUAGE_PREFERENCES`; delete `raw.language` for `auto`, otherwise assign the explicit locale. Merge Share keys exactly as today, preserve unknown keys, write once, and return all three effective values. Keep `updateShareConfig()` as a compatibility wrapper that calls `updateConfig()` and returns only `{ sessionListLimit, toolDisplay }`, so existing callers and exact-object tests remain stable.

Use this explicit mutation order:

```ts
if (patch.language === "auto") delete raw["language"];
else if (patch.language !== undefined) raw["language"] = patch.language;

if (out.sessionListLimit !== undefined || out.toolDisplay !== undefined) {
  raw["share"] = { ...(asRecord(raw["share"]) ?? {}), ...out };
}
```

- [ ] **Step 5: Run tests and confirm GREEN**

Run:

```sh
npm test -- test/i18n.test.ts test/config.test.ts
npm run typecheck
```

Expected: all focused tests pass and TypeScript exits 0.

- [ ] **Step 6: Commit Task 1**

```sh
git add src/i18n/types.ts src/i18n/resolve.ts src/i18n/index.ts src/config.ts test/i18n.test.ts test/config.test.ts
git commit -m "feat: persist share language preference"
```

### Task 2: Settings-panel language selector

**Files:**
- Modify: `src/server/page.ts`
- Modify: `src/i18n/locales/en.ts`
- Modify: `src/i18n/locales/zh-CN.ts`
- Test: `test/share-server.test.ts`

- [ ] **Step 1: Write failing rendered-page tests**

Extend `renderPage internationalization` tests:

```ts
const page = renderPage(undefined, "summary", true, "en", "auto");
expect(page).toContain('id="language"');
expect(page).toMatch(/<option value="auto" selected>Follow system<\/option>/);
expect(page).toContain('<option value="zh-CN">Simplified Chinese</option>');
expect(page).toContain('<option value="en">English</option>');
expect(page).toContain('JSON.stringify({ language: $("language").value })');
expect(page).toContain("window.location.reload()");
expect(page).toContain('$("language").value = LANGUAGE_PREFERENCE');
```

Add a Chinese selected-state assertion with `renderPage(undefined, "summary", true, "zh-CN", "zh-CN")`.

- [ ] **Step 2: Run the page test and confirm RED**

Run:

```sh
npm test -- test/share-server.test.ts
```

Expected: assertions fail because the selector and messages are absent.

- [ ] **Step 3: Add catalog entries and render the selector**

Add matching keys to both catalogs:

```ts
"share.page.language": "Language",
"share.page.language.auto": "Follow system",
"share.page.language.en": "English",
"share.page.language.zhCN": "Simplified Chinese",
"share.page.languageSaveFailed": "Could not save the language",
"share.api.configLanguage": "language accepts only {values}",
```

Use these exact Chinese values in `zh-CN.ts`:

```ts
"share.page.language": "语言",
"share.page.language.auto": "跟随系统",
"share.page.language.en": "英文",
"share.page.language.zhCN": "简体中文",
"share.page.languageSaveFailed": "语言保存失败",
"share.api.configLanguage": "language 只接受 {values}",
```

Extend `renderPage()` with a final parameter:

```ts
languagePreference: LanguagePreference = locale
```

Generate escaped options for `auto`, `zh-CN`, and `en`, inject `const LANGUAGE_PREFERENCE`, render the third `.prow`, and add this handler:

```js
$("language").onchange = async () => {
  const r = await fetch("/api/config", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ language: $("language").value }),
  });
  const res = await r.json().catch(() => ({ ok: false, message: msg("share.page.languageSaveFailed") }));
  if (!res.ok) {
    $("language").value = LANGUAGE_PREFERENCE;
    setStatus(res.message || msg("share.page.languageSaveFailed"), true);
    return;
  }
  window.location.reload();
};
```

- [ ] **Step 4: Run the page and catalog tests and confirm GREEN**

Run:

```sh
npm test -- test/share-server.test.ts test/i18n.test.ts
```

Expected: rendered-page assertions pass and English/Chinese catalog keys still match.

- [ ] **Step 5: Commit Task 2**

```sh
git add src/server/page.ts src/i18n/locales/en.ts src/i18n/locales/zh-CN.ts test/share-server.test.ts
git commit -m "feat: add share language selector"
```

### Task 3: Live server locale switching and config API

**Files:**
- Modify: `src/server/share-server.ts`
- Test: `test/share-server.test.ts`

- [ ] **Step 1: Write failing server integration tests**

Create a temporary config home per test and start the server with injectable state:

```ts
const server = await startShareServer({
  locale: "en",
  languagePreference: "en",
  configHome: home,
  systemLocaleDetector: async () => ({ locale: "en-US", source: "test system" }),
});
```

Assert the following sequence through real HTTP calls:

```ts
const switched = await fetch(new URL("/api/config", server.url), {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ language: "zh-CN" }),
});
expect(await switched.json()).toMatchObject({ ok: true, language: "zh-CN", locale: "zh-CN" });
expect(await fetch(server.url).then((r) => r.text())).toContain('lang="zh-CN"');
expect(await fetch(new URL("/missing", server.url)).then((r) => r.json())).toEqual({
  code: "NOT_FOUND",
  message: "未找到",
});
```

Then POST `{ language: "auto" }`, assert the injected detector is used, the response locale changes to `en`, and the persisted file no longer has a top-level `language` key. Add separate cases for `language: "fr"` returning `400 INVALID_LANGUAGE`, and malformed config returning `500` while subsequent page/404 responses stay in the original locale.

- [ ] **Step 2: Run the server tests and confirm RED**

Run:

```sh
npm test -- test/share-server.test.ts
```

Expected: failures because server options, language validation, and runtime mutation are absent.

- [ ] **Step 3: Add runtime language state and request snapshots**

Define and export a `ShareServerOptions` interface with:

```ts
port?: number;
defaultSession?: string;
locale?: Locale;
languagePreference?: LanguagePreference;
configHome?: string;
systemLocaleDetector?: () => Promise<SystemLocaleResult>;
```

Initialize mutable server state:

```ts
let locale = opts.locale ?? "zh-CN";
let i18n = createI18n(locale);
let languagePreference = opts.languagePreference ?? locale;
const systemLocaleDetector = opts.systemLocaleDetector ?? detectSystemLocale;
```

In the `createServer()` callback, snapshot `const requestLocale = locale` and `const requestI18n = i18n`, pass both into `handle(req, res, requestLocale, requestI18n)`, and use `requestI18n` in the outer rejection handler. Change `handle()` to accept those snapshots and use them for the whole request, including error paths, rendering, session detail, and export.

- [ ] **Step 4: Extend `/api/config` atomically**

Parse `language` with the existing Share fields. Reject values outside `LANGUAGE_PREFERENCES` with the request translator. If present, resolve the next locale before persistence:

```ts
const nextLocale = patch.language === "auto"
  ? resolveLocale({ system: (await systemLocaleDetector()).locale })
  : patch.language ?? locale;
const saved = await updateConfig(patch, opts.configHome);
listLimit = saved.sessionListLimit;
toolDisplay = saved.toolDisplay;
languagePreference = saved.language;
locale = nextLocale;
i18n = createI18n(locale);
sendJson(res, 200, { ok: true, limit: listLimit, toolDisplay, language: languagePreference, locale });
```

Pass `opts.configHome` to startup config loading and pass `languagePreference` into `renderPage()`. Keep mutation after the awaited write so a failed write leaves runtime state unchanged.

- [ ] **Step 5: Run server tests and confirm GREEN**

Run:

```sh
npm test -- test/share-server.test.ts test/config.test.ts test/i18n.test.ts
npm run typecheck
```

Expected: explicit, auto, invalid, and failed-save cases pass; TypeScript exits 0.

- [ ] **Step 6: Commit Task 3**

```sh
git add src/server/share-server.ts test/share-server.test.ts
git commit -m "feat: switch share locale at runtime"
```

### Task 4: Startup wiring and documentation

**Files:**
- Modify: `src/index.ts`
- Modify: `src/commands/share.ts`
- Modify: `test/share-command.test.ts`
- Modify: `README.md`
- Modify: `README.zh-CN.md`

- [ ] **Step 1: Write a failing startup-preference test**

In `test/share-command.test.ts`, add a pure options assertion around an exported helper:

```ts
expect(shareLanguageOptions({ locale: "zh-CN", source: "macOS AppleLanguages", detectedLocale: "zh-Hans-CN" })).toEqual({
  locale: "zh-CN",
  languagePreference: "auto",
});
expect(shareLanguageOptions({ locale: "en", source: "AIRGAP_LANG", detectedLocale: "en" })).toEqual({
  locale: "en",
  languagePreference: "en",
});
```

- [ ] **Step 2: Run the command test and confirm RED**

Run:

```sh
npm test -- test/share-command.test.ts
```

Expected: failure because `shareLanguageOptions()` is not exported.

- [ ] **Step 3: Wire the initial selection into Share**

In `src/commands/share.ts` add:

```ts
export function shareLanguageOptions(selection: LocaleSelection): {
  locale: Locale;
  languagePreference: LanguagePreference;
} {
  return {
    locale: selection.locale,
    languagePreference: languagePreferenceFromSelection(selection),
  };
}
```

Extend `runShare()` and `registerShare()` to accept the `LocaleSelection`, preserving defaults for direct callers, and pass `...shareLanguageOptions(selection)` into `startShareServer()`. In `src/index.ts`, change registration to `registerShare(program, i18n, language)`.

Use this compatibility default in both command functions when a caller supplies only `i18n`:

```ts
const selection: LocaleSelection = {
  locale: i18n.locale,
  source: "config.language",
  detectedLocale: i18n.locale,
};
```

- [ ] **Step 4: Document the settings switch**

Update both README language sections to state:

```text
The Share settings panel can switch between Follow system, Simplified Chinese, and English. A successful change is saved to ~/.airgap/config.json and reloads the current Share page immediately. --lang and AIRGAP_LANG still take priority on the next launch.
```

Use the equivalent concise Chinese paragraph in `README.zh-CN.md`.

```text
Share 设置面板可在「跟随系统 / 简体中文 / 英文」之间切换。保存成功后会写入 ~/.airgap/config.json，并立即刷新当前 Share 页面；下次启动时，--lang 和 AIRGAP_LANG 仍保持更高优先级。
```

- [ ] **Step 5: Run command and Share regression tests and confirm GREEN**

Run:

```sh
npm test -- test/share-command.test.ts test/share-server.test.ts test/config.test.ts test/i18n.test.ts
npm run typecheck
```

Expected: all focused tests pass and TypeScript exits 0.

- [ ] **Step 6: Commit Task 4**

```sh
git add src/index.ts src/commands/share.ts test/share-command.test.ts README.md README.zh-CN.md
git commit -m "docs: explain share language switching"
```

### Task 5: Full verification, review, and release handoff

**Files:**
- Review every file changed by Tasks 1-4.

- [ ] **Step 1: Run full verification**

Run each command separately and require exit code 0:

```sh
npm test
npm run typecheck
npm run build
git diff --check
```

Expected: 19 test files plus the new cases pass, typecheck/build succeed, and diff check prints nothing.

- [ ] **Step 2: Review scope and package contents**

Run:

```sh
git status --short --branch
npm publish --dry-run --access public --cache /tmp/airgap-share-language-release-cache
```

Confirm the two pre-existing untracked documents remain unstaged, no dependency or lockfile content changed beyond the already committed `0.2.0` version, no real Share process was started, and the tarball still contains only LICENSE, both READMEs, `dist/index.js`, and `package.json`.

- [ ] **Step 3: Request independent code review**

Ask the reviewer to inspect config preservation, precedence semantics, runtime/request locale snapshots, reload behavior, invalid input, failure atomicity, test isolation, and documentation. Fix all Critical and Important findings, then repeat Step 1.

- [ ] **Step 4: Hand off release continuation**

Report the verified commit range and that npm `0.2.0` remains unpublished. Do not run `npm publish` inside this implementation plan; resume the separately authorized release flow only after the implementation is accepted.
