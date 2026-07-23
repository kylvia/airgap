# Show HN post

**Title:** Show HN: airgap – Scan your AI coding sessions for leaked secrets, then carry them anywhere

**URL:** https://github.com/kylvia/airgap

---

## Body

Claude Code, Codex and similar CLI tools persist every turn of your conversation to local `.jsonl` transcripts — under `~/.claude/projects/` and `~/.codex/sessions/`. That's what makes `--resume` work. It also means that any secret that ever appeared in a session — one you pasted, or one the model read for you when you said "cat the .env" — is now sitting in plaintext on disk, and stays there for weeks by default.

I got curious and scanned one machine: 1,216 sessions (202 Claude + 1,014 Codex), about 2GB, and 48 seconds to scan. The detector reported at least one confidence-graded finding in 680 sessions; after per-session deduplication, that was 12,165 findings. These are measurements from one machine, not an estimate of prevalence across developers.

Most of that count is lower-confidence material (generic `KEY=value` assignments and whole `.env` dumps) that the scanner labels as *suspected* and cannot identify as a live credential. The high-confidence tier matched real credential prefixes or complete private-key blocks: 118 Anthropic-shaped keys (`sk-ant-`), 128 GitHub-shaped tokens, 30 AWS access-key shapes (`AKIA…`), 22 Google API-key shapes, 16 PEM private-key blocks, and 10 OpenAI-shaped keys. That was 324 critical-severity findings on this machine. I did not validate those findings against any provider.

So I wrote `airgap` — a local session-processing CLI with no account or session upload. Its workflows share one detector and extraction core:

- `airgap scan` — scan `~/.claude` and `~/.codex`, grouped by project, with severity counts and how many days the oldest hit has been sitting there. Exits non-zero if it finds anything.
- `airgap pack` / `airgap open` — redact and pack a slice of a session into a `.ccpack` file, move it over any channel you like, and install it as a new Claude session fork when the local on-disk format is compatible.
- `airgap show` — pick a few turns, render to PNG / HTML / Markdown.
- `airgap share` — open a loopback-only picker for selecting, previewing, and exporting turns.

```
npx airgap scan
```

### Some technical notes

**Why local session processing.** Cloud or remote handoff is not available or acceptable in every environment. API-key users, Bedrock/Vertex deployments, self-hosted LLM gateways, ZDR (zero-data-retention) setups, and isolated networks may need a file that can move through an existing approved channel. airgap does not upload session content; you move the `.ccpack` through USB, internal transfer, encrypted mail, or another channel you already trust. Interactive runs may check `registry.npmjs.org` for update metadata no more than once every 24 hours unless you disable that check with `AIRGAP_NO_UPDATE_CHECK=1` or `~/.airgap/config.json`.

**The `.ccpack` format** is just a zip: `manifest.json` + `transcript.jsonl` + `subagents/*` + `tool-results/*`, with a sha256 the receiver verifies. Before packing, absolute paths in the content get tokenized to `{{PROJECT_ROOT}}` / `{{HOME}}` and restored on `open` against the target project dir. `open` mints a fresh sessionId (fork semantics), rewrites the sessionId/cwd fields, writes into the target project's directory, and prints the `claude --resume` command plus a `--fork-session` fallback. It never overwrites an existing file.

**Consistency-mapping redaction.** A detected secret maps to a stable placeholder `<RULEID>-REDACTED-<6 hex>` where the hex is random per-pack and carries zero information about the plaintext — same secret → same placeholder across the main transcript and every sidecar, so pairing (`tool_use_id`, thinking `signature`, parent pointers) survives and the far side resumes cleanly. Placeholders are consistent within a pack, different across packs, and not brute-forceable back to the secret.

**Detection** is regex + entropy + a false-positive guard (drops values containing `REDACTED`/`EXAMPLE`/`your-`/`xxxx`/`<…>` or single-char repeats). High-confidence rules key off real prefixes (`sk-ant-`, `ghp_`, `AKIA`, `AIza`, full PEM blocks including the base64 body). Lower-confidence rules (generic assignment, env-dump) are labeled as suspected and never claimed as live keys.

### Limitations (being upfront)

- **Redaction is best-effort detection, not a guarantee.** It catches known prefixes and shapes; novel or oddly-formatted secrets can slip through. There's defense-in-depth (replace longest-secret-first, re-scan after redaction, fail-closed and refuse to write the pack if anything still matches, `open` re-scans independently before loading), and I ran an adversarial security review that fixed 14 issues (sidecar redaction, whole-PEM handling, non-brute-forceable placeholders, independent re-scan on open). It reduces your exposure; it does not eliminate it. Review before you send.
- **Image pixels are not scanned or redacted.** HTML/PNG export preserves supported embedded user images and inline `data:image` Markdown only after a separate manual-risk confirmation; Markdown removes supported inline-image bytes.
- **Version-drift risk.** The Claude JSONL layout is reverse-engineered against 2.1.197/198. If the on-disk format changes, slicing/resume can break until airgap catches up. `airgap doctor` prints the local claude/codex versions to help spot drift.

Repo: https://github.com/kylvia/airgap (MIT). Feedback is especially useful on the redaction rules and on `open`/resume behavior across Claude Code versions, since that path is most exposed to undocumented format drift.
