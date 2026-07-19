import { CHAT_CSS, airgapMark, escapeHtml } from "../render/html.js";
import { THEME_CSS } from "../render/theme.js";
import { createI18n, type LanguagePreference, type Locale } from "../i18n/index.js";

export function serializeForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * 交互页：左勾选、右实时预览（隔离在 iframe 里，聊天 CSS 不污染 app 外壳）、
 * 底部发送按钮。所有会话数据经 /api 拉取，页面零外链。
 * toolDisplay 是 config 里的工具展示档，服务端注入 select 初始选中（首屏即生效值，无闪变）。
 * isMac：复制到剪贴板走 osascript/pbcopy，只有 macOS 支持——非 mac 时把跨平台的「下载 PNG」
 * 设为主按钮，剪贴板按钮降级为次要并加提示，避免非 mac 用户点最显眼的按钮先撞一次失败。
 */
export function renderPage(
  defaultSession?: string,
  toolDisplay = "summary",
  isMac = true,
  locale: Locale = "zh-CN",
  languagePreference: LanguagePreference = locale,
): string {
  const i18n = createI18n(locale);
  const t = (key: string, params?: Record<string, string | number>): string => i18n.t(key, params);
  const hiddenStatusKey = isMac ? "share.page.status.other" : "share.page.status.mac";
  const messages = Object.fromEntries(
    i18n.keys()
      .filter((key) => (key.startsWith("share.page.") || key.startsWith("share.turnCount")) && key !== hiddenStatusKey)
      .map((key) => [key, i18n.t(key)]),
  );
  const chatCss = JSON.stringify(CHAT_CSS);
  const def = JSON.stringify(defaultSession ?? "");
  const primaryCls = (on: boolean): string => (on ? ' class="primary"' : "");
  const clipboardHint = isMac ? "" : ` title="${escapeHtml(t("share.page.clipboardHint"))}"`;
  const statusHint = t(isMac ? "share.page.status.mac" : "share.page.status.other");
  const warnMark = '<svg class="wicon" width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2 15 14.2H1z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M8 6.6v3.1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="8" cy="11.7" r="0.55" fill="currentColor"/></svg>';
  const refreshMark = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M13.2 7.2A5.4 5.4 0 1 0 13 9.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M13.2 3.8v3.5H9.7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  // 设置入口的滑杆图标（inline SVG，零 emoji）
  const prefsMark = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 4.5h12M2 8h12M2 11.5h12" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="10.5" cy="4.5" r="1.7" fill="var(--bg)" stroke="currentColor" stroke-width="1.3"/><circle cx="5.5" cy="8" r="1.7" fill="var(--bg)" stroke="currentColor" stroke-width="1.3"/><circle cx="12" cy="11.5" r="1.7" fill="var(--bg)" stroke="currentColor" stroke-width="1.3"/></svg>';
  const toolsOptions = (["none", "summary", "full"] as const)
    .map((v) => `<option value="${v}"${v === toolDisplay ? " selected" : ""}>${escapeHtml(t(`share.page.tool.${v}`))}</option>`)
    .join("");
  const languageOptions = (["auto", "zh-CN", "en"] as const)
    .map((value) => {
      const key = value === "zh-CN" ? "zhCN" : value;
      return `<option value="${value}"${value === languagePreference ? " selected" : ""}>${escapeHtml(t(`share.page.language.${key}`))}</option>`;
    })
    .join("");
  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(t("share.page.title"))}</title>
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
  header #refresh { width: 34px; height: 34px; flex-shrink: 0;
    display: inline-flex; align-items: center; justify-content: center;
    border: 1px solid var(--border); border-radius: var(--radius-input);
    background: var(--bg); color: var(--fg); cursor: pointer;
    transition: border-color var(--dur-1) var(--ease), background var(--dur-1) var(--ease); }
  header #refresh:hover { border-color: var(--border-strong); background: var(--bg-hover); }
  header #refresh:focus-visible { outline: none; box-shadow: var(--focus-ring); }
  header #refresh:disabled { cursor: wait; opacity: 0.48; }
  /* 当前会话 id 胶囊：点击复制 resume 命令 */
  header #sid { font-family: var(--font-mono); font-size: 12px; color: var(--fg-muted);
    border: 1px solid var(--border); border-radius: var(--radius-tag); padding: 3px 10px;
    cursor: pointer; user-select: none; white-space: nowrap;
    transition: color var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease); }
  header #sid:hover { color: var(--fg); border-color: var(--border-strong); }
  /* 设置入口 + popover：实色 paper 面板（铁律禁半透明材质），hairline 边框方角卡片 */
  header #prefs { margin-left: auto; width: 34px; height: 34px; flex-shrink: 0;
    display: inline-flex; align-items: center; justify-content: center;
    border: 1px solid var(--border); border-radius: var(--radius-input);
    background: var(--bg); color: var(--fg); cursor: pointer;
    transition: border-color var(--dur-1) var(--ease), background var(--dur-1) var(--ease); }
  header #prefs:hover { border-color: var(--border-strong); background: var(--bg-hover); }
  header #prefs:focus-visible { outline: none; box-shadow: var(--focus-ring); }
  #prefpanel { position: absolute; top: calc(100% + 8px); right: 20px; z-index: 20; min-width: 250px;
    background: var(--bg); border: 1px solid var(--border-strong); border-radius: var(--radius-card);
    padding: 6px 14px; }
  #prefpanel[hidden] { display: none; }
  #prefpanel .prow { display: flex; align-items: center; justify-content: space-between; gap: 18px;
    padding: 9px 0; font-size: 13px; color: var(--fg); }
  #prefpanel .prow + .prow { border-top: 1px solid var(--border-subtle); }
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
    content: ${JSON.stringify(t("share.page.empty"))};
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
  footer .status { flex: 1; font-size: 13px; color: var(--fg-muted); min-width: 200px; }
  footer .status.err { color: var(--danger); }
  .sbanner { background: var(--warning-bg); color: var(--warning-fg); font-size: 12.5px; padding: 8px 18px; border-bottom: 1px solid var(--warning); display: none; align-items: center; gap: 7px; }
</style>
</head>
<body>
  <header>
    <span class="logo">${airgapMark(20)}<span>airgap</span></span>
    <span style="font-size:13px;color:var(--fg-muted)">${escapeHtml(t("share.page.subtitle"))}</span>
    <select id="sess"></select>
    <button id="refresh" title="${escapeHtml(t("share.page.refresh"))}" aria-label="${escapeHtml(t("share.page.refresh"))}">${refreshMark}</button>
    <span id="sid" style="display:none" title="${escapeHtml(t("share.page.copyResume"))}"></span>
    <button id="prefs" title="${escapeHtml(t("share.page.settings"))}" aria-label="${escapeHtml(t("share.page.settingsAria"))}">${prefsMark}</button>
    <div id="prefpanel" hidden>
      <div class="prow"><span>${escapeHtml(t("share.page.sessionList"))}</span><select id="limit">
        <option value="10">${escapeHtml(t("share.page.recent", { count: 10 }))}</option>
        <option value="20">${escapeHtml(t("share.page.recent", { count: 20 }))}</option>
        <option value="50">${escapeHtml(t("share.page.recent", { count: 50 }))}</option>
      </select></div>
      <div class="prow"><span>${escapeHtml(t("share.page.toolDisplay"))}</span><select id="tools">${toolsOptions}</select></div>
      <div class="prow"><span>${escapeHtml(t("share.page.language"))}</span><select id="language">${languageOptions}</select></div>
    </div>
  </header>
  <div class="sbanner" id="sbanner"></div>
  <main>
    <div class="loading" id="loading">${airgapMark(26)}<span>${escapeHtml(t("share.page.loadingContent"))}</span></div>
    <div class="left">
      <div class="bar">
        <a id="all">${escapeHtml(t("share.page.selectAll"))}</a><a id="none">${escapeHtml(t("share.page.clear"))}</a>
        <span id="count" style="margin-left:auto"></span>
      </div>
      <div class="list" id="list"></div>
    </div>
    <div class="right"><iframe id="preview"></iframe></div>
  </main>
  <footer>
    <label class="rdct" title="${escapeHtml(t("share.page.redactHint"))}"><input type="checkbox" id="redact" checked>${escapeHtml(t("share.page.redact"))}</label>
    <button${primaryCls(isMac)} data-a="clipboard" data-f="png"${clipboardHint}>${escapeHtml(t("share.page.copyImage"))}</button>
    <button${primaryCls(!isMac)} data-a="download" data-f="png">${escapeHtml(t("share.page.downloadPng"))}</button>
    <button data-a="clipboard" data-f="md"${clipboardHint}>${escapeHtml(t("share.page.copyMarkdown"))}</button>
    <button data-a="save" data-f="png">${escapeHtml(t("share.page.saveDesktop"))}</button>
    <span class="status" id="status">${escapeHtml(statusHint)}</span>
    <button id="done">${escapeHtml(t("share.page.done"))}</button>
  </footer>
<script>
const CHAT_CSS = ${chatCss};
const DEFAULT = ${def};
const LOCALE = ${JSON.stringify(locale)};
const LANGUAGE_PREFERENCE = ${JSON.stringify(languagePreference)};
const M = ${serializeForScript(messages)};
function msg(key, params = {}) {
  const singularKey = params.count === 1 ? key + ".one" : "";
  const template = M[singularKey] || M[key] || key;
  return template.replace(/\\{(\\w+)\\}/g, (match, name) => Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match);
}
const MARK_H = ${JSON.stringify(airgapMark(24))};   // 预览外壳 header/footer 的品牌 mark（与 renderHtml 一致）
const MARK_F = ${JSON.stringify(airgapMark(13))};
const WARN_MARK = ${JSON.stringify(warnMark)};
let detail = null;            // 当前会话 {id,title,date,turns:[]}
const selected = new Set();   // 选中的轮次 index
let pvReady = false;          // 预览 iframe 是否已加载好

const $ = (id) => document.getElementById(id);
function setStatus(msg, err) { const s = $("status"); s.textContent = msg; s.className = "status" + (err ? " err" : ""); }

function fillOptions(sessions, keep) {
  const sel = $("sess"); sel.innerHTML = "";
  for (const s of sessions) {
    const o = document.createElement("option");
    o.value = s.id;
    // 标题优先（区分度最高）；无标题（codex / 未生成）回退项目名。id 前缀对 UI 没有区分价值，不再展示。
    o.textContent = (s.title || s.project + " · " + msg("share.page.fallbackTitle")) + " · " + s.source + " · " + rel(s.mtimeMs);
    sel.appendChild(o);
  }
  if (keep && [...sel.options].some((o) => o.value === keep)) sel.value = keep;
}

// 条数选择器与服务端生效值对齐；config 手写了非 10/20/50 的值就动态补一个 option。
function syncLimitSelect(limit) {
  const sel = $("limit");
  if (![...sel.options].some((o) => Number(o.value) === limit)) {
    const o = document.createElement("option");
    o.value = String(limit); o.textContent = msg("share.page.recent", { count: limit });
    sel.appendChild(o);
  }
  sel.value = String(limit);
}

async function loadSessions() {
  const r = await fetch("/api/sessions"); const { sessions, limit } = await r.json();
  fillOptions(sessions, null);
  syncLimitSelect(limit);
  const sel = $("sess");
  const pick = sessions.find((s) => s.id.startsWith(DEFAULT)) || sessions[0];
  if (pick) { sel.value = pick.id; await loadSession(pick.id); }
  sel.onchange = () => loadSession(sel.value);
}

// ai-title 会随会话演进被 Claude 持续更新——窗口重获焦点时（从 Claude Code 切回来的瞬间）
// 静默刷新下拉标题/排序，保持当前选中与预览不动。5s 节流，防止频繁切窗口反复全量扫标题。
let lastListRefresh = 0;
async function refreshSessions() {
  const q = detail ? "?ensure=" + encodeURIComponent(detail.id) : "";
  const r = await fetch("/api/sessions" + q);
  if (!r.ok) return false;
  const data = await r.json();
  fillOptions(data.sessions, detail ? detail.id : null);
  syncLimitSelect(data.limit);
  return true;
}
let manualRefreshInFlight = false;
async function refreshCurrentSession() {
  if (manualRefreshInFlight) return;
  manualRefreshInFlight = true;
  const button = $("refresh");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  try {
    if (!await refreshSessions()) {
      setStatus(msg("share.page.refreshListFailed"), true);
      return;
    }
    if (!detail) {
      setStatus(msg("share.page.listRefreshed"));
      return;
    }
    await loadSession(detail.id, true, msg("share.page.sessionRefreshed"));
  } catch {
    setStatus(msg("share.page.refreshFailed"), true);
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    manualRefreshInFlight = false;
  }
}
$("refresh").onclick = () => { refreshCurrentSession(); };
// 页面上改条数 = 写回 ~/.airgap/config.json（与配置文件同一真源），成功后按新条数重拉列表。
$("limit").onchange = async () => {
  const n = Number($("limit").value);
  const r = await fetch("/api/config", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionListLimit: n }) });
  const res = await r.json().catch(() => ({ ok: false, message: msg("share.page.saveFailed") }));
  if (!res.ok) { setStatus(res.message || msg("share.page.saveFailed"), true); return; }
  setStatus(msg("share.page.listSaved", { count: res.limit }));
  await refreshSessions();
};
window.addEventListener("focus", () => {
  if (manualRefreshInFlight || Date.now() - lastListRefresh < 5000) return;
  lastListRefresh = Date.now();
  refreshSessions().catch(() => {});
});

function rel(ms) {
  const d = (Date.now() - ms) / 1000;
  const formatter = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });
  if (d < 60) return formatter.format(0, "second");
  if (d < 3600) return formatter.format(-Math.floor(d / 60), "minute");
  if (d < 86400) return formatter.format(-Math.floor(d / 3600), "hour");
  return formatter.format(-Math.floor(d / 86400), "day");
}

function setLoading(on) { $("loading").classList.toggle("on", !!on); }

async function loadSession(id, keepSelection, refreshedStatus) {
  setStatus(msg("share.page.loading")); setLoading(true);
  try {
    const r = await fetch("/api/session/" + encodeURIComponent(id) + "?tools=" + encodeURIComponent($("tools").value));
    if (!r.ok) { setStatus(msg("share.page.loadFailed"), true); return false; }
    detail = await r.json();
    if (!keepSelection) {
      selected.clear();
      // 默认勾选真实用户轮（跳过任务通知/命令/系统噪声），用户可再调
      for (const t of detail.turns) if (!t.tag) selected.add(t.index);
    } else {
      const available = new Set(detail.turns.map((t) => t.index));
      for (const index of selected) if (!available.has(index)) selected.delete(index);
    }
    renderList(); buildPreviewShell();
    // 会话 id 胶囊：显示前 8 位，点击复制完整 resume 命令。
    // 不回到原 workspace 的 resume 只有对话没有文件语境，基本没意义——cwd 已知就拼上 cd。
    const sid = $("sid");
    sid.textContent = detail.id.slice(0, 8);
    sid.style.display = "";
    sid.onclick = async () => {
      const resume = (detail.source === "codex" ? "codex resume " : "claude --resume ") + detail.id;
      const cmd = detail.cwd ? 'cd "' + detail.cwd + '" && ' + resume : resume;
      try { await navigator.clipboard.writeText(cmd); setStatus(msg("share.page.copied", { command: cmd })); }
      catch { setStatus(cmd); } // 剪贴板不可用就把命令亮在状态栏，手动抄
    };
    setStatus(keepSelection
      ? refreshedStatus || msg("share.page.toolRefreshed")
      : msg("share.page.loadedSummary", { turns: detail.turns.length, selected: selected.size }));
    return true;
  } catch {
    setStatus(msg("share.page.loadClosed"), true);
    return false;
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
    cb.setAttribute("aria-label", msg("share.page.selectTurn", { index: t.index }));
    cb.onchange = () => { cb.checked ? selected.add(t.index) : selected.delete(t.index); syncPreview(cb.checked ? t.index : null); updateCount(); };
    // 行点击只对已勾选轮定位滚动；未勾选轮不在预览里（预览=导出），给一句状态提示防「点了没反应」。
    row.onclick = (e) => {
      if (e.target === cb) return;
      if (selected.has(t.index)) syncPreview(t.index);
      else setStatus(msg("share.page.unselectedTurn", { index: t.index }));
    };
    const body = document.createElement("div"); body.className = "body";
    const top = document.createElement("div"); top.className = "top";
    top.innerHTML = '<span class="idx">' + msg("share.page.turnLabel", { index: t.index }) + '</span><span class="prev"></span>'
      + (t.tag ? '<span class="tag">' + t.tag + '</span>' : '')
      + (t.findings > 0 ? '<span class="warn">' + WARN_MARK + msg("share.page.findingCount", { count: t.findings }) + '</span>' : '');
    top.querySelector(".prev").textContent = t.preview;
    body.appendChild(top); row.appendChild(cb); row.appendChild(body); list.appendChild(row);
  }
  updateCount();
}

function updateCount() {
  $("count").textContent = msg("share.page.selectedCount", { count: selected.size });
  const risky = detail.turns.filter((t) => selected.has(t.index) && t.findings > 0);
  const b = $("sbanner");
  if (risky.length) { b.style.display = "flex"; b.innerHTML = WARN_MARK + "<span>" + msg("share.page.riskBanner", { turns: risky.map((t) => t.index).join(LOCALE === "zh-CN" ? "、" : ", ") }) + "</span>"; }
  else b.style.display = "none";
}

// 一次性把所有轮渲染进 iframe（各自带 id、默认隐藏），之后靠 syncPreview 切显隐 + 滚动，
// 不再每次勾选都重载 iframe——更顺滑。预览严格等于导出：未勾选的轮不显示。
function buildPreviewShell() {
  const blocks = detail.turns
    .map((t) => '<div id="pv-turn-' + t.index + '" style="display:none">' + t.html + '</div>')
    .join("\\n");
  // <base target="_blank">：会话内容里的链接在新标签打开，绝不让预览 iframe 本身被导航走
  // （否则点一下相对链接，iframe 就跳到 share server 的 404，预览直接报废）。
  const doc = '<!DOCTYPE html><html lang="' + LOCALE + '"><head><meta charset="UTF-8"><base target="_blank"><style>' + CHAT_CSS + '</style></head><body><div class="wrap">'
    + '<div class="header"><div class="title">' + MARK_H + '<span>' + esc(detail.title) + '</span></div><div id="pv-sub">' + esc(detail.date) + ' · ' + msg("share.turnCount", { count: 0 }) + '</div></div>'
    + blocks + '<div class="footer">' + MARK_F + '<span>' + msg("share.page.previewFooter") + '</span></div></div></body></html>';
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
  if (sub) sub.textContent = detail.date + " · " + msg("share.turnCount", { count: n });
  if (scrollTo != null) {
    const el = doc.getElementById("pv-turn-" + scrollTo);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function esc(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

async function doExport(action, format, acceptRisk) {
  if (!detail || selected.size === 0) { setStatus(msg("share.page.selectOne"), true); return; }
  const redact = $("redact").checked;
  const risky = detail.turns.filter((t) => selected.has(t.index) && t.findings > 0);
  // 脱敏后导出是安全的，无需确认；仅「原样导出且命中」时才二次确认。
  if (!redact && risky.length && !acceptRisk && !confirm(msg("share.page.confirmRisk", { turns: risky.map((t) => t.index).join(LOCALE === "zh-CN" ? "、" : ", ") }))) return;
  // 前端确认通过（或显式重试）即声明接受风险；服务端仍独立复扫兜底。
  const accept = !!acceptRisk || risky.length > 0;
  const turns = [...selected].sort((a, b) => a - b);
  setStatus(redact ? msg("share.page.redacting") : msg("share.page.processing"));
  const body = JSON.stringify({ sessionId: detail.id, turns, format, action, redact, acceptRisk: accept, tools: $("tools").value });
  const r = await fetch("/api/export", { method: "POST", headers: { "content-type": "application/json" }, body });
  if (action === "download" && r.ok && r.headers.get("content-type") === "image/png") {
    const blob = await r.blob(); const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "airgap-share.png";
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    setStatus(redact ? msg("share.page.downloadedRedacted") : msg("share.page.downloaded")); return;
  }
  const res = await r.json();
  // 服务端拦截（原样导出且命中，或有人绕过 UI）：确认后带 acceptRisk 重试一次。
  if (r.status === 409 && res.blocked) {
    if (confirm(res.message + "\\n" + msg("share.page.confirmAgain"))) return doExport(action, format, true);
    setStatus(msg("share.page.cancelled"), true); return;
  }
  setStatus(res.message, !res.ok);
}

for (const btn of document.querySelectorAll("footer button[data-a]")) {
  btn.onclick = () => doExport(btn.dataset.a, btn.dataset.f);
}
$("all").onclick = () => { for (const t of detail.turns) selected.add(t.index); renderList(); updateCount(); syncPreview(null); };
$("none").onclick = () => { selected.clear(); renderList(); updateCount(); syncPreview(null); };
// 设置面板开关：点按钮 toggle；点面板外或按 Esc 关闭（面板内点击冒泡到 document 时被 contains 放行）。
$("prefs").onclick = (e) => { e.stopPropagation(); const p = $("prefpanel"); p.hidden = !p.hidden; };
document.addEventListener("click", (e) => { const p = $("prefpanel"); if (!p.hidden && !p.contains(e.target)) p.hidden = true; });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("prefpanel").hidden = true; });
// 切换工具展示级别：服务端按新级别重渲各轮片段（预览=导出，物理裁剪而非 CSS 隐藏），保留已勾选轮次；
// 同时静默持久化到 config.json——先等预览刷新（用户在等它），保存失败的提示最后落地不被刷新提示覆盖。
$("tools").onchange = async () => {
  const save = fetch("/api/config", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ toolDisplay: $("tools").value }) })
    .then((r) => r.json()).catch(() => ({ ok: false, message: msg("share.page.toolSaveFailed") }));
  if (detail) await loadSession(detail.id, true);
  const res = await save;
  if (!res.ok) setStatus(res.message || msg("share.page.toolSaveFailed"), true);
};
$("language").onchange = async () => {
  const r = await fetch("/api/config", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ language: $("language").value }),
  });
  const res = await r.json().catch(() => ({ ok: false, message: msg("share.page.languageSaveFailed") }));
  if (!res.ok) {
    $("language").value = LANGUAGE_PREFERENCE;
    setStatus(res.message || msg("share.page.languageSaveFailed"), true);
    return;
  }
  window.location.reload();
};
$("done").onclick = async () => { await fetch("/api/close", { method: "POST" }); setStatus(msg("share.page.closed")); };

loadSessions();
</script>
</body>
</html>
`;
}
