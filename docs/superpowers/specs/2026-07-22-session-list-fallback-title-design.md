# Session List Fallback Title Design

**Date:** 2026-07-22

## Goal

Make every item in the Share session picker recognizable without changing the
title used by previews or exports. A session with a Claude-authored title keeps
that title. A Codex session, or a Claude session without a stored title, uses
its first substantive user message as the list title.

Acceptance criteria:

- the picker label priority is latest custom title, latest AI title, first
  substantive user message, then the existing localized project fallback;
- Claude and Codex scaffolding, metadata, tool results, system injections,
  commands, task notifications, and media-only turns do not become titles;
- generated list titles are collapsed to one line and bounded in length;
- an unreadable or malformed transcript cannot prevent the session list from
  loading;
- focused tests cover both transcript dialects, precedence, filtering,
  truncation, and failure fallback.

## Scope

This change affects only the session summaries returned by `GET /api/sessions`
and the labels rendered in the existing picker. It does not change session
discovery, selection order, the stored transcript, title generation, preview
titles, export titles, configuration, or the picker layout.

No cache or new persistent state is introduced.

## Existing Behavior

`listSessions()` streams each selected transcript through `peekTitle()`. The
function returns Claude's latest `custom-title` or `ai-title`, while Codex and
untitled Claude sessions return `null`. The browser then falls back to
`<project> · <localized session turns>`.

The canonical Claude and Codex user-turn filtering already lives in
`src/render/turns.ts`. Claude filtering excludes sidechains, metadata, compact
summaries, tool-result carriers, and injected local-command/system content.
Codex filtering excludes developer/system records and known user-role
scaffolding.

## Design

### Shared user-message extraction

Expose one record-level helper from `src/render/turns.ts` that returns the
visible user text for a single parsed record and source, or `null` when the
record is not a real user turn. Both full turn extraction and the list-title
scanner use this helper so the two paths cannot silently disagree about Claude
or Codex scaffolding.

The helper preserves the existing dialect-specific rules. Full turn extraction
still owns assistant aggregation and tool-result attachment; only user-message
classification and text extraction are shared.

### Streaming list-title scan

Replace the title-only list scan with a source-aware streaming scan. While no
fallback candidate has been found, parse records and ask the shared helper for
visible user text. Reject user text that the existing `turnTag()` classifier
marks as a command, task notification, system/IDE event, or media-only turn.

Once the first substantive message has been captured, later non-title records
need not be parsed. The scanner must still traverse the remaining lines because
a later `custom-title` or `ai-title` has higher priority. This keeps memory
constant and limits JSON parsing to the early transcript plus title records in
the common case.

The scanner returns:

1. the latest non-empty custom title, if present;
2. otherwise the latest non-empty AI title, if present;
3. otherwise the normalized first substantive user message;
4. otherwise `null`, allowing the existing localized project fallback.

The generated fallback title is passed through `oneLine()`, then clipped to 60
characters with a trailing ellipsis when clipping occurs. Stored custom and AI
titles retain their current behavior and are not rewritten.

`listSessions()` supplies each session's source to the scanner and continues to
return its result as `SessionSummary.title`. No browser state-machine or markup
change is required because `fillOptions()` already prefers this field.

### State, feedback, impact, and timing

- **State truth:** transcript JSONL files remain the only source of title and
  first-message data; nothing is persisted by Airgap.
- **Observable feedback:** the existing session picker label is the feedback.
  Failure remains silent and visible only as the current project fallback.
- **Affected consumers:** only `/api/sessions` picker summaries change. Detail,
  preview, export, scan, pack, and open paths keep their existing semantics.
- **Timing and concurrency:** the current bounded `Promise.all` over the chosen
  session list remains. Each file is scanned independently and read-only; there
  is no shared mutable state or ordering dependency.

## Error Handling

As today, filesystem errors and malformed JSON lines are fail-soft. A read
failure returns `null`; malformed lines are ignored. The API continues serving
the other sessions, and the affected item uses the localized project fallback.

An empty, whitespace-only, or entirely filtered transcript behaves the same
way. The feature never writes to `~/.claude` or `~/.codex`.

## Testing

Focused unit tests will verify:

- latest custom title beats later AI titles;
- latest AI title beats a first-message fallback;
- an untitled Claude transcript uses its first substantive user message while
  skipping metadata, sidechains, tool results, commands, and injected content;
- an untitled Codex transcript skips developer messages and known scaffolding;
- whitespace is collapsed and long generated titles are clipped to 60
  characters with an ellipsis;
- missing files, malformed lines, and sessions with no candidate return `null`.

Existing turn-extraction tests guard the shared helper refactor. The focused
tests, full test suite, typecheck, build, and `git diff --check` form the final
verification set.
