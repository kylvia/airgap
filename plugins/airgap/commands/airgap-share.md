---
description: Open a local web UI to pick turns of a session, preview them, and copy/save a shareable long-image (airgap share)
disable-model-invocation: true
allowed-tools: Bash(airgap share*), Bash(npx airgap*)
---

Pick a few turns of a local claude/codex session, see a live WeChat-style
preview, then copy the long-image to the clipboard (Cmd-V into any chat) or save
it. Runs entirely locally; the picker flags any turns that contain secrets
before you export.

The interactive window can't be drawn inside this chat — it's a small local web
page that `airgap share` opens in your browser. Two ways to launch it:

## Option 1 (default) — you run it in your terminal

Give the user this one line to run themselves (keeps the process under their
control):

```bash
airgap share
```

Then tell them: it opens a browser page — tick the turns on the left, watch the
preview on the right, click **复制长图** to put the long-image on the clipboard
(then Cmd-V into WeChat), or **存桌面** to save it. Click **完成关闭** when done,
or it self-exits after 10 minutes idle. Add `--session <id-prefix>` to preselect
a session.

## Option 2 — I launch it for you (background)

If the user says "just launch it", start the server in the background so this
turn doesn't block, and hand them the URL it prints:

```bash
airgap share
```

Run it with `run_in_background: true`, wait ~5s, read the printed
`http://localhost:<port>/` line, and give that URL to the user. The server
self-exits on **完成关闭** or after 10 minutes idle, so it won't linger.

## Notes

- Not installed globally? Use `npx airgap share` instead of `airgap share`.
- For a plain non-interactive render (no window), `airgap show --turns 2,4,6 --png --out x.png --yes` still works.
- To carry a *full resumable* session to another machine (not just a picture), use `/airgap-pack`.
