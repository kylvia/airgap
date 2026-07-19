# Share Language Switcher Design

## Goal

Add a language selector to the Share settings panel with three choices: follow the operating system, Simplified Chinese, and English. A successful change must persist the preference, switch the running Share server, and reload the page so the shell, API responses, preview, and exports all use one locale.

## Scope

This change covers the Share settings UI, config persistence, Share server runtime locale, localized validation, documentation, and tests. It does not change the global startup precedence (`--lang` > `AIRGAP_LANG` > `config.language` > operating system > English), localize unrelated commands, start a real user-managed Share process, or publish npm.

## Chosen Approach

The Share server owns the live locale. The browser sends a validated preference to `POST /api/config`; the server persists it first, then atomically replaces its runtime locale and translator, returns success, and the browser reloads. This keeps server-rendered HTML, API errors, session detail, preview blocks, and exports on the same locale.

Rejected alternatives:

- Persist for the next launch only: safe but does not behave like an in-page switch.
- Translate only in the browser: fast but leaves API responses and exports in the old language.

## Preference Model

Introduce a UI preference type:

```ts
type LanguagePreference = "auto" | Locale;
```

- `auto` deletes the top-level `language` key from `~/.airgap/config.json` and resolves the operating-system locale immediately.
- `en` writes `{ "language": "en" }`.
- `zh-CN` writes `{ "language": "zh-CN" }`.

All writes preserve existing `share` settings and unknown top-level keys. A malformed existing config remains non-destructive: saving is rejected and the original file is untouched.

At startup, the settings selector reflects the effective source:

- OS-derived or English fallback: `auto`.
- `--lang`, `AIRGAP_LANG`, or `config.language`: the resolved `en` or `zh-CN` value, including English fallback for an unsupported explicit value.

An in-page selection overrides the current running Share service. On a later launch, the existing global precedence still applies, so `--lang` and `AIRGAP_LANG` continue to outrank the persisted config.

## Components

### Config

`src/config.ts` adds validated language-preference persistence. Shared read-modify-write helpers preserve unknown keys and retain the existing refusal to overwrite malformed JSON. `auto` removes `language`; explicit supported locales set it. Existing Share setting updates retain their current behavior.

### Startup Wiring

`src/index.ts` already has the final `LocaleSelection`. It derives the initial Share preference from the selection source and passes both the resolved locale and preference through `registerShare()` into `startShareServer()`.

### Share Server

`src/server/share-server.ts` changes the runtime `locale` and `i18n` from immutable startup constants to server-owned state. Each request snapshots the current pair when handling begins, so a concurrent export that started before a switch finishes consistently in the old locale while new requests use the new locale.

`POST /api/config` accepts an optional `language` field in addition to existing fields:

```json
{ "language": "auto" }
```

Invalid values return `400 INVALID_LANGUAGE`. On success, the server:

1. Resolves `auto` through the injectable system detector, or uses the explicit locale.
2. Persists the preference.
3. Updates the live locale, translator, and selected preference.
4. Returns `{ "ok": true, "language": "auto", "locale": "zh-CN" }` alongside existing config response fields.

Persistence happens before the runtime mutation. If saving fails, the response uses the old locale and the running state does not change.

The server options gain injectable config-home and system-detector inputs for isolated tests; production defaults remain the real home directory and platform detector.

### Share Page

`src/server/page.ts` renders a third settings row with `id="language"` and localized option labels. The selected option comes from the server-owned preference. On change, it posts the preference to `/api/config`; success calls `window.location.reload()`, while failure keeps the page and reports a localized error.

No client-side message catalog swapping is added. Reloading is intentional because the page contains server-rendered HTML, an injected message catalog, `Intl.RelativeTimeFormat`, and preview markup that must all change together.

### Documentation

Both READMEs explain the in-page selector, persistence, immediate reload, and the fact that CLI/environment overrides retain priority on future launches.

## Error Handling

- Unsupported request values are rejected before config writes.
- A system detector failure follows the existing environment/`Intl`/English fallback chain.
- Malformed config is never overwritten.
- A failed save leaves live locale and browser page unchanged.
- API errors during a language switch are translated with the request's pre-switch locale.

## Testing

1. Config tests verify explicit locale persistence, `auto` removal, unknown-key preservation, invalid-value rejection, and malformed-file safety.
2. Page tests verify the language selector, localized option labels, selected state, POST payload, reload-on-success, and no reload-on-failure anchors.
3. Server integration tests use a temporary config home and injected system detector to verify explicit switching, `auto` switching, page reload content, API locale consistency, invalid input, and persistence failure without runtime mutation.
4. Existing Share and i18n tests remain green.
5. Completion requires full `npm test`, `npm run typecheck`, `npm run build`, `git diff --check`, a scoped diff review, and independent code review.

## Acceptance Criteria

- The settings panel visibly offers Follow system, Simplified Chinese, and English.
- Choosing any option immediately results in a fully consistent page/API/export locale after reload.
- Explicit choices persist at top-level `language`; Follow system removes that key.
- CLI and environment overrides still win on the next process launch.
- Failed or invalid updates neither corrupt config nor mutate the running locale.
- No unrelated files, dependencies, or services are changed.
