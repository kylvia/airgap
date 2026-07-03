import path from "node:path";
import type { JsonlRecord, RuleMatch, SessionInfo, Turn } from "./types.js";
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

/** Scan every visible text in the given turns; dedup by (ruleId, secret). */
export function scanTurns(turns: Turn[], scan: (s: string) => RuleMatch[]): RuleMatch[] {
  const seen = new Set<string>();
  const findings: RuleMatch[] = [];
  const visit = (text: string): void => {
    for (const m of scan(text)) {
      const key = `${m.ruleId} ${m.secret}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push(m);
    }
  };
  for (const turn of turns) {
    visit(turn.userText);
    for (const block of turn.assistant) visit(block.text);
  }
  return findings;
}

/** Findings for a single turn (used to flag ⚠ per-row in the picker UI). */
export function scanOneTurn(turn: Turn, scan: (s: string) => RuleMatch[]): RuleMatch[] {
  return scanTurns([turn], scan);
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
