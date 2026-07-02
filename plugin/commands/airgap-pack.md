---
description: Redact and pack the current session into a portable .ccpack for another machine (airgap pack)
---

Slice, redact, and package a local claude/codex session into a single `.ccpack`
file using the airgap CLI. The pack is scrubbed of detected secrets and path
tokens, so it can travel over any file channel (AirDrop, USB, chat, email) and
be re-opened on another machine with `airgap open` to continue the conversation
via `claude --resume` — full fidelity, no cloud, no account.

This is the path for people the official teleport/cloud sync excludes: API-key
users, Bedrock/Vertex, LLM gateways, and ZDR users.

## What to run

By default, pack the most recent session in the current project directory:

```bash
npx airgap pack --yes
```

`--yes` auto-redacts every detected secret without an interactive prompt. Use it
in agent context since we cannot drive the interactive confirm UI.

Common variants:

- `npx airgap pack --session <id-prefix> --yes` — pack a specific session by sessionId prefix.
- `npx airgap pack --tail N --yes` — only the last N user turns.
- `npx airgap pack --out <file>.ccpack --yes` — choose the output path.
- `npx airgap pack --strip-thinking --yes` — drop assistant thinking blocks.

## After packing

- airgap prints the output path and an `airgap open <file>` command for the receiver.
- The reverse map (secret → placeholder) is stored locally at `~/.airgap/maps/`
  with 0600 perms and is NEVER placed inside the pack.
- Remind the user: redaction is best-effort detection, not a guarantee. Before
  sending a pack somewhere sensitive, they can re-open it with
  `npx airgap open <file> --print-only` to eyeball the contents.
