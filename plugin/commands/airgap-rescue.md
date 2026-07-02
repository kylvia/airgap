---
description: List and recover PreCompact session snapshots saved by airgap (rescue ring buffer)
---

The airgap plugin's PreCompact hook snapshots the full conversation into a local
ring buffer right before Claude Code compacts it. This command lists those
snapshots and helps recover one.

Snapshots live in `~/.airgap/rescue/` (override with `AIRGAP_RESCUE_DIR`), named
`<UTC-timestamp>__<trigger>__<session-id>.jsonl`, newest 20 kept.

## List available rescues

```bash
ls -lt ~/.airgap/rescue/ 2>/dev/null || echo "No rescue snapshots yet."
```

Show the user the list (timestamp, trigger = manual|auto, session id).

## Recover one

A rescued file is a full claude transcript jsonl. To carry it to another machine
or re-open it as a resumable session, hand it to airgap:

```bash
# Inspect / re-extract without installing:
npx airgap open <rescued-file>.jsonl --print-only
```

If the user wants to resume the pre-compaction session locally, they can drop
the rescued `.jsonl` back into the matching `~/.claude/projects/<munged-cwd>/`
directory (or pack it with `/airgap-pack` and open it), then
`claude --resume <session-id>`.

Note: rescue snapshots are the RAW transcript and may contain secrets — they are
stored 0600 and never leave the machine. Redaction only happens when you run
`airgap pack`.
