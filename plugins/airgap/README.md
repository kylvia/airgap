# airgap assistant plugin

This local-checkout plugin opens airgap's share picker from Claude Code or Codex without making you copy a second command into a terminal. The same package also provides Claude commands for scan / pack / rescue and a PreCompact rescue hook.

## Prepare the local CLI

From a trusted local checkout, build and link the CLI once:

```sh
npm run build && npm link
```

This makes the checkout's `airgap` executable available to both assistant integrations. No resident helper or remote package is required.

## Quick launch

- Claude Code: `/airgap:share`
- Codex: `$airgap-share`
- Terminal: `airgap share`

All three start the same picker, bound only to the loopback interface. Use the page's close button (**Done** / **完成关闭**) when finished; ten minutes of inactivity also stops the process. The picker runs only when invoked: airgap itself does not stay resident.

For a shorter terminal entry, add your own alias:

```sh
alias ags='airgap share'
```

You can optionally bind Raycast, Alfred, or macOS Shortcuts to `airgap share`. Airgap does not install a global hotkey or resident helper.

## Install from a local checkout

Replace `/absolute/path/to/airgap` below with the absolute path to this repository.

### Claude Code

```text
/plugin marketplace add /absolute/path/to/airgap
/plugin install airgap@airgap-marketplace
```

Run `/reload-plugins` or restart Claude Code so the commands and PreCompact hook load.

### Codex

```sh
codex plugin marketplace add /absolute/path/to/airgap
codex plugin add airgap@airgap-marketplace
```

Open a new task or restart Codex so the skill is discovered, then invoke `$airgap-share` or ask to open the local airgap share picker.

## What you get

### Claude Code commands

| Command | What it does |
| --- | --- |
| `/airgap:share` | Open the local picker directly. |
| `/airgap:airgap-share` | Legacy alias provided by the shared `airgap-share` skill; after launch, it points users to `/airgap:share`. |
| `/airgap:airgap-scan` | Scan `~/.claude` and `~/.codex` for plaintext API keys / secrets. |
| `/airgap:airgap-pack` | Redact and pack the current session into a portable `.ccpack`. |
| `/airgap:airgap-rescue` | List and recover PreCompact rescue snapshots. |

### Codex skill

`$airgap-share` starts the same local picker and returns its localhost URL. Its trigger is intentionally narrow: opening airgap share or sharing selected turns from the current Claude or Codex coding conversation.

### Claude PreCompact rescue hook

Right before Claude Code compacts (summarizes and truncates) a conversation, the plugin snapshots the full transcript into `~/.airgap/rescue/`, keeping the newest 20. The hook never blocks compaction and adds no network calls; it copies only the live local transcript.

Snapshots are named `<UTC-timestamp>__<manual|auto>__<session-id>.jsonl`, stored `0600` in a `0700` directory, and never leave the machine. Recover one with `/airgap:airgap-rescue`; run `airgap pack` if the recovered transcript must be redacted before sharing.

## Requirements

- Node.js 18 or newer.
- A trusted local checkout prepared with `npm run build && npm link`.
- Claude Code plugin support for Claude commands/hooks, or Codex plugin support for the Codex skill.

## Uninstall

Claude Code:

```text
/plugin uninstall airgap@airgap-marketplace
```

Codex:

```sh
codex plugin remove airgap@airgap-marketplace
```

Rescue snapshots in `~/.airgap/rescue/` remain yours and are not deleted automatically.
