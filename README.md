<div align="center">

# airgap

**Scan your AI coding sessions for leaked secrets. Then carry them anywhere — no cloud, no accounts.**

[![npm version](https://img.shields.io/npm/v/airgap.svg)](https://www.npmjs.com/package/airgap)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

English · [简体中文](./README.zh-CN.md)

</div>

---

Your `~/.claude` and `~/.codex` folders are full of plaintext transcripts — and, more often than anyone expects, plaintext API keys you pasted mid-session. `airgap` is a single local CLI that:

- **scans** those folders and shows you exactly which sessions leak secrets,
- **packs** a session into a redacted, portable `.ccpack` you can send through any channel, and
- **opens** it on another machine as a new Claude Code session fork, preserving the selected tree and tool calls for `claude --resume` when the installed Claude Code format is compatible.

Session processing stays on your machine. No account or session upload. Airgap itself may contact the official npm registry for the optional update check described below, which you can disable.

## Install

Requires **Node.js 18 or newer**. Run any command without a global install as `npx airgap <command>`, or install the CLI globally:

```sh
npm install -g airgap
```

`npx` may download airgap from npm on first use. Interactive runs may also check npm for a newer release; see [Update notices](#update-notices) for the exact network boundary and opt-out. Pin a reviewed release with `npx airgap@<version>` or `npm install -g airgap@<version>` when reproducibility matters.

Current format support:

| Command | Claude Code | Codex | Purpose |
| --- | :---: | :---: | --- |
| `scan` | ✓ | ✓ | Find suspected plaintext secrets |
| `pack` | ✓ | ✓ | Redact and create a portable `.ccpack` |
| `open` | ✓ | ✗ install; `--print-only` works | Verify a pack; install Claude packs as new session forks |
| `show` / `share` | ✓ | ✓ | Export selected turns locally |

Run `npx airgap doctor` to inspect your environment and the installed version's `scan` / `pack` / `open` / `show` matrix.

## Quick start

```sh
npx airgap scan
```

That's it. `scan` walks `~/.claude` and `~/.codex`, streams every JSONL transcript through the detector, and prints a per-project table of what would leak if you shared or synced those files.

```
airgap scan: scanning ~1,200 sessions...
airgap scan: done in 48.2s

PROJECT                         SESSIONS   CRITICAL  HIGH  MEDIUM  OLDEST
~/work/payments-api             34/51      12        88    140     213d
~/work/infra-terraform          19/22      6         41    77      168d
~/side/scraper                  8/40       3         12    26      95d
~/dotfiles                      2/6        1         4     9       402d
...

⚠ ~680 of ~1,200 sessions contain plaintext secrets that would leak if shared or synced.
```

*(Example output. Numbers vary by machine — run it against your own folders to see yours.)*

Want the raw list of hits with masked previews:

```sh
npx airgap scan --list          # one masked finding per line
npx airgap scan --json          # machine-readable (secret text never leaves the process)
npx airgap scan --source claude # limit to one source
```

`scan` only ever prints a **masked preview** of each hit — the raw secret is never written to stdout, a file, or the JSON output.

## Carry a session anywhere — `pack` / `open`

Cloud handoff is not available or acceptable in every setup. API-key users, Amazon Bedrock / Google Vertex deployments, LLM gateways, zero-data-retention environments, and isolated networks often need a file they can move through an approved channel. `airgap` provides that local file workflow.

**On the source machine** — slice, redact, and bundle the current session:

```sh
npx airgap pack
```

You get a `<project>-<yyMMdd>.ccpack`. Interactively choose `redact` or `keep` for each detected secret; `--yes` redacts them all. A local map (**original secret → placeholder**) is written to `~/.airgap/maps/` with file mode `0600` where supported and never enters the pack. It contains the original secrets, so protect it and delete it when no longer needed.

Send the `.ccpack` through whatever channel you already trust — email, Slack, AirDrop, a USB stick, `scp`. A `.ccpack` is a plain zip, not encrypted storage.

**On the target machine** — verify and install as a new session:

```sh
npx airgap open payments-api-260703.ccpack
```

`open` checks declared files against the pack manifest, prints a summary, and **re-scans every declared content entry from scratch**. If clean — or when you explicitly pass `--accept-risk` — it installs the transcript into `~/.claude` as a new forked session. Then:

```sh
cd ~/work/payments-api && claude --resume <new-session-id> --fork-session
```

The selected session tree, tool-use/tool-result pairs, subagents, and thinking signatures are preserved in the installed fork. Whether it resumes successfully depends on Claude Code's on-disk format; see [Security & limitations](#security--limitations).

Useful flags:

```sh
npx airgap pack --session ab12cd --tail 20   # a specific session, last 20 user turns
npx airgap pack --strip-thinking             # drop assistant thinking blocks
npx airgap open pack.ccpack --print-only     # just extract + list files, don't install
npx airgap open pack.ccpack --project ~/dst  # choose the target project directory
```

## Open the local picker — `share`

When you want to select a few turns, preview them, and export a long image / HTML / Markdown, start the picker:

```sh
npm run build && npm link # once, from a trusted local checkout
airgap share
```

The browser opens automatically. The server binds only to loopback and stops when you click **Done** or after ten minutes of inactivity; airgap itself does not stay resident.

Share supports English and Simplified Chinese and follows the system language by default. Override it with `--lang` or `AIRGAP_LANG`, or persist a choice from the Share settings panel. Run `airgap doctor` to see the detected and resolved locale.

With the [local assistant plugin](./plugins/airgap/README.md) installed, an AI coding conversation becomes a one-step entry point:

- Claude Code: `/airgap:share`
- Codex: `$airgap-share`

For a shorter terminal command, add `alias ags='airgap share'` to your shell profile. Raycast, Alfred, or macOS Shortcuts can bind a personal hotkey to the same `airgap share` command.

## Turn a few turns into a shareable image — `show`

For the everyday case where you just want to post a snippet:

```sh
npx airgap show --last 4          # last 4 turns → single-file HTML (default)
npx airgap show --pick --png      # interactively pick turns → long-image PNG
npx airgap show --md --out clip.md
```

`show` renders selected turns as a chat-bubble transcript to **Markdown**, a **single-file HTML**, or a **long-image PNG** (PNG needs a local Chrome/Chromium). It runs the same secret scan on the selected content first and makes you confirm before exporting anything that still contains a hit.

## Update notices

In an interactive terminal, airgap normally checks the official npm registry at `registry.npmjs.org` for a newer release no more than once every 24 hours. Simultaneous launches may each check before the shared cache is updated. The request sends normal HTTPS metadata and the running airgap version; it never includes session contents, project names, filesystem paths, or configuration values. A failed check is silent, and airgap never installs an update automatically.

When a newer release exists, upgrade explicitly:

```sh
npm install -g airgap@latest # global install
npx airgap@latest            # npx usage
```

Disable checks for one shell or permanently in your shell profile:

```sh
export AIRGAP_NO_UPDATE_CHECK=1
```

Alternatively, set a top-level preference in `~/.airgap/config.json`:

```json
{
  "updateCheck": false
}
```

## How it works

- **Local JSONL, read-only.** Sessions live as newline-delimited JSON under `~/.claude/projects/<munged-cwd>/<sid>.jsonl` (plus `subagents/` and `tool-results/` sidecars) and `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`. `airgap` reads them; it never writes into `~/.codex`, and into `~/.claude` only when `open` installs a new file (never overwriting an existing one).
- **One detector, separate workflows.** `scan`, `pack`, `show`, and `share` use the same secret-detection rules while keeping their own discovery, slicing, and rendering paths. The detector streams each JSONL file and walks string *values*; metadata keys such as `uuid` and `signature` are skipped.
- **Fork semantics on install.** `open` mints a fresh `sessionId` and rewrites the session/cwd fields while leaving the `uuid`/`parentUuid` tree intact, so the installed copy resumes cleanly without colliding with any existing session.

## Security & limitations

Read this before you trust a pack with anything sensitive.

- **Redaction is best-effort detection, not a guarantee.** `airgap` finds secrets that match its rules; it cannot promise a pack is *clean*. A novel token format, an obfuscated key, or a secret split across fields can slip through. You own the residual risk of anything you share.
- **Findings are confidence-graded.** High-confidence rules key off real credential prefixes (`sk-ant-`, `ghp_`, `AKIA…`, `AIza…`, `sk-proj-`, PEM blocks, …) and are the ones worth acting on immediately. Broad heuristics (`generic-assignment`, `env-dump`, `bearer-token`, `jwt`) catch *suspected* material and include false positives — treat them as "look here", not "this is a live key".
- **A pack is neither encrypted nor authenticated.** Anyone who receives it can read its contents. Manifest hashes detect changes or damage to manifest-declared entries; because the manifest is not signed, they do not prove who created the pack or prevent someone from changing both the contents and their hashes.
- **`open` independently scans before install.** It does not rely on the manifest's redaction claims and refuses to install declared contents that still match a secret rule unless you pass `--accept-risk`.
- **Resume compatibility is version-sensitive.** The `~/.claude` install + resume path was verified against **claude 2.1.197/198**. Claude Code's on-disk format can drift; if a future version fails to resume an installed pack, use the fallback `claude --resume <absolute-path> --fork-session` command that `open` prints, and please file an issue.

## License

[MIT](./LICENSE)
