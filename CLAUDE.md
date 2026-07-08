# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`airgap` — a zero-cloud CLI (npm package, ESM, Node ≥18) that scans local `~/.claude` / `~/.codex` AI-session transcripts for leaked secrets, packs a session into a redacted portable `.ccpack`, and re-installs it on another machine as a resumable Claude session. Also renders turns to Markdown/HTML/PNG (`show`) and serves a local picker UI (`share`).

## Commands

```sh
npm run build        # tsup → dist/index.js (single ESM entry with shebang)
npm run dev          # tsx src/index.ts — run CLI from source, e.g. npm run dev -- scan --list
npm test             # vitest run (all tests)
npx vitest run test/redact.test.ts        # single test file
npx vitest run -t "consistency mapping"   # single test by name
npm run typecheck    # tsc --noEmit (strict)
scripts/canary-e2e.sh  # end-to-end smoke: synthesize session → pack → assert no plaintext leaks → open --print-only
```

CI (`.github/workflows/ci.yml`) runs tests on Node 18/20/22. `canary.yml` runs `canary-e2e.sh` daily against the *latest* claude-code to detect on-disk session-format drift — if it goes red, the fix usually lives in `src/slice.ts` / `src/commands/open.ts`.

## Key reference: CONTRACTS.md

`CONTRACTS.md` is the authoritative spec for module boundaries, export signatures, the full detection-rule table, and — most importantly — the **reverse-engineered on-disk formats**:

- Claude JSONL record structure (verified against claude 2.1.197/198): `uuid`/`parentUuid` tree, `promptId`, multi-record assistant messages sharing one `message.id`, tool_result carried in user records, sidecars under `<sid>/subagents/` and `<sid>/tool-results/`.
- The **slice closure rules** (parentUuid chain continuity, tool_use↔tool_result pairing never split, same-message.id records never split, sidecars carried along, droppable record types).
- Codex rollout format (`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`).

Read it before touching `slice.ts`, `redact.ts`, `ccpack.ts`, `open.ts`, or the detector. (It slightly predates `share`/`src/server/`; treat those as additions, not deviations.)

## Architecture

One extraction/detection core, multiple exits:

- `src/discovery.ts` — finds sessions in both sources; `mungeCwd` maps a cwd to Claude's project-dir name (`/` and `.` → `-`).
- `src/detect/` — `rules.ts` (rule table + `PREFILTER` fast regex), `scanner.ts` (`scanString` pure function; `scanSessionFile` streams lines, prefilters, JSON-parses, walks only string *values* via `walkStrings` skipping metadata keys like `uuid`/`signature`).
- `src/slice.ts` — extracts a coherent sub-tree of a session per the closure rules.
- `src/redact.ts` — `createRedactor(scan)` shares one consistent secret→placeholder map across transcript and all sidecars (`<RULEID>-REDACTED-<random6hex>`, per-pack random). Replaces longest secrets first, then **re-scans the output and fails closed** if anything still matches.
- `src/ccpack.ts` — `.ccpack` = plain zip (`manifest.json`, `transcript.jsonl`, `subagents/*`, `tool-results/*`). Rejects absolute paths and `..` on read (zip-slip). Absolute paths tokenized to `{{PROJECT_ROOT}}` / `{{HOME}}` at pack time.
- `src/commands/` — one `registerX(program)` per subcommand (scan/pack/open/show/share/doctor), wired in `src/index.ts` via commander.
- `src/render/` — `turns.ts` converts records → `Turn[]` for both dialects; `markdown.ts` / `html.ts` (hand-rolled md→html, no third-party md lib) / `screenshot.ts` (PNG via system Chrome, zero puppeteer dep); `theme.ts` is the single source of truth for Evergreen visual tokens (linen canvas, bone cards, ink text/actions, sage atmosphere; dark mode via `prefers-color-scheme`).
- `src/server/` — local web UI for `share` (pick turns, preview, export long-image).
- `plugin/` — Claude Code plugin: slash commands that shell out to `npx airgap`, plus a PreCompact hook snapshotting transcripts to `~/.airgap/rescue/`.

## Invariants (do not break)

- **ESM with `.js` suffixes**: relative imports must end in `.js` (`import { x } from "../util/jsonl.js"`).
- Raw secrets never reach stdout, files, or `--json` output — masked previews only. The reverse map goes only to `~/.airgap/maps/` at mode 0600 and never into a pack.
- `~/.codex` is strictly read-only; `~/.claude` is written only by `open` installing a **new** file — never overwrite an existing one.
- `open` never trusts a pack's own redaction claims: it re-scans extracted contents from scratch before installing.
- Redaction mutates only string values through `walkStrings` (metadata keys skipped), then re-serializes to `raw` — `uuid`/`parentUuid`/`tool_use_id`/`signature` must be byte-identical before/after (tests assert this).
- `open` forks: fresh `sessionId` via randomUUID, rewrite sessionId/cwd fields, leave the `uuid`/`parentUuid` tree intact.
- Local validation against real `~/.claude` / `~/.codex` data is fine, but never modify it.
- **Any HTML/CSS change follows the Evergreen visual spec** — `design.md` (light specs + implementation constraints) and `design.dark.md` (dark token strategy); `demo.md` is the concise style reference. Colors live only in `src/render/theme.ts` as `var(--x)` — never hard-code hex. Exported HTML, iframe preview, and share shell use zero remote assets. Primary action is a black pill; sage is limited to header wash, small markers, and narrow accent strips; never CTA/link/large-field fill. Do not add CSS backdrop filters or translucent toolbar material. Preserve DOM/class/id anchors used by JS and tests. Read `design.md` before editing any `<style>`.

## Tests

Vitest in `test/`, fixtures in `test/fixtures/` (including a fake home tree under `test/fixtures/home/` for discovery tests). Detector tests are per-rule hit/miss strings plus entropy and false-positive guards; redact tests assert metadata-field immutability and mapping consistency; ccpack tests do write→read roundtrip and zip-slip rejection.
