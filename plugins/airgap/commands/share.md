---
description: Open the local airgap picker to select, preview, and export turns from a Claude or Codex session
disable-model-invocation: true
allowed-tools: Bash(airgap share*), Bash(npx airgap*)
---

Open the local airgap share picker now. The user explicitly invoked this command, so do not send them to a terminal for a second step.

1. Run `airgap share` with the Bash tool's background execution support. Do not append a shell-level `&` and do not create a daemon.
2. Read startup output until it contains `http://localhost:<port>/`.
3. Return the clickable local URL. Mention that the browser normally opens automatically and that the page's **完成关闭** action or ten minutes of inactivity stops the process.
4. Do not claim success until a usable localhost URL appears.

If `airgap` is not installed, explain that `npx airgap share` may download the npm package on first use and ask before running that fallback. If startup reports that no local sessions exist, return that error directly. If browser auto-open fails but the URL exists, return the URL for manual opening. If this environment cannot keep a long-running background process alive, tell the user to run `airgap share` in a terminal; never replace it with a resident service.
