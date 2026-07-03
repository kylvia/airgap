# Show HN post

**Title:** Show HN: airgap – Scan your AI coding sessions for leaked secrets, then carry them anywhere

**URL:** https://github.com/<owner>/airgap  ← fill in before posting

---

## Body

Claude Code, Codex and similar CLI tools persist every turn of your conversation to local `.jsonl` transcripts — under `~/.claude/projects/` and `~/.codex/sessions/`. That's what makes `--resume` work. It also means that any secret that ever appeared in a session — one you pasted, or one the model read for you when you said "cat the .env" — is now sitting in plaintext on disk, and stays there for weeks by default.

I got curious and scanned my own machine. 1216 sessions (202 Claude + 1014 Codex), ~2GB, 48s to scan. 680 of them contained at least one plaintext secret hit. After dedup that's 12,165 findings.

I want to be careful with that number: most of it is lower-confidence stuff (generic `KEY=value` assignments, whole `.env` dumps) that the scanner flags as *suspected* and can't claim is a live key. The part that made me sit up was the high-confidence tier — matched on real key prefixes: 118 Anthropic keys (`sk-ant-`), 128 GitHub tokens, 30 AWS access keys (`AKIA…`), 22 Google API keys, 16 raw PEM private keys, 10 OpenAI keys. **324 critical-severity hits total, a good chunk of which still look live.** On one solo developer's laptop.

So I wrote `airgap` — a local-only CLI, no cloud, no account, nothing leaves the machine. Three subcommands share one slice-extraction core:

- `airgap scan` — scan `~/.claude` and `~/.codex`, grouped by project, with severity counts and how many days the oldest hit has been sitting there. Exits non-zero if it finds anything.
- `airgap pack` / `airgap open` — redact and pack a slice of a session into a `.ccpack` file, move it over any channel you like, and `airgap open` it on another machine to `claude --resume` with full fidelity.
- `airgap show` — pick a few turns, render to PNG / HTML / Markdown.

```
npx airgap scan
```

### Some technical notes

**Why local-only.** The official cross-machine story (teleport / cloud / remote control) explicitly excludes people who use a raw API key, Bedrock/Vertex, a self-hosted LLM gateway, or are ZDR (zero-data-retention) users. That's exactly the population that has *no* first-party way to move a session between machines. I'm one of them. airgap never touches the network — you move the `.ccpack` over whatever channel you already trust (USB, internal transfer, encrypted mail).

**The `.ccpack` format** is just a zip: `manifest.json` + `transcript.jsonl` + `subagents/*` + `tool-results/*`, with a sha256 the receiver verifies. Before packing, absolute paths in the content get tokenized to `{{PROJECT_ROOT}}` / `{{HOME}}` and restored on `open` against the target project dir. `open` mints a fresh sessionId (fork semantics), rewrites the sessionId/cwd fields, writes into the target project's directory, and prints the `claude --resume` command plus a `--fork-session` fallback. It never overwrites an existing file.

**Consistency-mapping redaction.** A detected secret maps to a stable placeholder `<RULEID>-REDACTED-<6 hex>` where the hex is random per-pack and carries zero information about the plaintext — same secret → same placeholder across the main transcript and every sidecar, so pairing (`tool_use_id`, thinking `signature`, parent pointers) survives and the far side resumes cleanly. Placeholders are consistent within a pack, different across packs, and not brute-forceable back to the secret.

**Detection** is regex + entropy + a false-positive guard (drops values containing `REDACTED`/`EXAMPLE`/`your-`/`xxxx`/`<…>` or single-char repeats). High-confidence rules key off real prefixes (`sk-ant-`, `ghp_`, `AKIA`, `AIza`, full PEM blocks including the base64 body). Lower-confidence rules (generic assignment, env-dump) are labeled as suspected and never claimed as live keys.

### Limitations (being upfront)

- **Redaction is best-effort detection, not a guarantee.** It catches known prefixes and shapes; novel or oddly-formatted secrets can slip through. There's defense-in-depth (replace longest-secret-first, re-scan after redaction, fail-closed and refuse to write the pack if anything still matches, `open` re-scans independently before loading), and I ran an adversarial security review that fixed 14 issues (sidecar redaction, whole-PEM handling, non-brute-forceable placeholders, independent re-scan on open). It reduces your exposure; it does not eliminate it. Review before you send.
- **Version-drift risk.** The Claude JSONL layout is reverse-engineered against 2.1.197/198. If the on-disk format changes, slicing/resume can break until airgap catches up. `airgap doctor` prints the local claude/codex versions to help spot drift.

Repo: https://github.com/<owner>/airgap (MIT). Feedback very welcome — especially on the redaction rules and on `open`/resume behavior across claude-code versions, since that's the part most exposed to format drift.
