import type { JsonlRecord, SessionSource, Turn, TurnBlock } from "../types.js";
import { isCodexScaffold } from "../util/codex.js";

/** tool_use 折叠为一行时 input 摘要的最大长度（字符） */
const TOOL_SUMMARY_MAX = 80;
/** toolcard 输入区：展开的结构化 input 上限（字符） */
const TOOL_INPUT_MAX = 600;
/** toolcard 结果区：保留前几行、整体字符上限 */
const TOOL_RESULT_LINES = 6;
const TOOL_RESULT_MAX = 400;

/**
 * 常见工具的"主参数"字段，按优先级取第一个存在的字符串值作为摘要，
 * 避免把整个 input 对象 JSON.stringify 出来（那样一行全是 {"command":...} 噪声）。
 */
const TOOL_PRIMARY_FIELDS = [
  "command",
  "file_path",
  "notebook_path",
  "path",
  "pattern",
  "query",
  "url",
  "prompt",
  "description",
  "subagent_type",
  "old_string",
  "content",
  "name",
];

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * 主参数完整值（截断到 TOOL_INPUT_MAX）：字符串 input 本身，或对象里按
 * TOOL_PRIMARY_FIELDS 优先级取第一个字符串值。没有明确主参数时返回 undefined
 * （摘要有自己的兜底链，但那不算"主参数"）。喂给渲染层做按工具类型的差异化。
 */
function primaryValue(input: unknown): string | undefined {
  if (typeof input === "string") {
    const s = input.trim();
    return s.length > 0 ? truncate(s, TOOL_INPUT_MAX) : undefined;
  }
  const obj = asRecord(input);
  if (!obj) return undefined;
  for (const key of TOOL_PRIMARY_FIELDS) {
    const v = obj[key];
    if (typeof v === "string" && v.trim()) return truncate(v.trim(), TOOL_INPUT_MAX);
  }
  return undefined;
}

/** `工具名: 主参数摘要（≤80 字符）` */
function toolSummary(name: string, input: unknown): string {
  let brief = primaryValue(input) ?? "";
  if (!brief && input && typeof input === "object" && !Array.isArray(input)) {
    const obj = input as Record<string, unknown>;
    for (const v of Object.values(obj)) {
      if (typeof v === "string" && v.trim()) {
        brief = v;
        break;
      }
    }
    if (!brief) {
      try {
        brief = JSON.stringify(input) ?? "";
      } catch {
        brief = String(input);
      }
    }
  }
  return `${name}: ${truncate(collapseWhitespace(brief), TOOL_SUMMARY_MAX)}`;
}

/**
 * tool_use 的 input 展开成结构化文本（给 toolcard 输入区，比一行摘要更完整）：
 * 字符串直接给；单参数对象只给值（不套 key 前缀）；多参数逐行 `key: value`；整体截断。
 */
function structuredInput(input: unknown): string | undefined {
  if (typeof input === "string") {
    const s = input.trim();
    return s.length > 0 ? truncate(s, TOOL_INPUT_MAX) : undefined;
  }
  const obj = asRecord(input);
  if (!obj) return undefined;
  const entries = Object.entries(obj).filter(([, v]) => v != null && v !== "");
  const single = entries.length === 1;
  const lines: string[] = [];
  for (const [k, v] of entries) {
    let val: string;
    if (typeof v === "string") val = v;
    else {
      try {
        val = JSON.stringify(v) ?? "";
      } catch {
        val = String(v);
      }
    }
    val = val.trim();
    if (!val) continue;
    lines.push(single ? val : `${k}: ${val}`);
  }
  return lines.length > 0 ? truncate(lines.join("\n"), TOOL_INPUT_MAX) : undefined;
}

/** 工具结果摘要（给 toolcard 结果区）：丢空行、保留前几行、整体截断；空结果返回 undefined。 */
function summarizeResult(text: string): string | undefined {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return undefined;
  const head = lines.slice(0, TOOL_RESULT_LINES).join("\n");
  const clipped = lines.length > TOOL_RESULT_LINES ? `${head}\n…` : head;
  return truncate(clipped, TOOL_RESULT_MAX);
}

/** tool_result.content：string 或 `[{type:"text",text}]` 块数组 → 文本。 */
function toolResultContentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    const b = asRecord(block);
    if (b && b["type"] === "text" && typeof b["text"] === "string") parts.push(b["text"]);
  }
  return parts.join("\n");
}

/** 顶层 toolUseResult（结构化原始结果）→ 文本，优先 stdout/stderr/output。 */
function structuredResultText(v: unknown): string {
  if (typeof v === "string") return v;
  const obj = asRecord(v);
  if (!obj) return "";
  const parts: string[] = [];
  for (const key of ["stdout", "stderr", "output", "text", "result"]) {
    const val = obj[key];
    if (typeof val === "string" && val.trim()) parts.push(val);
  }
  return parts.join("\n");
}

/** 从 tool_result 块 + 顶层 toolUseResult 抽取结果文本和错误标记。块内容优先，空则退回结构化结果。 */
function claudeResultText(
  b: Record<string, unknown>,
  toolUseResult: unknown,
): { text: string; isError: boolean } {
  const isError = b["is_error"] === true;
  let text = toolResultContentText(b["content"]);
  if (!text.trim()) text = structuredResultText(toolUseResult);
  return { text, isError };
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

function pushClaudeAssistantBlocks(
  turn: Turn,
  message: Record<string, unknown>,
  toolIndex: Map<string, TurnBlock>,
): void {
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
      const tb: TurnBlock = {
        kind: "tool",
        text: toolSummary(name, b["input"]),
        toolName: name,
        toolInput: structuredInput(b["input"]),
        toolPrimary: primaryValue(b["input"]),
      };
      turn.assistant.push(tb);
      const id = b["id"];
      if (typeof id === "string") toolIndex.set(id, tb);
    }
    // 其他块类型（fallback 等）跳过
  }
}

/** tool_result 承载记录：把结果摘要填回之前对应的 tool_use 卡。返回是否处理了（用于判定不开新 turn）。 */
function absorbClaudeToolResult(j: Record<string, unknown>, toolIndex: Map<string, TurnBlock>): void {
  const message = asRecord(j["message"]);
  if (!message) return;
  const content = message["content"];
  if (!Array.isArray(content)) return;
  for (const block of content) {
    const b = asRecord(block);
    if (!b || b["type"] !== "tool_result") continue;
    const id = b["tool_use_id"];
    if (typeof id !== "string") continue;
    const tb = toolIndex.get(id);
    if (!tb) continue;
    const { text, isError } = claudeResultText(b, j["toolUseResult"]);
    const summary = summarizeResult(text);
    if (summary) tb.toolResult = summary;
    if (isError) tb.toolError = true;
  }
}

function extractClaudeTurns(records: JsonlRecord[]): Turn[] {
  const turns: Turn[] = [];
  let current: Turn | null = null;
  const toolIndex = new Map<string, TurnBlock>(); // tool_use_id -> 卡片，供 tool_result 回填
  for (const rec of records) {
    const j = rec.json;
    if (!j) continue;
    if (j["isSidechain"] === true) continue; // 子代理侧链不进主对话
    const type = j["type"];
    if (type === "user") {
      const message = asRecord(j["message"]);
      if (message) absorbClaudeToolResult(j, toolIndex); // 先把工具结果回填到对应卡片
      const userText = userTextFromRecord(j, "claude");
      if (userText === null) continue; // tool_result 承载 / 空内容：不开新 turn
      current = { index: turns.length + 1, userText, assistant: [], timestamp: recordTimestamp(j) };
      turns.push(current);
    } else if (type === "assistant") {
      if (!current) continue;
      const message = asRecord(j["message"]);
      if (!message) continue;
      pushClaudeAssistantBlocks(current, message, toolIndex);
    }
    // attachment / mode / system / progress / summary 等类型直接跳过
  }
  return turns;
}

// ---------- Codex ----------

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

/** Extract visible user text from one source-specific record, or null for scaffolding/noise. */
export function userTextFromRecord(j: Record<string, unknown>, source: SessionSource): string | null {
  if (source === "claude") {
    if (j["type"] !== "user") return null;
    if (j["isSidechain"] === true || j["isMeta"] === true || j["isCompactSummary"] === true) return null;
    const message = asRecord(j["message"]);
    return message ? claudeUserText(message["content"]) : null;
  }

  if (j["type"] !== "response_item") return null;
  const payload = asRecord(j["payload"]);
  if (!payload || payload["type"] !== "message" || payload["role"] !== "user") return null;
  const text = codexMessageText(payload["content"]);
  return text && !isCodexScaffold(text) ? text : null;
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
  const toolIndex = new Map<string, TurnBlock>(); // call_id -> 卡片，供 *_output 回填
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
        const userText = userTextFromRecord(j, "codex");
        if (userText === null) continue;
        current = { index: turns.length + 1, userText, assistant: [], timestamp: recordTimestamp(j) };
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
      const tb: TurnBlock = {
        kind: "tool",
        text: toolSummary(name, input),
        toolName: name,
        toolInput: structuredInput(input),
        toolPrimary: primaryValue(input),
      };
      current.assistant.push(tb);
      const callId = payload["call_id"];
      if (typeof callId === "string") toolIndex.set(callId, tb);
    } else if (pt === "function_call_output" || pt === "custom_tool_call_output") {
      const callId = payload["call_id"];
      if (typeof callId !== "string") continue;
      const tb = toolIndex.get(callId);
      if (!tb) continue;
      const out = payload["output"];
      let text = "";
      if (typeof out === "string") {
        text = out;
      } else {
        const or = asRecord(out);
        if (or && typeof or["output"] === "string") text = or["output"];
        else {
          try {
            text = JSON.stringify(out) ?? "";
          } catch {
            /* ignore */
          }
        }
      }
      const summary = summarizeResult(text);
      if (summary) tb.toolResult = summary;
    } else if (pt === "web_search_call") {
      if (!current) continue;
      const action = asRecord(payload["action"]);
      const brief =
        action && typeof action["query"] === "string"
          ? action["query"]
          : action && typeof action["url"] === "string"
            ? action["url"]
            : "";
      current.assistant.push({
        kind: "tool",
        text: toolSummary("web_search", brief),
        toolName: "web_search",
        toolInput: structuredInput(brief),
        toolPrimary: primaryValue(brief),
      });
    }
    // function_call_output / custom_tool_call_output 等跳过
  }
  return turns;
}

// ---------- 入口 ----------

export function extractTurns(records: JsonlRecord[], source: SessionSource): Turn[] {
  return source === "codex" ? extractCodexTurns(records) : extractClaudeTurns(records);
}
