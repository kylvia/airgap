---
description: Compatibility alias for /airgap:share — open the local airgap session picker
disable-model-invocation: true
allowed-tools: Bash(airgap share)
---

This is the compatibility alias for `/airgap:share`. Tell the user the shorter command is now preferred, then complete the launch without requiring a second terminal step.

1. Run `airgap share` with the Bash tool's background execution support. Do not append a shell-level `&` and do not create a daemon.
2. Read startup output until it contains `http://localhost:<port>/`.
3. Return the clickable local URL and mention **完成关闭** / the ten-minute idle exit.
4. Do not claim success until a usable localhost URL appears.

If `airgap` is unavailable, tell the user to run `npm run build && npm link` from a trusted local checkout, then retry `airgap share`. Surface “no local sessions” and other startup errors unchanged. If this environment cannot retain a background process, tell the user to run `airgap share` in a terminal.
