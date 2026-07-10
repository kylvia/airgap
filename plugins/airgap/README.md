# airgap — Claude Code plugin

Slash commands and a rescue hook for [airgap](https://github.com/airgap-cli/airgap),
the local "airport security + baggage handling" for your AI coding sessions:
scan for leaked secrets, redact-and-carry a session to another machine, or render
a few turns into something shareable. No cloud, no account.

The commands shell out to `npx airgap`, so you do not need airgap installed
globally — `npx` fetches it on first use.

## What you get

**Slash commands**

| Command | What it does |
| --- | --- |
| `/airgap:airgap-scan` | Scan `~/.claude` and `~/.codex` for plaintext API keys / secrets. |
| `/airgap:airgap-pack` | Redact + pack the current session into a portable `.ccpack` for another machine. |
| `/airgap:airgap-share` | Render selected turns to a long-image / HTML / Markdown. |
| `/airgap:airgap-rescue` | List and recover PreCompact snapshots from the rescue ring buffer. |

(Plugin commands are namespaced: `airgap` is the plugin name, so the full form is
`/airgap:airgap-scan`.)

**PreCompact rescue hook**

Right before Claude Code compacts (summarizes + truncates) your conversation, the
plugin snapshots the *full* transcript into `~/.airgap/rescue/`, keeping the newest
20. Compaction is lossy; this gives you an undo. The hook never blocks compaction
and adds no network calls — it just copies the live transcript file.

Snapshots are named `<UTC-timestamp>__<manual|auto>__<session-id>.jsonl`, stored
`0600` in a `0700` directory, and never leave the machine. Recover one with
`/airgap:airgap-rescue` (raw transcript — run `airgap pack` if you want it redacted).

## Install

The plugin is distributed through the airgap marketplace. Add the marketplace,
then install:

```
/plugin marketplace add airgap-cli/airgap
/plugin install airgap@airgap-marketplace
```

`airgap-cli/airgap` is the GitHub `owner/repo` hosting the marketplace's
`.claude-plugin/marketplace.json`. You can also point at a local checkout:

```
/plugin marketplace add /path/to/airgap
/plugin install airgap@airgap-marketplace
```

Then restart Claude Code (or `/reload-plugins`) so the commands and hook load.

## Requirements

- Node.js ≥ 18 (for `npx airgap`).
- Claude Code with plugin support (PreCompact hook + `commands/` + marketplace install).

## Uninstall

```
/plugin uninstall airgap@airgap-marketplace
```

Rescue snapshots in `~/.airgap/rescue/` are yours; delete them manually if you
want them gone.
