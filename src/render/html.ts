import type { Turn, TurnBlock } from "../types.js";
import MarkdownIt from "markdown-it";
import { tasklist } from "@mdit/plugin-tasklist";
import { THEME_CSS } from "./theme.js";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * markdown-it 单例：渲染的是**不可信**的会话内容，默认 XSS-safe。
 * - html:false —— 源码里的 raw HTML 当文本转义，绝不渲染成活动标签。**永远不要改成 true。**
 * - 默认 validateLink 丢弃 javascript:/vbscript:/file:/非图 data: 协议。**永远不要覆写 md.validateLink。**
 * - linkify:false —— 只认显式 [text](url)，不把裸 URL 自动成链（保持旧手写版行为）。
 * - breaks:true —— 段内单换行 → <br>，对齐旧手写版逐行 <br>。
 * - image 覆写 —— 只放行 data:image/ 内联图，丢弃一切远程 src，保证导出物零外链。
 * - heading 降级 —— # → h2 … 封顶 h4（h1 留给文档标题 .header .title；复刻旧排版）。
 * GFM 表格/删除线/blockquote/嵌套/斜体/hr 内置；任务列表由 @mdit/plugin-tasklist 提供。
 */
const md = new MarkdownIt({ html: false, linkify: false, breaks: true }).use(tasklist, {
  disabled: true,
  label: false,
});

// 零外链红线：远程 markdown 图片默认会生成 <img src=远程>，这里只放行 data:image/，其余丢标签留转义后的 alt 文本。
const defaultImageRule = md.renderer.rules.image;
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const src = token?.attrGet("src") ?? "";
  if (!/^data:image\//i.test(src)) return md.utils.escapeHtml(token?.content ?? "");
  return defaultImageRule
    ? defaultImageRule(tokens, idx, options, env, self)
    : self.renderToken(tokens, idx, options);
};

// 标题降级：markdown-it 的 # 输出 h1，逐轮卡片里改用 h2..h4（h1 归文档标题），复刻旧手写排版并复用现有 CSS。
const shiftHeading: NonNullable<typeof md.renderer.rules.heading_open> = (
  tokens,
  idx,
  options,
  _env,
  self,
) => {
  const token = tokens[idx];
  if (token) token.tag = `h${Math.min(Number(token.tag.slice(1)) + 1, 4)}`; // h1→h2, h3→h4, h4+→h4
  return self.renderToken(tokens, idx, options);
};
md.renderer.rules.heading_open = shiftHeading;
md.renderer.rules.heading_close = shiftHeading;

/**
 * markdown→html：委托给上面的 markdown-it 单例（同步、默认 XSS-safe，GFM 全覆盖）。
 * 保持同步 export 签名不变，renderTurnBlock / share 预览透明复用。
 */
export function markdownToHtml(src: string): string {
  return md.render(src);
}

export const CHAT_CSS = `${THEME_CSS}
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: var(--font-sans);
    background: var(--bg-subtle);
    color: var(--fg);
    line-height: 1.65;
    font-size: 15px;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 720px; margin: 0 auto; padding: 44px 22px 60px; }
  .mark { display: inline-block; vertical-align: middle; color: var(--fg); flex-shrink: 0; }
  /* Editorial document header — flat paper, hairline rule, no glow wash. */
  .header { text-align: center; padding: 4px 0 22px; margin-bottom: 8px; border-bottom: 1px solid var(--border); }
  .header .title {
    font-family: var(--font-serif); font-size: 31px; font-weight: 600;
    letter-spacing: -0.02em; color: var(--fg); margin-bottom: 9px;
    display: inline-flex; align-items: center; justify-content: center; gap: 12px;
    line-height: 1.15;
  }
  .header > div { color: var(--fg-subtle); font-size: 12.5px; font-family: var(--font-sans); letter-spacing: 0.01em; }
  .turn-label {
    font-family: var(--font-sans); text-align: center; color: var(--fg-subtle);
    font-size: 11px; letter-spacing: 0.05em; margin: 34px 0 16px;
  }
  .turn-label::before {
    content: ""; display: inline-block; width: 5px; height: 5px; margin-right: 8px;
    border-radius: 50%; background: var(--accent); vertical-align: 2px;
  }
  .msg-user { display: flex; justify-content: flex-end; margin: 14px 0; }
  .msg-user .bubble {
    position: relative; background: var(--bg); border: 1px solid var(--border-strong);
    border-radius: var(--radius-card); padding: 12px 16px; max-width: 82%;
    font-size: 14.5px; word-break: break-word;
  }
  .msg-user .bubble::before {
    content: ""; position: absolute; top: 13px; right: -1px; width: 2px; height: 18px;
    background: var(--accent); border-radius: 2px;
  }
  .msg-ai {
    background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-card);
    padding: 24px 26px; margin: 14px 0; overflow-wrap: break-word;
  }
  .msg-ai p { margin: 0 0 13px; }
  .msg-ai p:last-child { margin-bottom: 0; }
  .msg-ai strong { font-weight: 600; }
  .msg-ai h2, .msg-ai h3, .msg-ai h4 {
    font-family: var(--font-serif); font-weight: 600; letter-spacing: -0.02em;
    margin: 6px 0 14px; line-height: 1.22;
  }
  .msg-ai h2 { font-size: 30px; }
  .msg-ai h3 { font-size: 23px; }
  .msg-ai h4 { font-size: 19px; }
  .msg-ai ol, .msg-ai ul { margin: 0 0 13px 1.3em; }
  .msg-ai li { margin-bottom: 6px; }
  .msg-ai code {
    font-family: var(--font-mono); font-size: 13px;
    background: var(--bg-hover); border: 1px solid var(--border-subtle);
    border-radius: var(--radius-input); padding: 1px 5px; color: var(--fg);
  }
  .msg-ai pre {
    background: var(--bg-hover); color: var(--fg); border: 1px solid var(--border);
    border-radius: var(--radius-card); padding: 15px 17px; overflow-x: auto; margin: 0 0 13px;
    font-family: var(--font-mono); font-size: 13px; line-height: 1.7;
  }
  .msg-ai pre code { background: none; border: none; color: inherit; padding: 0; }
  .msg-ai a { color: var(--fg); text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 3px; transition: opacity var(--dur-1) var(--ease); }
  .msg-ai a:hover { opacity: 0.62; }
  .msg-ai a:focus-visible, .msg-ai details.thinking summary:focus-visible {
    outline: none; box-shadow: var(--focus-ring); border-radius: var(--radius-input);
  }
  /* GFM elements (markdown-it): tables, blockquote, strikethrough, em, hr, task-list, nested lists, inline data-image. */
  .msg-ai em { font-style: italic; }
  .msg-ai del, .msg-ai s { text-decoration: line-through; color: var(--fg-muted); }
  .msg-ai blockquote {
    border-left: 2px solid var(--border-strong); padding-left: 12px;
    margin: 0 0 13px; color: var(--fg-muted);
  }
  .msg-ai hr { border: 0; border-top: 1px solid var(--border); margin: 18px 0; }
  .msg-ai table {
    display: block; width: max-content; max-width: 100%; overflow-x: auto;
    border-collapse: collapse; margin: 0 0 13px; font-size: 13.5px;
  }
  .msg-ai th, .msg-ai td { border: 1px solid var(--border); padding: 6px 10px; text-align: left; }
  .msg-ai thead th { background: var(--bg-hover); font-weight: 600; }
  .msg-ai li > ul, .msg-ai li > ol { margin: 6px 0 0 1.1em; }
  .msg-ai li.task-list-item { list-style: none; margin-left: -1.1em; }
  .msg-ai input[type=checkbox] { accent-color: var(--accent); margin-right: 7px; vertical-align: middle; }
  .msg-ai img { max-width: 100%; height: auto; border-radius: var(--radius-input); }
  .msg-ai details.thinking { color: var(--fg-muted); font-size: 13px; margin: 0 0 11px; }
  .msg-ai details.thinking summary { cursor: pointer; color: var(--fg-muted); font-family: var(--font-sans); font-size: 12.5px; display: inline-flex; align-items: center; gap: 7px; }
  .msg-ai details.thinking summary .tmark { color: var(--accent); flex-shrink: 0; }
  .msg-ai details.thinking .thinking-body {
    white-space: pre-wrap; margin-top: 8px; color: var(--fg-muted);
    border-left: 2px solid var(--border-strong); padding-left: 12px;
  }
  .msg-ai .toolcard {
    border: 1px solid var(--border); border-radius: var(--radius-input);
    background: var(--bg); margin: 0 0 11px; overflow: hidden;
  }
  .msg-ai .toolcard-err { border-color: var(--danger); }
  .msg-ai .toolcard-head {
    display: flex; align-items: center; gap: 8px; padding: 8px 12px;
    background: var(--bg-hover); border-bottom: 1px solid var(--border);
  }
  .msg-ai .toolcard .tool-name {
    font-family: var(--font-mono); font-size: 12.5px; font-weight: 600; color: var(--fg);
  }
  .msg-ai .tool-status { margin-left: auto; font-family: var(--font-mono); font-size: 11px; font-weight: 600; }
  .msg-ai .tool-status.ok { color: var(--pastel-green-fg); }
  .msg-ai .tool-status.err { color: var(--danger); }
  .msg-ai .toolcard-in {
    padding: 10px 12px; font-family: var(--font-mono); font-size: 12px; line-height: 1.58;
    color: var(--fg); white-space: pre-wrap; word-break: break-word; overflow-x: auto;
  }
  .msg-ai .toolcard-out {
    padding: 9px 12px; border-top: 1px dashed var(--border);
    font-family: var(--font-mono); font-size: 11.5px; line-height: 1.5;
    color: var(--fg-subtle); white-space: pre-wrap; word-break: break-word;
  }
  .footer {
    font-family: var(--font-sans);
    text-align: center; color: var(--fg-subtle); font-size: 11.5px;
    margin-top: 42px; padding-top: 18px; border-top: 1px solid var(--border);
    display: flex; align-items: center; justify-content: center; gap: 8px;
  }
  .footer .mark { color: var(--fg-subtle); opacity: 0.85; }
`;

/** airgap 品牌 mark（inline SVG，零外链）：两块圆角矩形中间留一道竖隙，喻 "air gap" 物理隔离。 */
export function airgapMark(size: number): string {
  return `<svg class="mark" width="${size}" height="${size}" viewBox="0 0 18 18" fill="none" aria-hidden="true"><rect x="1.6" y="3.2" width="5.4" height="11.6" rx="1.6" fill="currentColor"/><rect x="11" y="3.2" width="5.4" height="11.6" rx="1.6" fill="currentColor"/></svg>`;
}

/** thinking disclosure 的行内标记（clean SVG 取代 emoji）：思考气泡 + 三点。 */
function thinkingMark(): string {
  return `<svg class="tmark" width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="1.6" y="2.6" width="12.8" height="8.8" rx="2" stroke="currentColor" stroke-width="1.3"/><circle cx="5.2" cy="7" r="0.95" fill="currentColor"/><circle cx="8" cy="7" r="0.95" fill="currentColor"/><circle cx="10.8" cy="7" r="0.95" fill="currentColor"/></svg>`;
}

/** 单张工具卡：头部（工具名 + 完成/报错状态）+ 完整输入 + 结果摘要，展示 AI 的一步操作。 */
function renderToolCard(block: TurnBlock): string {
  const name = escapeHtml(block.toolName ?? "tool");
  const input = block.toolInput ? escapeHtml(block.toolInput) : "";
  const result = block.toolResult ?? "";
  const isError = block.toolError === true;
  const status =
    result || isError
      ? `<span class="tool-status ${isError ? "err" : "ok"}">${isError ? "✗ 失败" : "✓ 完成"}</span>`
      : "";
  const out: string[] = [`<div class="toolcard${isError ? " toolcard-err" : ""}">`];
  out.push(`<div class="toolcard-head"><span class="tool-name">${name}</span>${status}</div>`);
  if (input) out.push(`<div class="toolcard-in">${input}</div>`);
  if (result) out.push(`<div class="toolcard-out">${escapeHtml(result).replace(/\n/g, "<br>")}</div>`);
  out.push("</div>");
  return out.join("");
}

/** 单轮聊天片段：轮次标记 + 用户纸条 + AI 纸面卡片。每个工具调用渲染成一张工具卡。供预览面板逐轮拼装复用。 */
export function renderTurnBlock(turn: Turn): string {
  const out: string[] = [];
  out.push(`  <div class="turn-label">—— 第 ${turn.index} 轮 ——</div>`);
  out.push(
    `  <div class="msg-user"><div class="bubble">${escapeHtml(turn.userText).replace(/\n/g, "<br>")}</div></div>`,
  );
  const inner: string[] = [];
  for (const block of turn.assistant) {
    if (block.kind === "text") {
      inner.push(markdownToHtml(block.text));
    } else if (block.kind === "thinking") {
      inner.push(
        `<details class="thinking"><summary>${thinkingMark()}<span>思考过程</span></summary><div class="thinking-body">${escapeHtml(block.text)}</div></details>`,
      );
    } else {
      inner.push(renderToolCard(block));
    }
  }
  if (inner.length > 0) {
    out.push(`  <div class="msg-ai">\n${inner.join("\n")}\n  </div>`);
  }
  return out.join("\n");
}

/** 单文件 Dossier 风聊天 HTML：warm bone 纸面 + paper 卡片 + off-black/pastel 点缀，深色跟随系统（PNG 截图恒为浅色）。 */
export function renderHtml(turns: Turn[], meta: { title: string; date: string }): string {
  const body: string[] = [];
  body.push('  <div class="header">');
  body.push(`    <div class="title">${airgapMark(24)}<span>${escapeHtml(meta.title)}</span></div>`);
  body.push(`    <div>${escapeHtml(meta.date)} · 共 ${turns.length} 轮</div>`);
  body.push("  </div>");
  for (const turn of turns) {
    body.push(renderTurnBlock(turn));
  }
  body.push(`  <div class="footer">${airgapMark(13)}<span>导出自本地会话 · Generated by airgap</span></div>`);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(meta.title)}</title>
<style>${CHAT_CSS}</style>
</head>
<body>
<div class="wrap">
${body.join("\n")}
</div>
</body>
</html>
`;
}
