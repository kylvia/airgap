import type { Turn, TurnBlock } from "../types.js";
import { THEME_CSS } from "./theme.js";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 行内格式：先转义，再依次处理行内码（占位保护）、粗体、链接。 */
function inline(raw: string): string {
  let s = escapeHtml(raw);
  const codeSpans: string[] = [];
  s = s.replace(/`([^`]+)`/g, (_m, code: string) => {
    codeSpans.push(`<code>${code}</code>`);
    return `\u0000${codeSpans.length - 1}\u0000`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => codeSpans[Number(i)] ?? "");
  return s;
}

/**
 * 轻量 markdown→html：# 标题、**粗体**、- 列表、1. 有序列表、```代码块```、
 * `行内码`、[链接](url)。表格不支持。全部内容先 HTML 转义再套格式。
 */
export function markdownToHtml(md: string): string {
  const out: string[] = [];
  let inCode = false;
  let codeLines: string[] = [];
  let ulItems: string[] = [];
  let olItems: string[] = [];
  let para: string[] = [];

  const flushPara = (): void => {
    if (para.length > 0) {
      out.push(`<p>${para.map(inline).join("<br>")}</p>`);
      para = [];
    }
  };
  const flushLists = (): void => {
    if (ulItems.length > 0) {
      out.push(`<ul>${ulItems.map((i) => `<li>${inline(i)}</li>`).join("")}</ul>`);
      ulItems = [];
    }
    if (olItems.length > 0) {
      out.push(`<ol>${olItems.map((i) => `<li>${inline(i)}</li>`).join("")}</ol>`);
      olItems = [];
    }
  };
  const flushCode = (): void => {
    out.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
    codeLines = [];
    inCode = false;
  };

  for (const line of md.split(/\r?\n/)) {
    if (inCode) {
      if (/^\s*```/.test(line)) flushCode();
      else codeLines.push(line);
      continue;
    }
    if (/^\s*```/.test(line)) {
      flushPara();
      flushLists();
      inCode = true;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      flushLists();
      const level = Math.min((heading[1] ?? "#").length + 1, 4); // # → h2，## → h3，###+ → h4
      out.push(`<h${level}>${inline(heading[2] ?? "")}</h${level}>`);
      continue;
    }
    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    if (ul) {
      flushPara();
      ulItems.push(ul[1] ?? "");
      continue;
    }
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ol) {
      flushPara();
      olItems.push(ol[1] ?? "");
      continue;
    }
    if (line.trim().length === 0) {
      flushPara();
      flushLists();
      continue;
    }
    flushLists();
    para.push(line);
  }
  if (inCode) flushCode(); // 未闭合代码块容错
  flushPara();
  flushLists();
  return out.join("\n");
}

export const CHAT_CSS = `${THEME_CSS}
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: var(--font-sans);
    background: var(--bg-subtle);
    color: var(--fg);
    line-height: 1.65;
    font-size: 15px;
  }
  .wrap { max-width: 700px; margin: 0 auto; padding: 40px 20px 56px; }
  .mark { display: inline-block; vertical-align: middle; color: var(--accent); flex-shrink: 0; }
  .header { position: relative; text-align: center; padding: 8px 0 28px; }
  .header::before {
    content: ""; position: absolute; top: -26px; left: 50%; transform: translateX(-50%);
    width: 460px; max-width: 92%; height: 150px; z-index: 0; pointer-events: none;
    background:
      radial-gradient(42% 60% at 28% 42%, rgba(160,181,235,0.38), transparent 70%),
      radial-gradient(42% 60% at 72% 46%, rgba(167,252,205,0.32), transparent 70%),
      radial-gradient(36% 55% at 54% 62%, rgba(255,148,115,0.22), transparent 70%);
    filter: blur(28px);
  }
  .header > * { position: relative; z-index: 1; }
  .header .title {
    font-family: var(--font-serif); font-size: 28px; font-weight: 400;
    letter-spacing: -0.02em; color: var(--fg); margin-bottom: 8px;
    display: inline-flex; align-items: center; justify-content: center; gap: 12px;
  }
  .header > div { color: var(--fg-muted); font-size: 13px; }
  .turn-label {
    font-family: var(--font-mono);
    text-align: center; color: var(--fg-subtle); font-size: 12px;
    letter-spacing: 0.04em; margin: 30px 0 14px;
  }
  .msg-user { display: flex; justify-content: flex-end; margin: 14px 0; }
  .msg-user .bubble {
    background: var(--bg-muted); border-radius: var(--radius-card);
    padding: 12px 18px; max-width: 82%; font-size: 14.5px; word-break: break-word;
  }
  .msg-ai {
    background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-card);
    padding: 24px 26px; margin: 14px 0;
    box-shadow: var(--shadow-card); overflow-wrap: break-word;
  }
  .msg-ai p { margin: 0 0 12px; }
  .msg-ai p:last-child { margin-bottom: 0; }
  .msg-ai strong { font-weight: 600; }
  .msg-ai h2, .msg-ai h3, .msg-ai h4 {
    font-family: var(--font-serif); font-weight: 400; letter-spacing: -0.02em;
    margin: 4px 0 12px; line-height: 1.2;
  }
  .msg-ai h2 { font-size: 24px; }
  .msg-ai h3 { font-size: 20px; }
  .msg-ai h4 { font-size: 18px; }
  .msg-ai ol, .msg-ai ul { margin: 0 0 12px 1.4em; }
  .msg-ai li { margin-bottom: 6px; }
  .msg-ai code {
    font-family: var(--font-mono); font-size: 13px;
    background: var(--bg-hover); border: 1px solid var(--border);
    border-radius: 6px; padding: 1px 5px; color: var(--fg);
  }
  .msg-ai pre {
    background: var(--bg-hover); color: var(--fg); border: 1px solid var(--border);
    border-radius: var(--radius-md); padding: 16px 18px; overflow-x: auto; margin: 0 0 12px;
    font-family: var(--font-mono); font-size: 13px; line-height: 1.7;
  }
  .msg-ai pre code { background: none; border: none; color: inherit; padding: 0; }
  .msg-ai a { color: var(--accent); text-decoration: none; }
  .msg-ai a:hover { text-decoration: underline; }
  .msg-ai .toolcard {
    border: 1px solid var(--border); border-radius: var(--radius-md);
    background: var(--bg-subtle); margin: 0 0 10px; overflow: hidden;
  }
  .msg-ai .toolcard-err { border-color: var(--danger); }
  .msg-ai .toolcard-head {
    display: flex; align-items: center; gap: 8px; padding: 7px 12px;
    background: var(--bg-hover); border-bottom: 1px solid var(--border);
  }
  .msg-ai .toolcard .tool-name {
    font-family: var(--font-mono); font-size: 12.5px; font-weight: 600; color: var(--fg);
  }
  .msg-ai .tool-status { margin-left: auto; font-family: var(--font-mono); font-size: 11px; font-weight: 500; }
  .msg-ai .tool-status.ok { color: var(--fg-subtle); }
  .msg-ai .tool-status.err { color: var(--danger); }
  .msg-ai .toolcard-in {
    padding: 10px 12px; font-family: var(--font-mono); font-size: 12px; line-height: 1.55;
    color: var(--fg); white-space: pre-wrap; word-break: break-word; overflow-x: auto;
  }
  .msg-ai .toolcard-out {
    padding: 8px 12px; border-top: 1px dashed var(--border);
    font-family: var(--font-mono); font-size: 11.5px; line-height: 1.5;
    color: var(--fg-subtle); white-space: pre-wrap; word-break: break-word;
  }
  .msg-ai details.thinking { color: var(--fg-muted); font-size: 13px; margin: 0 0 10px; }
  .msg-ai details.thinking summary { cursor: pointer; color: var(--fg-subtle); font-family: var(--font-mono); font-size: 12px; }
  .msg-ai details.thinking .thinking-body {
    white-space: pre-wrap; margin-top: 6px;
    border-left: 2px solid var(--border); padding-left: 12px;
  }
  .footer {
    font-family: var(--font-mono);
    text-align: center; color: var(--fg-subtle); font-size: 11.5px;
    letter-spacing: 0.03em; margin-top: 40px;
    display: flex; align-items: center; justify-content: center; gap: 8px;
  }
  .footer .mark { color: var(--fg-subtle); opacity: 0.7; }
  @media (prefers-color-scheme: dark) {
    .header::before { opacity: 0.55; }
  }
`;

/** airgap 品牌 mark（inline SVG，零外链）：两块圆角矩形中间留一道竖隙，喻 "air gap" 物理隔离。 */
export function airgapMark(size: number): string {
  return `<svg class="mark" width="${size}" height="${size}" viewBox="0 0 18 18" fill="none" aria-hidden="true"><rect x="1.6" y="3.2" width="5.4" height="11.6" rx="1.6" fill="currentColor"/><rect x="11" y="3.2" width="5.4" height="11.6" rx="1.6" fill="currentColor"/></svg>`;
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

/** 单轮的聊天风片段：轮次分隔 + 用户撞色气泡 + AI 描边卡片。每个工具调用渲染成一张工具卡。供预览面板逐轮拼装复用。 */
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
        `<details class="thinking"><summary>💭 思考过程</summary><div class="thinking-body">${escapeHtml(block.text)}</div></details>`,
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

/** 单文件 Monad 风聊天 HTML：serif 标题 + mono 正文 + 羊皮纸底，深色跟随系统（PNG 截图恒为浅色）。 */
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
