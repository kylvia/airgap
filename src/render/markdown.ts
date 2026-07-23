import type { ToolDisplay, Turn } from "../types.js";
import { DEFAULT_TOOL_DISPLAY } from "../types.js";
import { createI18n, type Locale } from "../i18n/index.js";
import { stripInlineImageData } from "./image-data.js";

function blockquote(s: string): string {
  return s
    .split("\n")
    .map((line) => (line.trim().length > 0 ? `> ${line}` : ">"))
    .join("\n");
}

/**
 * 干净 markdown 输出：AI 文本原样保留（本身就是 markdown），
 * 用户文本用 blockquote 区隔，thinking 折叠进 blockquote，工具行折叠成列表项。
 * opts.tools=none 时工具行整体省略；markdown 出口本来就是一行摘要形态，full 与 summary 等价。
 */
export function renderMarkdown(
  turns: Turn[],
  meta: { title: string; date: string },
  opts?: { tools?: ToolDisplay; locale?: Locale },
): string {
  const tools = opts?.tools ?? DEFAULT_TOOL_DISPLAY;
  const i18n = createI18n(opts?.locale ?? "zh-CN");
  const out: string[] = [];
  out.push(`# ${meta.title}`);
  out.push("");
  out.push(`> ${meta.date} · ${i18n.t("share.turnCount", { count: turns.length })} · ${i18n.t("render.footer")}`);
  out.push("");
  for (const turn of turns) {
    out.push(`## ${i18n.t("render.turn", { index: turn.index })}`);
    out.push("");
    out.push(`**${i18n.t("render.user")}**`);
    out.push("");
    out.push(blockquote(turn.userText));
    out.push("");
    if (turn.assistant.length > 0) {
      out.push(`**${i18n.t("render.ai")}**`);
      out.push("");
      for (const block of turn.assistant) {
        if (block.kind === "text") {
          out.push(block.text.trim());
        } else if (block.kind === "thinking") {
          out.push(blockquote(i18n.t("render.thinkingMarkdown", { text: block.text.trim() })));
        } else {
          if (tools === "none") continue;
          out.push(`- 🔧 \`${block.text.replace(/`/g, "'")}\``);
        }
        out.push("");
      }
    }
  }
  return `${stripInlineImageData(out.join("\n")).trimEnd()}\n`;
}
