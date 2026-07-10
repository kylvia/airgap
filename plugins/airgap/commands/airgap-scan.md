---
description: Scan ~/.claude and ~/.codex for plaintext API keys and secrets (airgap scan)
---

Run a local secret scan over the user's on-disk AI coding sessions using the
airgap CLI. This finds plaintext API keys, tokens, and private keys sitting in
`~/.claude` and `~/.codex` session files — the ones the official cloud/teleport
features silently refuse to carry.

Nothing leaves the machine. No account, no upload.

## What to run

Run the scan and show the user the result table verbatim:

```bash
npx airgap scan
```

Useful variants (pick based on what the user asked for):

- `npx airgap scan --list` — print every finding individually (masked preview).
- `npx airgap scan --source claude` / `--source codex` — restrict to one store.
- `npx airgap scan --project <substr>` — only sessions whose project path matches.
- `npx airgap scan --json` — machine-readable output if you need to post-process.

## After scanning

- `airgap scan` exits non-zero when it finds anything — that is expected, not an error.
- Do NOT print any raw secret value back to the user; airgap already masks previews.
- If findings exist, tell the user they can redact-and-carry a session with
  `/airgap-pack`, or rotate the exposed keys.
