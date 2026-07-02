import { readFile } from "node:fs/promises";
import path from "node:path";
import { streamLines, tryParse } from "./util/jsonl.js";
import { isCodexScaffold } from "./util/codex.js";
import type {
  JsonlRecord,
  SessionInfo,
  SidecarFiles,
  SliceOptions,
  SliceReport,
  SlicedSession,
} from "./types.js";

type J = Record<string, unknown>;

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function messageContent(json: J): unknown[] | null {
  const msg = json.message;
  if (!msg || typeof msg !== "object") return null;
  const content = (msg as J).content;
  return Array.isArray(content) ? content : null;
}

function isToolResultCarrier(json: J): boolean {
  const content = messageContent(json);
  if (!content) return false;
  return content.some((b) => !!b && typeof b === "object" && (b as J).type === "tool_result");
}

/** A real user prompt: starts a new turn. Compact summaries are synthetic, not prompts. */
function isUserPrompt(json: J): boolean {
  return (
    json.type === "user" &&
    json.isMeta !== true &&
    json.isSidechain !== true &&
    json.isCompactSummary !== true &&
    !isToolResultCarrier(json)
  );
}

function messageId(json: J): string | null {
  const msg = json.message;
  if (!msg || typeof msg !== "object") return null;
  return asString((msg as J).id);
}

function toolUseIds(json: J): string[] {
  if (json.type !== "assistant") return [];
  const out: string[] = [];
  for (const b of messageContent(json) ?? []) {
    if (!!b && typeof b === "object" && (b as J).type === "tool_use") {
      const id = asString((b as J).id);
      if (id) out.push(id);
    }
  }
  return out;
}

function toolResultIds(json: J): string[] {
  if (json.type !== "user") return [];
  const out: string[] = [];
  for (const b of messageContent(json) ?? []) {
    if (!!b && typeof b === "object" && (b as J).type === "tool_result") {
      const id = asString((b as J).tool_use_id);
      if (id) out.push(id);
    }
  }
  return out;
}

function recordType(r: JsonlRecord): string {
  const t = r.json ? asString(r.json.type) : null;
  return t ?? "invalid";
}

function reserialize(r: JsonlRecord): void {
  if (r.json) r.raw = JSON.stringify(r.json);
}

/**
 * Slice a session transcript down to a closed, self-contained record set.
 * Closure rules (see CONTRACTS.md): contiguous parentUuid chain, tool_use/tool_result
 * pairs never split, same message.id records never split, referenced sidecars carried,
 * head parentUuid rewritten to null, session-state record types dropped,
 * isCompactSummary user records always retained.
 */
export async function sliceSession(info: SessionInfo, opts: SliceOptions = {}): Promise<SlicedSession> {
  const records: JsonlRecord[] = [];
  for await (const { line, lineNo } of streamLines(info.file)) {
    records.push({ raw: line, lineNo, json: tryParse(line) });
  }
  if (info.source === "codex") return sliceCodex(info, records, opts);
  return sliceClaude(info, records, opts);
}

async function sliceClaude(info: SessionInfo, records: JsonlRecord[], opts: SliceOptions): Promise<SlicedSession> {
  // index by uuid
  const byUuid = new Map<string, JsonlRecord>();
  for (const r of records) {
    const u = r.json ? asString(r.json.uuid) : null;
    if (u && !byUuid.has(u)) byUuid.set(u, r);
  }

  // leaf = last main-chain message record in file order
  let leaf: JsonlRecord | undefined;
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i];
    const j = r?.json;
    if (!r || !j) continue;
    const t = j.type;
    if ((t === "user" || t === "assistant" || t === "system") && j.isSidechain !== true && asString(j.uuid)) {
      leaf = r;
      break;
    }
  }

  // backtrack leaf -> root, then reverse to root -> leaf
  const chain: JsonlRecord[] = [];
  {
    const seen = new Set<string>();
    let cur: JsonlRecord | undefined = leaf;
    while (cur && cur.json) {
      const u = asString(cur.json.uuid);
      if (!u || seen.has(u)) break;
      seen.add(u);
      chain.push(cur);
      const p = asString(cur.json.parentUuid);
      cur = p ? byUuid.get(p) : undefined;
    }
    chain.reverse();
  }

  // tail cut: start at the earliest of the last N user prompts
  let sliceStart = 0;
  if (opts.tail !== undefined && opts.tail > 0) {
    const promptIdx: number[] = [];
    chain.forEach((r, i) => {
      if (r.json && isUserPrompt(r.json)) promptIdx.push(i);
    });
    if (promptIdx.length > opts.tail) {
      sliceStart = promptIdx[promptIdx.length - opts.tail] ?? 0;
    }
  }

  const kept = new Set<JsonlRecord>();
  for (let i = sliceStart; i < chain.length; i++) {
    const r = chain[i];
    if (r) kept.add(r);
  }
  // compact summaries on the chain are always retained even before the tail cut
  for (const r of chain) {
    if (r.json?.isCompactSummary === true) kept.add(r);
  }

  // pairing / grouping indexes over the whole file
  const msgGroups = new Map<string, JsonlRecord[]>();
  const resultByToolUseId = new Map<string, JsonlRecord>();
  const useByToolUseId = new Map<string, JsonlRecord>();
  for (const r of records) {
    const j = r.json;
    if (!j || j.isSidechain === true) continue;
    if (j.type === "assistant") {
      const mid = messageId(j);
      if (mid) {
        const g = msgGroups.get(mid);
        if (g) g.push(r);
        else msgGroups.set(mid, [r]);
      }
      for (const id of toolUseIds(j)) useByToolUseId.set(id, r);
    } else if (j.type === "user") {
      for (const id of toolResultIds(j)) resultByToolUseId.set(id, r);
    }
  }

  // closure expansion to fixpoint: pull paired records in rather than fail
  let changed = true;
  while (changed) {
    changed = false;
    for (const r of [...kept]) {
      const j = r.json;
      if (!j) continue;
      const mid = j.type === "assistant" ? messageId(j) : null;
      if (mid) {
        for (const g of msgGroups.get(mid) ?? []) {
          if (!kept.has(g)) {
            kept.add(g);
            changed = true;
          }
        }
      }
      for (const id of toolUseIds(j)) {
        const res = resultByToolUseId.get(id);
        if (res && !kept.has(res)) {
          kept.add(res);
          changed = true;
        }
      }
      for (const id of toolResultIds(j)) {
        const use = useByToolUseId.get(id);
        if (use && !kept.has(use)) {
          kept.add(use);
          changed = true;
        }
      }
    }
  }

  // keep summary records whose leafUuid points into the slice
  const keptUuids = new Set<string>();
  for (const r of kept) {
    const u = r.json ? asString(r.json.uuid) : null;
    if (u) keptUuids.add(u);
  }
  for (const r of records) {
    const j = r.json;
    if (!j || j.type !== "summary") continue;
    const lu = asString(j.leafUuid);
    if (lu && keptUuids.has(lu)) kept.add(r);
  }

  // closure verification
  const keptUseIds = new Set<string>();
  const keptResultIds = new Set<string>();
  for (const r of kept) {
    if (!r.json) continue;
    for (const id of toolUseIds(r.json)) keptUseIds.add(id);
    for (const id of toolResultIds(r.json)) keptResultIds.add(id);
  }
  let toolUsePairs = 0;
  let closureComplete = true;
  for (const id of keptUseIds) {
    if (keptResultIds.has(id)) toolUsePairs += 1;
    else closureComplete = false;
  }
  for (const id of keptResultIds) {
    if (!keptUseIds.has(id)) closureComplete = false;
  }

  const keptList = records.filter((r) => kept.has(r));

  // rewrite parentUuid when the parent fell outside the slice (chain head + expansion orphans).
  //
  // F12: naively re-rooting every orphan to null strands a retained compact summary as an
  // isolated second root — the resume active chain (walked leaf->root via parentUuid) then
  // never reaches it and the pre-compaction context is silently lost. Instead we chain the
  // kept compact summaries together (earliest is the null root, each later one re-parents to
  // the previous) and re-parent every other orphan head to the nearest preceding kept compact
  // summary, so the active chain flows leaf -> ... -> compact summary -> null.
  let compactSummaryRerooted = false;
  let lastCompactUuid: string | null = null; // nearest preceding kept compact summary, in file order
  for (const r of keptList) {
    const j = r.json;
    if (!j) continue;
    const isCompact = j.isCompactSummary === true && j.type === "user";
    const p = asString(j.parentUuid);
    // parent pointer that does not resolve inside the slice (missing, or points outside)
    const parentOutside = p !== null && !keptUuids.has(p);

    if (isCompact) {
      // chain compact summaries: first stays/root=null, later ones link to the previous
      if (lastCompactUuid !== null) {
        if (j.parentUuid !== lastCompactUuid) {
          j.parentUuid = lastCompactUuid;
          reserialize(r);
        }
      } else if (parentOutside) {
        j.parentUuid = null;
        reserialize(r);
      }
      const u = asString(j.uuid);
      if (u) lastCompactUuid = u;
    } else if (parentOutside) {
      if (lastCompactUuid !== null) {
        j.parentUuid = lastCompactUuid;
        compactSummaryRerooted = true;
      } else {
        j.parentUuid = null;
      }
      reserialize(r);
    }
  }

  // strip thinking blocks (drops encrypted signature problem entirely)
  if (opts.stripThinking) {
    for (const r of keptList) {
      const j = r.json;
      if (!j || j.type !== "assistant") continue;
      const msg = j.message as J | undefined;
      const content = messageContent(j);
      if (!msg || !content) continue;
      const filtered = content.filter(
        (b) =>
          !(
            !!b &&
            typeof b === "object" &&
            ((b as J).type === "thinking" || (b as J).type === "redacted_thinking")
          ),
      );
      if (filtered.length !== content.length) {
        msg.content = filtered;
        reserialize(r);
      }
    }
  }

  const droppedTypes: Record<string, number> = {};
  for (const r of records) {
    if (kept.has(r)) continue;
    const t = recordType(r);
    droppedTypes[t] = (droppedTypes[t] ?? 0) + 1;
  }

  const sidecars = await filterSidecars(info.sidecars, keptList);

  const report: SliceReport = {
    totalRecords: records.length,
    keptRecords: keptList.length,
    droppedTypes,
    toolUsePairs,
    subagentFiles: sidecars.subagents.length,
    toolResultFiles: sidecars.toolResults.length,
    closureComplete,
    compactSummaryRerooted,
  };

  return { info, records: keptList, sidecars, report };
}

/** True when the given subagent sidecar file is referenced by the given matching text. */
function subagentReferenced(file: string, text: string): boolean {
  const token = path.basename(file).replace(/\.meta\.json$/, "").replace(/\.jsonl$/, "");
  if (token.length === 0) return false;
  if (text.includes(token)) return true;
  const idPart = token.startsWith("agent-") ? token.slice("agent-".length) : token;
  return idPart.length >= 8 && text.includes(idPart);
}

/**
 * Keep only sidecar files actually referenced by the kept records.
 *
 * F14: the main transcript is not the only referrer — a kept subagent jsonl may itself
 * reference tool-results (or further agent-*.jsonl). Matching only against the main
 * transcript text drops those and breaks the pack's closure rule (d). So we iterate to a
 * fixpoint: start from the main-transcript text, pull in every subagent it references, fold
 * that subagent's file contents into the matching text, and repeat until the selected
 * subagent set stops growing. tool-results are then filtered against the merged text.
 */
async function filterSidecars(all: SidecarFiles, keptList: JsonlRecord[]): Promise<SidecarFiles> {
  const mainText = keptList.map((r) => r.raw).join("\n");
  const contentCache = new Map<string, string>();
  const readContent = async (file: string): Promise<string> => {
    let c = contentCache.get(file);
    if (c === undefined) {
      try {
        c = await readFile(file, "utf8");
      } catch {
        c = "";
      }
      contentCache.set(file, c);
    }
    return c;
  };

  // fixpoint over the subagent set: each newly selected subagent's file content may reference
  // further subagents, so keep re-scanning until nothing new is added.
  const selected = new Set<string>();
  let mergedText = mainText;
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of all.subagents) {
      if (selected.has(f)) continue;
      if (subagentReferenced(f, mergedText)) {
        selected.add(f);
        changed = true;
        // only .jsonl files carry referencing content worth folding in (.meta.json is metadata)
        if (f.endsWith(".jsonl")) mergedText += "\n" + (await readContent(f));
      }
    }
  }

  const subagents = all.subagents.filter((f) => selected.has(f));
  const toolResults = all.toolResults.filter((f) => {
    const token = path.basename(f).replace(/\.txt$/, "");
    return token.length > 0 && mergedText.includes(token);
  });
  return { subagents, toolResults };
}

/** Concatenated text of a codex response_item message payload's content blocks. */
function codexUserPayloadText(j: J): string {
  const p = j.payload;
  if (!p || typeof p !== "object") return "";
  const content = (p as J).content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const t = (item as J).type;
    const text = (item as J).text;
    if ((t === "input_text" || t === "text") && typeof text === "string") parts.push(text);
  }
  return parts.join("\n");
}

/** Codex rollouts are a linear stream: session_meta first, then response_item/event_msg/turn_context. */
function sliceCodex(info: SessionInfo, records: JsonlRecord[], opts: SliceOptions): SlicedSession {
  // A *real* user turn: role=user message whose text is not a codex scaffold injection
  // (<environment_context>/<user_instructions>/AGENTS.md/…). Scaffold records still travel
  // with the slice — they just don't count as tail turn boundaries (F13).
  const isRealUserTurn = (j: J): boolean => {
    if (j.type !== "response_item") return false;
    const p = j.payload;
    if (!p || typeof p !== "object" || (p as J).type !== "message" || (p as J).role !== "user") return false;
    const text = codexUserPayloadText(j);
    return text.trim().length > 0 && !isCodexScaffold(text);
  };

  let start = 0;
  if (opts.tail !== undefined && opts.tail > 0) {
    const idx: number[] = [];
    records.forEach((r, i) => {
      if (r.json && isRealUserTurn(r.json)) idx.push(i);
    });
    if (idx.length > opts.tail) start = idx[idx.length - opts.tail] ?? 0;
  }

  const inWindow = new Set<JsonlRecord>();
  records.forEach((r, i) => {
    if (r.json !== null && (r.json.type === "session_meta" || i >= start)) inWindow.add(r);
  });

  // call_id pairing extension: if a kept function_call/output has its partner outside the
  // window, pull the partner back in so tool pairs never split across the tail boundary.
  const callRecs = new Map<string, JsonlRecord>();
  const outputRecs = new Map<string, JsonlRecord>();
  for (const r of records) {
    const j = r.json;
    if (!j || j.type !== "response_item") continue;
    const p = j.payload;
    if (!p || typeof p !== "object") continue;
    const pj = p as J;
    const cid = asString(pj.call_id);
    if (!cid) continue;
    if (pj.type === "function_call") callRecs.set(cid, r);
    else if (pj.type === "function_call_output") outputRecs.set(cid, r);
  }
  for (const r of [...inWindow]) {
    const j = r.json;
    if (!j || j.type !== "response_item") continue;
    const p = j.payload;
    if (!p || typeof p !== "object") continue;
    const pj = p as J;
    const cid = asString(pj.call_id);
    if (!cid) continue;
    if (pj.type === "function_call") {
      const out = outputRecs.get(cid);
      if (out) inWindow.add(out);
    } else if (pj.type === "function_call_output") {
      const call = callRecs.get(cid);
      if (call) inWindow.add(call);
    }
  }

  const keptList: JsonlRecord[] = [];
  const droppedTypes: Record<string, number> = {};
  for (const r of records) {
    if (inWindow.has(r)) keptList.push(r);
    else {
      const t = recordType(r);
      droppedTypes[t] = (droppedTypes[t] ?? 0) + 1;
    }
  }

  // function_call <-> function_call_output pairing via call_id
  const callIds = new Set<string>();
  const outputIds = new Set<string>();
  for (const r of keptList) {
    const j = r.json;
    if (!j || j.type !== "response_item") continue;
    const p = j.payload;
    if (!p || typeof p !== "object") continue;
    const pj = p as J;
    const cid = asString(pj.call_id);
    if (!cid) continue;
    if (pj.type === "function_call") callIds.add(cid);
    else if (pj.type === "function_call_output") outputIds.add(cid);
  }
  let toolUsePairs = 0;
  let closureComplete = true;
  for (const id of callIds) {
    if (outputIds.has(id)) toolUsePairs += 1;
    else closureComplete = false;
  }
  for (const id of outputIds) {
    if (!callIds.has(id)) closureComplete = false;
  }

  const report: SliceReport = {
    totalRecords: records.length,
    keptRecords: keptList.length,
    droppedTypes,
    toolUsePairs,
    subagentFiles: info.sidecars.subagents.length,
    toolResultFiles: info.sidecars.toolResults.length,
    closureComplete,
  };

  return { info, records: keptList, sidecars: info.sidecars, report };
}
