---
description: Render selected turns of a session into a shareable long-image / HTML / Markdown (airgap show)
---

Turn part of a local claude/codex session into something you can post or send —
a scrolling long-image, a single-file HTML chat transcript, or Markdown — using
the airgap CLI. Runs entirely locally; the selected turns are scanned for
secrets before rendering.

## What to run

Render the last few turns of the most recent session to HTML (the default):

```bash
npx airgap show --last 3 --yes
```

`--yes` skips the interactive secret-confirmation prompt (needed in agent
context). airgap scans the selected turns first and will list any hits.

Format and selection variants:

- `npx airgap show --last N --html --out chat.html --yes` — single-file HTML (default format).
- `npx airgap show --last N --md --out chat.md --yes` — Markdown.
- `npx airgap show --last N --png --out chat.png --yes` — long-image
  (needs a local Chrome; airgap falls back with a hint if none is found).
- `npx airgap show --session <id-prefix> ...` — a specific session by prefix.
- `npx airgap show --pick ...` — interactively multi-select turns (interactive terminals only).

## After rendering

- Tell the user the output file path.
- If the pre-render scan flagged secrets, surface that to the user before they share.
- For carrying a *full, resumable* session to another machine (not just a
  picture), point them at `/airgap-pack` instead.
