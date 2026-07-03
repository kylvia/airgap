import type { Turn } from "../types.js";

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

export const CHAT_CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    background: #ededed;
    color: #1a1a1a;
    line-height: 1.75;
    font-size: 15px;
  }
  .wrap { max-width: 700px; margin: 0 auto; padding: 24px 16px 40px; }
  .header { text-align: center; padding: 12px 0 20px; color: #888; font-size: 12.5px; }
  .header .title { font-size: 15px; color: #444; font-weight: 600; margin-bottom: 4px; }
  .turn-label { text-align: center; color: #aaa; font-size: 12px; margin: 22px 0 12px; }
  .msg-user { display: flex; justify-content: flex-end; margin: 14px 0; }
  .msg-user .bubble {
    background: #95ec69; border-radius: 8px; padding: 10px 14px;
    max-width: 82%; font-size: 14.5px; word-break: break-word;
  }
  .msg-ai {
    background: #fff; border-radius: 10px; padding: 18px 20px; margin: 14px 0;
    box-shadow: 0 1px 2px rgba(0,0,0,0.06); overflow-wrap: break-word;
  }
  .msg-ai p { margin: 0 0 12px; }
  .msg-ai p:last-child { margin-bottom: 0; }
  .msg-ai strong { font-weight: 600; }
  .msg-ai h2, .msg-ai h3, .msg-ai h4 { margin: 0 0 10px; line-height: 1.5; }
  .msg-ai h2 { font-size: 17px; }
  .msg-ai h3 { font-size: 16px; }
  .msg-ai h4 { font-size: 15px; }
  .msg-ai ol, .msg-ai ul { margin: 0 0 12px 1.4em; }
  .msg-ai li { margin-bottom: 6px; }
  .msg-ai code {
    font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 13px;
    background: #f2f3f5; border-radius: 4px; padding: 1px 5px; color: #c7254e;
  }
  .msg-ai pre {
    background: #282c34; color: #abb2bf; border-radius: 8px;
    padding: 14px 16px; overflow-x: auto; margin: 0 0 12px;
    font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 13px; line-height: 1.7;
  }
  .msg-ai pre code { background: none; color: inherit; padding: 0; }
  .msg-ai a { color: #576b95; text-decoration: none; }
  .msg-ai .tool {
    color: #8a8a8a; font-style: italic; font-size: 13px; margin: 0 0 8px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .msg-ai details.thinking { color: #999; font-size: 13px; margin: 0 0 10px; }
  .msg-ai details.thinking summary { cursor: pointer; color: #aaa; font-style: italic; }
  .msg-ai details.thinking .thinking-body { white-space: pre-wrap; margin-top: 6px; }
  .footer { text-align: center; color: #b0b0b0; font-size: 11.5px; margin-top: 28px; }
`;

/** 单轮的聊天风片段：轮次分隔 + 用户绿气泡 + AI 白卡片。供预览面板逐轮拼装复用。 */
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
      inner.push(`<div class="tool">🔧 ${escapeHtml(block.text)}</div>`);
    }
  }
  if (inner.length > 0) {
    out.push(`  <div class="msg-ai">\n${inner.join("\n")}\n  </div>`);
  }
  return out.join("\n");
}

/** 单文件微信聊天风 HTML：用户右侧绿气泡，AI 白卡片，深色代码块，工具行灰色斜体折叠。 */
export function renderHtml(turns: Turn[], meta: { title: string; date: string }): string {
  const body: string[] = [];
  body.push('  <div class="header">');
  body.push(`    <div class="title">${escapeHtml(meta.title)}</div>`);
  body.push(`    <div>${escapeHtml(meta.date)} · 共 ${turns.length} 轮</div>`);
  body.push("  </div>");
  for (const turn of turns) {
    body.push(renderTurnBlock(turn));
  }
  body.push('  <div class="footer">导出自本地会话 · Generated by airgap</div>');

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
