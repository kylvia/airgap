import type { JsonlRecord, SessionSource, Turn } from "../types.js";

/** tool_use 折叠为一行时 input 摘要的最大长度（字符） */
const TOOL_SUMMARY_MAX = 80;

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** `工具名: input 摘要（≤80 字符）` */
function toolSummary(name: string, input: unknown): string {
  let brief: string;
  if (typeof input === "string") {
    brief = input;
  } else if (input === undefined) {
    brief = "";
  } else {
    try {
      brief = JSON.stringify(input) ?? "";
    } catch {
      brief = String(input);
    }
  }
  return `${name}: ${truncate(collapseWhitespace(brief), TOOL_SUMMARY_MAX)}`;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function recordTimestamp(j: Record<string, unknown>): string | null {
  const ts = j["timestamp"];
  return typeof ts === "string" ? ts : null;
}

// ---------- Claude ----------

/**
 * 清洗 user 记录里的字符串内容：
 * - `<local-command-stdout>`（本地命令输出，isMeta 常为 false）→ 不算用户文本
 * - `<system-reminder>` 注入块 → 不算用户文本
 * - 斜杠命令 XML（<command-name>/<command-args>）→ 压缩成 `/name args`
 */
function cleanClaudeUserString(s: string): string | null {
  if (s.includes("<local-command-stdout>")) return null;
  if (s.trimStart().startsWith("<system-reminder>")) return null;
  const name = /<command-name>([\s\S]*?)<\/command-name>/.exec(s);
  if (name) {
    const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(s);
    const label = `${(name[1] ?? "").trim()} ${(args?.[1] ?? "").trim()}`.trim();
    return label.length > 0 ? label : null;
  }
  const trimmed = s.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * 提取 user 记录的可见文本。返回 null 表示"不开新 turn"：
 * tool_result 承载记录、纯注入内容、空内容。
 */
function claudeUserText(content: unknown): string | null {
  if (typeof content === "string") return cleanClaudeUserString(content);
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const block of content) {
    const b = asRecord(block);
    if (!b) continue;
    const t = b["type"];
    if (t === "tool_result") return null; // tool_result 承载记录：跳过，不开新 turn
    if (t === "text") {
      const text = b["text"];
      if (typeof text === "string") {
        const cleaned = cleanClaudeUserString(text);
        if (cleaned !== null) parts.push(cleaned);
      }
    } else if (t === "image") {
      parts.push("[图片]");
    } else if (t === "document") {
      parts.push("[文档]");
    }
  }
  const joined = parts.join("\n").trim();
  return joined.length > 0 ? joined : null;
}

function pushClaudeAssistantBlocks(turn: Turn, message: Record<string, unknown>): void {
  const content = message["content"];
  if (typeof content === "string") {
    const trimmed = content.trim();
    if (trimmed) turn.assistant.push({ kind: "text", text: content });
    return;
  }
  if (!Array.isArray(content)) return;
  for (const block of content) {
    const b = asRecord(block);
    if (!b) continue;
    const t = b["type"];
    if (t === "text") {
      const text = b["text"];
      if (typeof text === "string" && text.trim()) turn.assistant.push({ kind: "text", text });
    } else if (t === "thinking") {
      const thinking = b["thinking"];
      if (typeof thinking === "string" && thinking.trim()) turn.assistant.push({ kind: "thinking", text: thinking });
    } else if (t === "tool_use") {
      const name = typeof b["name"] === "string" ? b["name"] : "tool";
      turn.assistant.push({ kind: "tool", text: toolSummary(name, b["input"]) });
    }
    // 其他块类型（fallback 等）跳过
  }
}

function extractClaudeTurns(records: JsonlRecord[]): Turn[] {
  const turns: Turn[] = [];
  let current: Turn | null = null;
  for (const rec of records) {
    const j = rec.json;
    if (!j) continue;
    if (j["isSidechain"] === true) continue; // 子代理侧链不进主对话
    const type = j["type"];
    if (type === "user") {
      if (j["isMeta"] === true) continue;
      if (j["isCompactSummary"] === true) continue; // 压缩摘要是簿记，不是用户发言
      const message = asRecord(j["message"]);
      if (!message) continue;
      const userText = claudeUserText(message["content"]);
      if (userText === null) continue;
      current = { index: turns.length + 1, userText, assistant: [], timestamp: recordTimestamp(j) };
      turns.push(current);
    } else if (type === "assistant") {
      if (!current) continue;
      const message = asRecord(j["message"]);
      if (!message) continue;
      pushClaudeAssistantBlocks(current, message);
    }
    // attachment / mode / system / progress / summary 等类型直接跳过
  }
  return turns;
}

// ---------- Codex ----------

const CODEX_SCAFFOLD_PREFIXES = [
  "<user_instructions>",
  "<environment_context>",
  "<permissions instructions>",
  "<ide_context>",
  "# AGENTS.md instructions",
];

function isCodexScaffold(text: string): boolean {
  const head = text.trimStart();
  return CODEX_SCAFFOLD_PREFIXES.some((p) => head.startsWith(p));
}

function codexMessageText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const item of content) {
    const it = asRecord(item);
    if (!it) continue;
    const t = it["type"];
    const text = it["text"];
    if ((t === "input_text" || t === "output_text" || t === "text") && typeof text === "string" && text.trim()) {
      parts.push(text);
    }
  }
  return parts.join("\n").trim();
}

function codexReasoningText(payload: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of ["summary", "content"]) {
    const arr = payload[key];
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      const it = asRecord(item);
      if (!it) continue;
      const text = it["text"];
      if (typeof text === "string" && text.trim()) parts.push(text);
    }
  }
  return parts.join("\n").trim();
}

function extractCodexTurns(records: JsonlRecord[]): Turn[] {
  const turns: Turn[] = [];
  let current: Turn | null = null;
  for (const rec of records) {
    const j = rec.json;
    if (!j) continue;
    if (j["type"] !== "response_item") continue; // session_meta / event_msg / turn_context 跳过
    const payload = asRecord(j["payload"]);
    if (!payload) continue;
    const pt = payload["type"];
    if (pt === "message") {
      const role = payload["role"];
      const text = codexMessageText(payload["content"]);
      if (role === "user") {
        if (!text || isCodexScaffold(text)) continue;
        current = { index: turns.length + 1, userText: text, assistant: [], timestamp: recordTimestamp(j) };
        turns.push(current);
      } else if (role === "assistant") {
        if (current && text) current.assistant.push({ kind: "text", text });
      }
      // developer / system 消息跳过
    } else if (pt === "reasoning") {
      if (!current) continue;
      const text = codexReasoningText(payload);
      if (text) current.assistant.push({ kind: "thinking", text });
    } else if (pt === "function_call" || pt === "custom_tool_call") {
      if (!current) continue;
      const name = typeof payload["name"] === "string" ? payload["name"] : "tool";
      const input = pt === "function_call" ? payload["arguments"] : payload["input"];
      current.assistant.push({ kind: "tool", text: toolSummary(name, input) });
    } else if (pt === "web_search_call") {
      if (!current) continue;
      const action = asRecord(payload["action"]);
      const brief =
        action && typeof action["query"] === "string"
          ? action["query"]
          : action && typeof action["url"] === "string"
            ? action["url"]
            : "";
      current.assistant.push({ kind: "tool", text: toolSummary("web_search", brief) });
    }
    // function_call_output / custom_tool_call_output 等跳过
  }
  return turns;
}

// ---------- 入口 ----------

export function extractTurns(records: JsonlRecord[], source: SessionSource): Turn[] {
  return source === "codex" ? extractCodexTurns(records) : extractClaudeTurns(records);
}
