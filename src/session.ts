import path from "node:path";
import type { JsonlRecord, RuleMatch, SessionInfo, Turn } from "./types.js";
import { createRedactor } from "./redact.js";
import { streamLines, tryParse } from "./util/jsonl.js";

/** Collapse all whitespace runs to single spaces and trim. */
export function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Read a whole transcript file into JsonlRecord[] (raw + parsed). */
export async function readRecords(file: string): Promise<JsonlRecord[]> {
  const records: JsonlRecord[] = [];
  for await (const { line, lineNo } of streamLines(file)) {
    records.push({ raw: line, lineNo, json: tryParse(line) });
  }
  return records;
}

/** Best-effort human title: latest ai-title record, else "<project> · 会话片段". */
export function sessionTitle(records: JsonlRecord[], info: SessionInfo): string {
  for (let i = records.length - 1; i >= 0; i--) {
    const j = records[i]?.json;
    if (j && j["type"] === "ai-title" && typeof j["aiTitle"] === "string" && j["aiTitle"].trim()) {
      return j["aiTitle"].trim();
    }
  }
  const base = info.cwd ? path.basename(info.cwd) : info.project;
  return `${base} · 会话片段`;
}

/** --session prefix wins; otherwise the cwd-matching session, else the most recent. */
export function pickSession(sessions: SessionInfo[], opts: { session?: string }): SessionInfo | null {
  if (opts.session) {
    const prefix = opts.session;
    const hit = sessions.filter((s) => s.id.startsWith(prefix)).sort((a, b) => b.mtimeMs - a.mtimeMs);
    return hit[0] ?? null;
  }
  const sorted = [...sessions].sort((a, b) => b.mtimeMs - a.mtimeMs);
  const cwd = process.cwd();
  return sorted.find((s) => s.cwd === cwd) ?? sorted[0] ?? null;
}

/**
 * Scan every string that actually gets rendered into an export, deduped by (ruleId, secret).
 * For a tool block, `block.text` is only the ≤80-char one-line summary — the structured
 * `toolInput` (e.g. a Write body / Edit strings) and the `toolResult` (e.g. a `cat .env`
 * output, the canonical leak) are what reach the exported HTML/PNG/MD, so they must be
 * scanned too. Missing them made `show`/`share` export secrets the pre-export scan claimed
 * to check.
 */
export function scanTurns(turns: Turn[], scan: (s: string) => RuleMatch[]): RuleMatch[] {
  const seen = new Set<string>();
  const findings: RuleMatch[] = [];
  const visit = (text: string | undefined): void => {
    if (!text) return;
    for (const m of scan(text)) {
      const key = `${m.ruleId} ${m.secret}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push(m);
    }
  };
  for (const turn of turns) {
    visit(turn.userText);
    for (const block of turn.assistant) {
      visit(block.text);
      visit(block.toolInput);
      visit(block.toolResult);
    }
  }
  return findings;
}

/** Findings for a single turn (used to flag ⚠ per-row in the picker UI). */
export function scanOneTurn(turn: Turn, scan: (s: string) => RuleMatch[]): RuleMatch[] {
  return scanTurns([turn], scan);
}

/**
 * Redact every rendered string in the given turns (userText + each block's text / toolInput /
 * toolResult) with ONE consistency map — the same secret maps to the same placeholder across
 * all fields, exactly like a pack. Returns fresh turns (inputs untouched) plus the count of
 * distinct secrets redacted, for an export receipt. Fail-closed: the underlying redactor throws
 * if any secret survives, so redacted turns are guaranteed clean.
 */
export function redactTurns(turns: Turn[], scan: (s: string) => RuleMatch[]): { turns: Turn[]; count: number } {
  const redactor = createRedactor(scan);
  const opt = (s: string | undefined): string | undefined => (s === undefined ? undefined : redactor.redactText(s));
  const out: Turn[] = turns.map((t) => ({
    ...t,
    userText: redactor.redactText(t.userText),
    assistant: t.assistant.map((b) => ({
      ...b,
      text: redactor.redactText(b.text),
      toolInput: opt(b.toolInput),
      toolResult: opt(b.toolResult),
    })),
  }));
  const count = Object.keys(redactor.result().reverseMap).length;
  return { turns: out, count };
}

/**
 * A short tag for a turn whose user message is not a real question:
 * background task notifications, slash commands, image-only messages, IDE noise.
 * Returns "" for a normal user turn.
 */
export function turnTag(userText: string): string {
  const t = userText.trim();
  if (t.startsWith("<task-notification") || t.startsWith("<task-id")) return "任务通知";
  if (t.startsWith("[图片]") || t === "[图片]") return "图片";
  if (t.startsWith("/")) return "命令";
  if (t.startsWith("<ide_selection") || t.startsWith("<local-command") || t.startsWith("<command-name")) return "系统";
  return "";
}
