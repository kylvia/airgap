import { CHAT_CSS, airgapMark } from "../render/html.js";
import { THEME_CSS } from "../render/theme.js";

/**
 * 交互页：左勾选、右实时预览（隔离在 iframe 里，聊天 CSS 不污染 app 外壳）、
 * 底部发送按钮。所有会话数据经 /api 拉取，页面零外链。
 */
export function renderPage(defaultSession?: string): string {
  const chatCss = JSON.stringify(CHAT_CSS);
  const def = JSON.stringify(defaultSession ?? "");
  const warnMark = '<svg class="wicon" width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2 15 14.2H1z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M8 6.6v3.1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="8" cy="11.7" r="0.55" fill="currentColor"/></svg>';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>airgap · 分享会话片段</title>
<style>
${THEME_CSS}
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: var(--font-sans);
    color: var(--fg); height: 100vh; display: flex; flex-direction: column;
    background: var(--bg-subtle); }
  .mark { display: inline-flex; vertical-align: middle; color: var(--fg); flex-shrink: 0; }
  header { position: sticky; top: 0; z-index: 10; padding: 14px 20px; display: flex; align-items: center; gap: 14px;
    background: var(--bg-subtle); border-bottom: 1px solid var(--border); }
  header .logo { font-family: var(--font-serif); font-weight: 600; font-size: 24px; letter-spacing: 0; display: inline-flex; align-items: center; gap: 9px; }
  header select { height: 34px; padding: 0 12px; border: 1px solid var(--border); border-radius: var(--radius-input);
    background: var(--bg); color: var(--fg); font-family: var(--font-sans); font-size: 13px; max-width: 340px; transition: border-color var(--dur-1) var(--ease), background var(--dur-1) var(--ease); }
  header select:hover { border-color: var(--border-strong); }
  header select:focus-visible { outline: none; box-shadow: var(--focus-ring); }
  main { flex: 1; display: flex; min-height: 0; position: relative; }
  /* 切换会话/展示级别时盖住内容区：实色纸面（铁律禁半透明材质），品牌 mark 两块交替脉动。
     显隐用 display 硬切（不过渡 opacity/visibility）：headless 截图合成对这类过渡不可靠，且遮罩不需要淡入。 */
  .loading { display: none; position: absolute; inset: 0; z-index: 5; flex-direction: column; gap: 13px;
    align-items: center; justify-content: center; background: var(--bg-subtle);
    color: var(--fg-muted); font-size: 13px; letter-spacing: 0.01em; }
  .loading.on { display: flex; }
  .loading .mark { color: var(--fg); }
  @keyframes gap-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.22; } }
  .loading.on .mark rect { animation: gap-pulse 1.15s var(--ease) infinite; }
  .loading.on .mark rect:last-child { animation-delay: 0.575s; }
  @media (prefers-reduced-motion: reduce) { .loading.on .mark rect { animation: none; } }
  .left { width: 380px; border-right: 1px solid var(--border); display: flex; flex-direction: column; background: var(--bg); }
  .left .bar { padding: 10px 16px; border-bottom: 1px solid var(--border); font-size: 12.5px; color: var(--fg-muted); display: flex; gap: 14px; align-items: center; }
  .left .bar a { color: var(--fg); cursor: pointer; text-decoration: underline; text-underline-offset: 3px; transition: opacity var(--dur-1) var(--ease); border-radius: var(--radius-input); }
  .left .bar a:hover { opacity: 0.68; }
  .left .bar a:focus-visible { outline: none; box-shadow: var(--focus-ring); }
  .list { flex: 1; overflow-y: auto; padding: 6px 0; }
  .list:empty::after {
    content: "从上方选择会话，勾选要分享的轮次开始";
    display: block; padding: 48px 28px; text-align: center; color: var(--fg-subtle);
    font-size: 13px; line-height: 1.7;
  }
  .row { display: flex; gap: 8px; padding: 10px 16px; align-items: flex-start; cursor: pointer; border-bottom: 1px solid var(--border-subtle); transition: background var(--dur-1) var(--ease); }
  .row:hover { background: var(--bg-hover); }
  .row input { margin-top: 3px; accent-color: var(--fg); cursor: pointer; }
  .row .body { flex: 1; min-width: 0; }
  .row .top { font-size: 13px; }
  .row .idx { color: var(--fg-subtle); margin-right: 6px; }
  .row .prev { color: var(--fg); }
  .row .tag { font-size: 11px; color: var(--fg); background: var(--bg-muted); border: 1px solid var(--border); border-radius: var(--radius-tag); padding: 1px 9px; margin-left: 6px; }
  .row .warn { font-size: 11px; color: var(--danger); margin-left: 6px; display: inline-flex; align-items: center; gap: 3px; vertical-align: middle; }
  .wicon { flex-shrink: 0; }
  .right { flex: 1; display: flex; flex-direction: column; min-width: 0; background: var(--bg-subtle); }
  .right iframe { flex: 1; border: 0; width: 100%; background: var(--bg-subtle); }
  footer { position: sticky; bottom: 0; z-index: 10; padding: 12px 18px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap;
    background: var(--bg-subtle); border-top: 1px solid var(--border); }
  footer button { height: 36px; padding: 0 20px; border: 1px solid var(--border-strong); border-radius: var(--radius-button);
    background: transparent; color: var(--fg); font-family: var(--font-sans); font-size: 13px; font-weight: 500; cursor: pointer; transition: background var(--dur-1) var(--ease), color var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease); }
  footer button:hover { background: var(--bg-hover); }
  footer button:active { transform: scale(0.985); }
  footer button:focus-visible { outline: none; box-shadow: var(--focus-ring); }
  footer button.primary { background: var(--btn-primary-bg); border-color: var(--btn-primary-bg); color: var(--btn-primary-fg); }
  footer button.primary:hover { background: var(--btn-primary-hover); border-color: var(--btn-primary-hover); }
  footer .rdct { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--fg); cursor: pointer; user-select: none; white-space: nowrap; }
  footer .rdct input { accent-color: var(--fg); cursor: pointer; }
  footer select { height: 34px; padding: 0 10px; border: 1px solid var(--border); border-radius: var(--radius-input);
    background: var(--bg); color: var(--fg); font-family: var(--font-sans); font-size: 13px; cursor: pointer; }
  footer select:hover { border-color: var(--border-strong); }
  footer select:focus-visible { outline: none; box-shadow: var(--focus-ring); }
  footer .status { flex: 1; font-size: 13px; color: var(--fg-muted); min-width: 200px; }
  footer .status.err { color: var(--danger); }
  .sbanner { background: var(--warning-bg); color: var(--warning-fg); font-size: 12.5px; padding: 8px 18px; border-bottom: 1px solid var(--warning); display: none; align-items: center; gap: 7px; }
</style>
</head>
<body>
  <header>
    <span class="logo">${airgapMark(20)}<span>airgap</span></span>
    <span style="font-size:13px;color:var(--fg-muted)">分享会话片段</span>
    <select id="sess"></select>
  </header>
  <div class="sbanner" id="sbanner"></div>
  <main>
    <div class="loading" id="loading">${airgapMark(26)}<span>加载会话内容…</span></div>
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
    <label class="rdct" title="工具调用的展示密度：隐藏 / 一行摘要 / 完整卡片（预览与导出一致）">工具<select id="tools">
      <option value="none">隐藏</option>
      <option value="summary" selected>摘要</option>
      <option value="full">完整</option>
    </select></label>
    <label class="rdct" title="导出前把检测到的密钥替换成占位符（推荐默认开）"><input type="checkbox" id="redact" checked>脱敏后导出</label>
    <button class="primary" data-a="clipboard" data-f="png">复制长图</button>
    <button data-a="download" data-f="png">下载 PNG</button>
    <button data-a="clipboard" data-f="md">复制 Markdown</button>
    <button data-a="save" data-f="png">存桌面</button>
    <span class="status" id="status">默认「脱敏后导出」。勾选轮次 → 右侧预览 → 点「复制长图」→ 切微信 Cmd-V 粘贴。</span>
    <button id="done">完成关闭</button>
  </footer>
<script>
const CHAT_CSS = ${chatCss};
const DEFAULT = ${def};
const MARK_H = ${JSON.stringify(airgapMark(24))};   // 预览外壳 header/footer 的品牌 mark（与 renderHtml 一致）
const MARK_F = ${JSON.stringify(airgapMark(13))};
const WARN_MARK = ${JSON.stringify(warnMark)};
let detail = null;            // 当前会话 {id,title,date,turns:[]}
const selected = new Set();   // 选中的轮次 index
let pvReady = false;          // 预览 iframe 是否已加载好

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

function setLoading(on) { $("loading").classList.toggle("on", !!on); }

async function loadSession(id, keepSelection) {
  setStatus("加载中…"); setLoading(true);
  try {
    const r = await fetch("/api/session/" + encodeURIComponent(id) + "?tools=" + encodeURIComponent($("tools").value));
    if (!r.ok) { setStatus("加载失败", true); return; }
    detail = await r.json();
    if (!keepSelection) {
      selected.clear();
      // 默认勾选真实用户轮（跳过任务通知/命令/系统噪声），用户可再调
      for (const t of detail.turns) if (!t.tag) selected.add(t.index);
    }
    renderList(); buildPreviewShell();
    setStatus(keepSelection
      ? "已按新的工具展示级别刷新预览。"
      : "共 " + detail.turns.length + " 轮，已默认勾选 " + selected.size + " 轮真实对话。");
  } catch {
    setStatus("加载失败（分享服务可能已关闭）", true);
  } finally {
    setLoading(false);
  }
}

function renderList() {
  const list = $("list"); list.innerHTML = "";
  for (const t of detail.turns) {
    // div 而非 label：行正文点击=预览定位查看，勾选只属于 checkbox 本身——两个动作解绑。
    const row = document.createElement("div"); row.className = "row";
    const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = selected.has(t.index);
    cb.setAttribute("aria-label", "勾选第 " + t.index + " 轮");
    cb.onchange = () => { cb.checked ? selected.add(t.index) : selected.delete(t.index); syncPreview(cb.checked ? t.index : null); updateCount(); };
    row.onclick = (e) => {
      if (e.target === cb) return;
      if (selected.has(t.index)) syncPreview(t.index);
      else setStatus("第 " + t.index + " 轮未勾选，勾选后才会出现在预览里。");
    };
    const body = document.createElement("div"); body.className = "body";
    const top = document.createElement("div"); top.className = "top";
    top.innerHTML = '<span class="idx">第' + t.index + '轮</span><span class="prev"></span>'
      + (t.tag ? '<span class="tag">' + t.tag + '</span>' : '')
      + (t.findings > 0 ? '<span class="warn">' + WARN_MARK + '含' + t.findings + '处疑似密钥</span>' : '');
    top.querySelector(".prev").textContent = t.preview;
    body.appendChild(top); row.appendChild(cb); row.appendChild(body); list.appendChild(row);
  }
  updateCount();
}

function updateCount() {
  $("count").textContent = "已选 " + selected.size;
  const risky = detail.turns.filter((t) => selected.has(t.index) && t.findings > 0);
  const b = $("sbanner");
  if (risky.length) { b.style.display = "flex"; b.innerHTML = WARN_MARK + "<span>选中的第 " + risky.map((t) => t.index).join("、") + " 轮含疑似密钥；默认「脱敏后导出」会替换成占位符，取消勾选则原样导出。</span>"; }
  else b.style.display = "none";
}

// 一次性把所有轮渲染进 iframe（各自带 id、默认隐藏），之后靠 syncPreview 切显隐 + 滚动，
// 不再每次勾选都重载 iframe——更顺滑，且能滚动到刚勾选的轮。
function buildPreviewShell() {
  const blocks = detail.turns
    .map((t) => '<div id="pv-turn-' + t.index + '" style="display:none">' + t.html + '</div>')
    .join("\\n");
  // <base target="_blank">：会话内容里的链接在新标签打开，绝不让预览 iframe 本身被导航走
  // （否则点一下相对链接，iframe 就跳到 share server 的 404，预览直接报废）。
  const doc = '<!DOCTYPE html><html><head><meta charset="UTF-8"><base target="_blank"><style>' + CHAT_CSS + '</style></head><body><div class="wrap">'
    + '<div class="header"><div class="title">' + MARK_H + '<span>' + esc(detail.title) + '</span></div><div id="pv-sub">' + esc(detail.date) + ' · 共 0 轮</div></div>'
    + blocks + '<div class="footer">' + MARK_F + '<span>导出自本地会话 · Generated by airgap</span></div></div></body></html>';
  const iframe = $("preview");
  pvReady = false;
  iframe.onload = () => { pvReady = true; syncPreview(null); };
  iframe.srcdoc = doc;
}

// 按当前 selected 切换各轮显隐、刷新预览头部计数；scrollTo 非空时平滑滚到该轮。
function syncPreview(scrollTo) {
  const iframe = $("preview");
  if (!pvReady || !iframe.contentDocument) return;
  const doc = iframe.contentDocument;
  let n = 0;
  for (const t of detail.turns) {
    const el = doc.getElementById("pv-turn-" + t.index);
    if (!el) continue;
    const on = selected.has(t.index);
    el.style.display = on ? "" : "none";
    if (on) n++;
  }
  const sub = doc.getElementById("pv-sub");
  if (sub) sub.textContent = detail.date + " · 共 " + n + " 轮";
  if (scrollTo != null) {
    const el = doc.getElementById("pv-turn-" + scrollTo);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function esc(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

async function doExport(action, format, acceptRisk) {
  if (!detail || selected.size === 0) { setStatus("先勾选至少一轮", true); return; }
  const redact = $("redact").checked;
  const risky = detail.turns.filter((t) => selected.has(t.index) && t.findings > 0);
  // 脱敏后导出是安全的，无需确认；仅「原样导出且命中」时才二次确认。
  if (!redact && risky.length && !acceptRisk && !confirm("选中的第 " + risky.map((t) => t.index).join("、") + " 轮含疑似密钥，未脱敏原样导出，确定吗？")) return;
  // 前端确认通过（或显式重试）即声明接受风险；服务端仍独立复扫兜底。
  const accept = !!acceptRisk || risky.length > 0;
  const turns = [...selected].sort((a, b) => a - b);
  setStatus(redact ? "脱敏处理中…" : "处理中…");
  const body = JSON.stringify({ sessionId: detail.id, turns, format, action, redact, acceptRisk: accept, tools: $("tools").value });
  const r = await fetch("/api/export", { method: "POST", headers: { "content-type": "application/json" }, body });
  if (action === "download" && r.ok && r.headers.get("content-type") === "image/png") {
    const blob = await r.blob(); const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "airgap-share.png";
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    setStatus(redact ? "PNG 已下载（已脱敏密钥）。" : "PNG 已下载。"); return;
  }
  const res = await r.json();
  // 服务端拦截（原样导出且命中，或有人绕过 UI）：确认后带 acceptRisk 重试一次。
  if (r.status === 409 && res.blocked) {
    if (confirm(res.message + "\\n仍要原样导出吗？")) return doExport(action, format, true);
    setStatus("已取消导出。", true); return;
  }
  setStatus(res.message, !res.ok);
}

for (const btn of document.querySelectorAll("footer button[data-a]")) {
  btn.onclick = () => doExport(btn.dataset.a, btn.dataset.f);
}
$("all").onclick = () => { for (const t of detail.turns) selected.add(t.index); renderList(); updateCount(); syncPreview(null); };
$("none").onclick = () => { selected.clear(); renderList(); updateCount(); syncPreview(null); };
// 切换工具展示级别：服务端按新级别重渲各轮片段（预览=导出，物理裁剪而非 CSS 隐藏），保留已勾选轮次。
$("tools").onchange = () => { if (detail) loadSession(detail.id, true); };
$("done").onclick = async () => { await fetch("/api/close", { method: "POST" }); setStatus("已关闭，可以关掉这个标签页了。"); };

loadSessions();
</script>
</body>
</html>
`;
}
