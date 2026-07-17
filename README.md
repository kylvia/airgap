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
- **opens** it on another machine as a fully-resumable `claude --resume` session — same tree, same tool calls.

Everything runs on your machine. No account, no upload, no telemetry.

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

The official `--teleport` / `--cloud` / Remote Control paths route your session through a vendor cloud, and they explicitly **exclude** anyone on an API key, Amazon Bedrock, Google Vertex, an LLM gateway, or under a zero-data-retention agreement. If that's you, the cloud button simply doesn't work. `airgap` gives you a file instead.

**On the source machine** — slice, redact, and bundle the current session:

```sh
npx airgap pack
```

You get a `<project>-<yyMMdd>.ccpack`. Before writing, `pack` shows every detected secret and lets you choose `redact` (replace with a placeholder) or `keep` per finding; `--yes` redacts everything unattended. The reverse map (placeholder → original) is written **only** to `~/.airgap/maps/` at `0600` and never enters the pack.

Send the `.ccpack` through whatever channel you already trust — email, Slack, AirDrop, a USB stick, `scp`.

**On the target machine** — verify and install as a new session:

```sh
npx airgap open payments-api-260703.ccpack
```

`open` verifies the archive checksum, prints a trust receipt, **re-scans the extracted contents from scratch** (it never trusts the pack's own redaction claims), and — only if clean, or with `--accept-risk` — installs it into `~/.claude` as a brand-new forked session. Then:

```sh
cd ~/work/payments-api && claude --resume <new-session-id> --fork-session
```

The full tree, tool-use/tool-result pairs, subagents, and thinking signatures are preserved, so the resumed session continues as if it had always lived on this machine.

Useful flags:

```sh
npx airgap pack --session ab12cd --tail 20   # a specific session, last 20 user turns
npx airgap pack --strip-thinking             # drop assistant thinking blocks
npx airgap open pack.ccpack --print-only     # just extract + list files, don't install
npx airgap open pack.ccpack --project ~/dst  # choose the target project directory
```

## Open the local picker — `share`

From a trusted local checkout, build and link the CLI once:

```sh
npm run build && npm link
```

When you want to select a few turns, preview them, and export a long image / HTML / Markdown, start the picker:

```sh
airgap share
```

The browser opens automatically. The server binds only to the loopback interface, so it does not accept remote connections. Click **完成关闭** on the page when finished; ten minutes of inactivity also stops the process. The picker runs only when invoked: airgap itself does not stay resident.

With the [local assistant plugin](./plugins/airgap/README.md) installed, an AI coding conversation becomes a one-step entry point:

- Claude Code: `/airgap:share`
- Codex: `$airgap-share`

For a shorter terminal command, add your own alias (airgap never edits shell files for you):

```sh
alias ags='airgap share'
```

Raycast, Alfred, or macOS Shortcuts (Windows: PowerToys Run / AutoHotkey; Linux: your desktop environment's own custom-shortcut settings) can optionally bind a personal hotkey to the same `airgap share` command. The launcher may stay resident, but airgap does not.

## Turn a few turns into a shareable image — `show`

For the everyday case where you just want to post a snippet:

```sh
npx airgap show --last 4          # last 4 turns → single-file HTML (default)
npx airgap show --pick --png      # interactively pick turns → long-image PNG
npx airgap show --md --out clip.md
```

`show` renders selected turns as a chat-bubble transcript to **Markdown**, a **single-file HTML**, or a **long-image PNG** (PNG needs a local Chrome/Chromium). It runs the same secret scan on the selected content first and makes you confirm before exporting anything that still contains a hit.

## Check your environment — `doctor`

```sh
npx airgap doctor
```

Prints the local `claude` / `codex` versions and the per-format support matrix (which of scan/pack/open/show each dialect supports).

## How it works

- **Local JSONL, read-only.** Sessions live as newline-delimited JSON under `~/.claude/projects/<munged-cwd>/<sid>.jsonl` (plus `subagents/` and `tool-results/` sidecars) and `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`. `airgap` reads them; it never writes into `~/.codex`, and into `~/.claude` only when `open` installs a new file (never overwriting an existing one).
- **One extraction core, three exits.** `scan`, `pack`, and `show` all share the same slicing + detection engine. The detector streams each line, JSON-parses it, and walks only string *values* (metadata keys like `uuid`/`signature` are skipped), so structural integrity is never touched.
- **`.ccpack` = a plain zip.** Inside: `manifest.json`, `transcript.jsonl`, `subagents/*`, `tool-results/*`. Reads reject absolute paths and `..` (no zip-slip). Project absolute paths are tokenized to `{{PROJECT_ROOT}}` / `{{HOME}}` at pack time and restored to the target machine's paths on `open`.
- **Consistent redaction mapping.** The same secret always maps to the same placeholder within a pack (`<RULEID>-REDACTED-<random6hex>`), across the main transcript and every sidecar alike. The placeholder carries **zero** information about the original secret, and the mapping differs from pack to pack so a placeholder can't be brute-forced. After redaction the content is re-scanned; if any secret survives, `pack` fails closed rather than shipping it.
- **Fork semantics on install.** `open` mints a fresh `sessionId` and rewrites the session/cwd fields while leaving the `uuid`/`parentUuid` tree intact, so the installed copy resumes cleanly without colliding with any existing session.

## Security & limitations

Read this before you trust a pack with anything sensitive.

- **Redaction is best-effort detection, not a guarantee.** `airgap` finds secrets that match its rules; it cannot promise a pack is *clean*. A novel token format, an obfuscated key, or a secret split across fields can slip through. You own the residual risk of anything you share.
- **Findings are confidence-graded.** High-confidence rules key off real credential prefixes (`sk-ant-`, `ghp_`, `AKIA…`, `AIza…`, `sk-proj-`, PEM blocks, …) and are the ones worth acting on immediately. Broad heuristics (`generic-assignment`, `env-dump`, `bearer-token`, `jwt`) catch *suspected* material and include false positives — treat them as "look here", not "this is a live key".
- **`open` never trusts the pack.** Even though `pack` redacts, `open` re-scans every extracted file independently before installing and refuses to install anything that still contains plaintext secrets unless you pass `--accept-risk`.
- **Install mechanism is version-pinned.** The `~/.claude` install + resume path was verified against **claude 2.1.198**. Claude Code's on-disk format can drift; if a future version fails to resume an installed pack, use the fallback `claude --resume <absolute-path> --fork-session` command that `open` prints, and please file an issue.
- **`~/.codex` is read-only.** `airgap` can scan, pack, and show Codex rollouts, but it does not install into `~/.codex` — there is no verified resume-injection path for Codex today (see `doctor` for the current matrix).
- **The reverse map stays local.** The placeholder→secret map is written to `~/.airgap/maps/` at `0600` and is never included in a `.ccpack`.

## Who is this for

The vendor's cloud handoff features leave whole groups of users out. If you are any of these, the local file route is the only route:

- You call Claude/Codex with your **own API key** rather than a Pro/Max login.
- You run on **Amazon Bedrock** or **Google Vertex AI**.
- You route through an **LLM gateway / proxy** (LiteLLM, an internal broker, etc.).
- You're under a **zero-data-retention (ZDR)** agreement that excludes you from cloud sync.
- Or you simply don't want your transcripts leaving the machine — air-gapped networks, regulated environments, or plain preference.

`airgap` never asks who you are or where your model lives. It reads local files and writes a local file. That's the whole trust model.

## License

[MIT](./LICENSE)
