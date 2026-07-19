---
name: airgap-share
description: Open airgap's local picker for the current Claude or Codex coding conversation when the user asks to "share this coding session", "open airgap share", "分享这段会话", or "打开 airgap 分享页". Do not use for generic file, link, or social sharing.
allowed-tools: Bash(airgap share)
---

# Airgap Share

Open the picker in one step while keeping the process local and temporary.

In Claude Code, `/airgap:share` is the preferred command. If invoked through the legacy `/airgap:airgap-share` alias, complete the launch first, then mention the shorter command.

## Workflow

1. Run `airgap share` using the environment's background or long-running process support. Keep the process observable; do not detach it with shell tricks.
2. Read startup output until it contains `http://localhost:<port>/`.
3. Return the clickable URL. Say that the browser normally opens automatically and that the page's close button (**Done** / **完成关闭**) or ten minutes without requests stops the process.
4. Do not report success before a usable localhost URL appears.

If `airgap` is not installed, tell the user to run `npm run build && npm link` from a trusted local checkout, then retry `airgap share`. If startup says no local Claude or Codex sessions were found, return that message directly. If browser auto-open fails but startup prints a URL, return the URL for manual opening. If the current surface cannot keep a long-running process alive, tell the user to run `airgap share` in a terminal instead.

## Boundaries

- Never create a daemon, login item, menu-bar helper, or fixed background service.
- Never modify shell startup files or install the `ags` alias automatically.
- Never bind the picker to a non-loopback interface.
- Never broaden this workflow into `scan`, `pack`, `open`, or `doctor` unless the user asks separately.
