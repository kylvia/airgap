import { CHAT_CSS } from "../render/html.js";

/**
 * 交互页：左勾选、右实时预览（隔离在 iframe 里，聊天 CSS 不污染 app 外壳）、
 * 底部发送按钮。所有会话数据经 /api 拉取，页面零外链。
 */
export function renderPage(defaultSession?: string): string {
  const chatCss = JSON.stringify(CHAT_CSS);
  const def = JSON.stringify(defaultSession ?? "");
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>airgap · 分享会话片段</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
    color: #1a1a1a; height: 100vh; display: flex; flex-direction: column; background: #fafafa; }
  header { padding: 12px 18px; border-bottom: 1px solid #e5e5e5; display: flex; align-items: center; gap: 14px; background: #fff; }
  header .logo { font-weight: 700; font-size: 15px; }
  header select { padding: 5px 8px; border: 1px solid #ddd; border-radius: 6px; font-size: 13px; max-width: 340px; }
  main { flex: 1; display: flex; min-height: 0; }
  .left { width: 380px; border-right: 1px solid #e5e5e5; display: flex; flex-direction: column; background: #fff; }
  .left .bar { padding: 8px 14px; border-bottom: 1px solid #eee; font-size: 12.5px; color: #666; display: flex; gap: 12px; align-items: center; }
  .left .bar a { color: #576b95; cursor: pointer; text-decoration: none; }
  .list { flex: 1; overflow-y: auto; padding: 6px 0; }
  .row { display: flex; gap: 8px; padding: 8px 14px; align-items: flex-start; cursor: pointer; border-bottom: 1px solid #f4f4f4; }
  .row:hover { background: #f7f7f7; }
  .row input { margin-top: 3px; }
  .row .body { flex: 1; min-width: 0; }
  .row .top { font-size: 13px; }
  .row .idx { color: #999; margin-right: 6px; }
  .row .prev { color: #333; }
  .row .tag { font-size: 11px; color: #b06a00; background: #fff3e0; border-radius: 3px; padding: 0 5px; margin-left: 6px; }
  .row .warn { font-size: 11px; color: #c0392b; margin-left: 6px; }
  .right { flex: 1; display: flex; flex-direction: column; min-width: 0; background: #ededed; }
  .right iframe { flex: 1; border: 0; width: 100%; background: #ededed; }
  footer { border-top: 1px solid #e5e5e5; background: #fff; padding: 10px 16px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  footer button { padding: 7px 14px; border: 1px solid #ddd; border-radius: 7px; background: #fff; font-size: 13px; cursor: pointer; }
  footer button.primary { background: #07c160; border-color: #07c160; color: #fff; font-weight: 600; }
  footer button:hover { border-color: #999; }
  footer button.primary:hover { background: #06ad56; }
  footer .status { flex: 1; font-size: 13px; color: #444; min-width: 200px; }
  footer .status.err { color: #c0392b; }
  .sbanner { background: #fff3e0; color: #b06a00; font-size: 12.5px; padding: 6px 16px; border-bottom: 1px solid #ffe0b2; display: none; }
</style>
</head>
<body>
  <header>
    <span class="logo">airgap</span>
    <span style="font-size:13px;color:#888">分享会话片段</span>
    <select id="sess"></select>
  </header>
  <div class="sbanner" id="sbanner"></div>
  <main>
    <div class="left">
      <div class="bar">
        <a id="all">全选</a><a id="none">清空</a>
        <span id="count" style="margin-left:auto"></span>
      </div>
      <div class="list" id="list"></div>
    </div>
    <div class="right"><iframe id="preview"></iframe></div>
  </main>
  <footer>
    <button class="primary" data-a="clipboard" data-f="png">复制长图</button>
    <button data-a="download" data-f="png">下载 PNG</button>
    <button data-a="clipboard" data-f="md">复制 Markdown</button>
    <button data-a="save" data-f="png">存桌面</button>
    <button data-a="shortcut" data-f="png">快捷指令</button>
    <span class="status" id="status">勾选左侧轮次，右侧实时预览，选好点「复制长图」发微信。</span>
    <button id="done">完成关闭</button>
  </footer>
<script>
const CHAT_CSS = ${chatCss};
const DEFAULT = ${def};
let detail = null;            // 当前会话 {id,title,date,turns:[]}
const selected = new Set();   // 选中的轮次 index

const $ = (id) => document.getElementById(id);
function setStatus(msg, err) { const s = $("status"); s.textContent = msg; s.className = "status" + (err ? " err" : ""); }

async function loadSessions() {
  const r = await fetch("/api/sessions"); const { sessions } = await r.json();
  const sel = $("sess"); sel.innerHTML = "";
  for (const s of sessions) {
    const o = document.createElement("option");
    o.value = s.id;
    o.textContent = s.project + " · " + s.source + " · " + s.id.slice(0, 8) + " · " + rel(s.mtimeMs);
    sel.appendChild(o);
  }
  const pick = sessions.find((s) => s.id.startsWith(DEFAULT)) || sessions[0];
  if (pick) { sel.value = pick.id; await loadSession(pick.id); }
  sel.onchange = () => loadSession(sel.value);
}

function rel(ms) {
  const d = (Date.now() - ms) / 1000;
  if (d < 60) return "刚刚"; if (d < 3600) return Math.floor(d / 60) + "分钟前";
  if (d < 86400) return Math.floor(d / 3600) + "小时前"; return Math.floor(d / 86400) + "天前";
}

async function loadSession(id) {
  setStatus("加载中…");
  const r = await fetch("/api/session/" + encodeURIComponent(id));
  if (!r.ok) { setStatus("加载失败", true); return; }
  detail = await r.json();
  selected.clear();
  // 默认勾选真实用户轮（跳过任务通知/命令/系统噪声），用户可再调
  for (const t of detail.turns) if (!t.tag) selected.add(t.index);
  renderList(); renderPreview();
  setStatus("共 " + detail.turns.length + " 轮，已默认勾选 " + selected.size + " 轮真实对话。");
}

function renderList() {
  const list = $("list"); list.innerHTML = "";
  for (const t of detail.turns) {
    const row = document.createElement("label"); row.className = "row";
    const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = selected.has(t.index);
    cb.onchange = () => { cb.checked ? selected.add(t.index) : selected.delete(t.index); renderPreview(); updateCount(); };
    const body = document.createElement("div"); body.className = "body";
    const top = document.createElement("div"); top.className = "top";
    top.innerHTML = '<span class="idx">第' + t.index + '轮</span><span class="prev"></span>'
      + (t.tag ? '<span class="tag">' + t.tag + '</span>' : '')
      + (t.findings > 0 ? '<span class="warn">⚠含' + t.findings + '处疑似密钥</span>' : '');
    top.querySelector(".prev").textContent = t.preview;
    body.appendChild(top); row.appendChild(cb); row.appendChild(body); list.appendChild(row);
  }
  updateCount();
}

function updateCount() {
  $("count").textContent = "已选 " + selected.size;
  const risky = detail.turns.filter((t) => selected.has(t.index) && t.findings > 0);
  const b = $("sbanner");
  if (risky.length) { b.style.display = "block"; b.textContent = "⚠ 选中的第 " + risky.map((t) => t.index).join("、") + " 轮含疑似密钥，导出/发送前请确认无误。"; }
  else b.style.display = "none";
}

function renderPreview() {
  const picked = detail.turns.filter((t) => selected.has(t.index));
  const blocks = picked.map((t) => t.html).join("\\n");
  const doc = '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>' + CHAT_CSS + '</style></head><body><div class="wrap">'
    + '<div class="header"><div class="title">' + esc(detail.title) + '</div><div>' + esc(detail.date) + ' · 共 ' + picked.length + ' 轮</div></div>'
    + blocks + '<div class="footer">导出自本地会话 · Generated by airgap</div></div></body></html>';
  $("preview").srcdoc = doc;
}

function esc(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

async function doExport(action, format) {
  if (!detail || selected.size === 0) { setStatus("先勾选至少一轮", true); return; }
  const risky = detail.turns.filter((t) => selected.has(t.index) && t.findings > 0);
  if (risky.length && !confirm("选中的第 " + risky.map((t) => t.index).join("、") + " 轮含疑似密钥，确定仍要导出/发送吗？")) return;
  const turns = [...selected].sort((a, b) => a - b);
  setStatus("处理中…");
  const body = JSON.stringify({ sessionId: detail.id, turns, format, action });
  const r = await fetch("/api/export", { method: "POST", headers: { "content-type": "application/json" }, body });
  if (action === "download" && r.ok && r.headers.get("content-type") === "image/png") {
    const blob = await r.blob(); const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "airgap-share.png";
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    setStatus("PNG 已下载。"); return;
  }
  const res = await r.json(); setStatus(res.message, !res.ok);
}

for (const btn of document.querySelectorAll("footer button[data-a]")) {
  btn.onclick = () => doExport(btn.dataset.a, btn.dataset.f);
}
$("all").onclick = () => { for (const t of detail.turns) selected.add(t.index); renderList(); renderPreview(); };
$("none").onclick = () => { selected.clear(); renderList(); renderPreview(); };
$("done").onclick = async () => { await fetch("/api/close", { method: "POST" }); setStatus("已关闭，可以关掉这个标签页了。"); };

loadSessions();
</script>
</body>
</html>
`;
}
