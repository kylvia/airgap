---
name: airgap-share
description: Launch airgap's local session picker when the user explicitly asks to open airgap share, share selected turns from a Claude or Codex coding session, 打开 airgap 分享页, or 分享这段 AI 编码会话. Do not trigger for generic uses of “share” that do not mention an AI coding session or airgap.
---

# Airgap Share

Open the picker in one step while keeping the process local and temporary.

## Workflow

1. Run `airgap share` using the environment's background or long-running process support. Keep the process observable; do not detach it with shell tricks.
2. Read startup output until it contains `http://localhost:<port>/`.
3. Return the clickable URL. Say that the browser normally opens automatically and that **完成关闭** or ten minutes without requests stops the process.
4. Do not report success before a usable localhost URL appears.

If `airgap` is not installed, explain that `npx airgap share` can download the npm package on first use and ask for confirmation before using that fallback. If startup says no local Claude or Codex sessions were found, return that message directly. If browser auto-open fails but startup prints a URL, return the URL for manual opening. If the current surface cannot keep a long-running process alive, tell the user to run `airgap share` in a terminal instead.

## Boundaries

- Never create a daemon, login item, menu-bar helper, or fixed background service.
- Never modify shell startup files or install the `ags` alias automatically.
- Never bind the picker to a non-loopback interface.
- Never broaden this workflow into `scan`, `pack`, `open`, or `doctor` unless the user asks separately.
