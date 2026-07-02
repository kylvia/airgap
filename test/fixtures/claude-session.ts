import { mkdirSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SessionInfo } from "../../src/types.js";

export const SID = "11111111-1111-4111-8111-111111111111";
export const FIXTURE_CWD = "/Users/tester/demo-proj";
/** planted in u5's assistant text; ccpack/pack tests scan for it with a fake scanner */
export const SECRET = "sk-test-FIXTURESECRETAAAABBBB1234";

function base(over: Record<string, unknown>): Record<string, unknown> {
  return {
    parentUuid: null,
    isSidechain: false,
    sessionId: SID,
    timestamp: "2026-07-01T00:00:00.000Z",
    cwd: FIXTURE_CWD,
    version: "2.1.198",
    gitBranch: "main",
    ...over,
  };
}

/**
 * A synthetic claude session exercising every closure rule:
 *   chain: u1 u2 u3 u3b u4 u5 u6 u7 u8 u8b u9 u10  (root -> leaf)
 *   user prompts (turn boundaries): u1, u3b, u7, u8b
 *   m1 spans two records (u2 thinking + u3 tool_use)   — same-message.id grouping
 *   toolu_01: use u3, result u4 — with prompt u3b in between (cross-boundary pair)
 *   toolu_02: use u8, result u9 — with prompt u8b in between (cross-boundary pair)
 *   u6 is an isCompactSummary user record
 *   u9 references subagent agent-aaa
 *   plus droppable noise: mode / file-history-snapshot / sidechain user / progress
 *   plus a summary record pointing at leaf u10
 */
export function fixtureLines(homeDir: string = os.homedir()): string[] {
  const l = (o: Record<string, unknown>): string => JSON.stringify(o);
  return [
    l({ type: "mode", mode: "normal", sessionId: SID }),
    l({ type: "file-history-snapshot", messageId: "u1", snapshot: { trackedFileBackups: {} } }),
    l(base({ type: "user", uuid: "u1", promptId: "p1", message: { role: "user", content: "first question" } })),
    l(
      base({
        type: "assistant",
        uuid: "u2",
        parentUuid: "u1",
        promptId: "p1",
        message: {
          id: "m1",
          role: "assistant",
          content: [{ type: "thinking", thinking: "let me think about it", signature: "SIGSIGSIG" }],
        },
      }),
    ),
    l(
      base({
        type: "assistant",
        uuid: "u3",
        parentUuid: "u2",
        promptId: "p1",
        message: {
          id: "m1",
          role: "assistant",
          content: [{ type: "tool_use", id: "toolu_01", name: "Bash", input: { command: `cat ${FIXTURE_CWD}/a.txt` } }],
        },
      }),
    ),
    l(base({ type: "user", uuid: "u3b", parentUuid: "u3", promptId: "p2", message: { role: "user", content: "queued question" } })),
    l(
      base({
        type: "user",
        uuid: "u4",
        parentUuid: "u3b",
        promptId: "p1",
        message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_01", content: "file contents here" }] },
        toolUseResult: { stdout: "file contents here", stderr: "" },
        sourceToolAssistantUUID: "u3",
      }),
    ),
    l(
      base({
        type: "assistant",
        uuid: "u5",
        parentUuid: "u4",
        promptId: "p2",
        message: { id: "m2", role: "assistant", content: [{ type: "text", text: `answer one with token ${SECRET}` }] },
      }),
    ),
    l(
      base({
        type: "user",
        uuid: "u6",
        parentUuid: "u5",
        promptId: "p3",
        isCompactSummary: true,
        message: { role: "user", content: "This session is being continued from a previous conversation…" },
      }),
    ),
    l(
      base({
        type: "user",
        uuid: "u7",
        parentUuid: "u6",
        promptId: "p4",
        message: { role: "user", content: `second question, see ${homeDir}/notes.txt` },
      }),
    ),
    l(
      base({
        type: "assistant",
        uuid: "u8",
        parentUuid: "u7",
        promptId: "p4",
        message: {
          id: "m3",
          role: "assistant",
          content: [{ type: "tool_use", id: "toolu_02", name: "Task", input: { prompt: "do sub work" } }],
        },
      }),
    ),
    l(base({ type: "user", uuid: "u8b", parentUuid: "u8", promptId: "p5", message: { role: "user", content: "one more thing" } })),
    l(
      base({
        type: "user",
        uuid: "u9",
        parentUuid: "u8b",
        promptId: "p4",
        message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_02", content: "subagent agent-aaa finished" }] },
        toolUseResult: { agentId: "agent-aaa" },
        sourceToolAssistantUUID: "u8",
      }),
    ),
    l(
      base({
        type: "assistant",
        uuid: "u10",
        parentUuid: "u9",
        promptId: "p5",
        message: { id: "m4", role: "assistant", content: [{ type: "text", text: `final answer at ${FIXTURE_CWD}/out.md` }] },
      }),
    ),
    l(base({ type: "user", uuid: "s1", isSidechain: true, message: { role: "user", content: "sidechain prompt" } })),
    l({ type: "progress", data: { message: "working" } }),
    l({ type: "summary", summary: "Demo session title", leafUuid: "u10" }),
  ];
}

/** Write the fixture session (transcript + sidecars) under baseDir and return its SessionInfo. */
export function writeFixtureSession(baseDir: string, homeDir?: string): SessionInfo {
  const projDir = path.join(baseDir, "-Users-tester-demo-proj");
  const sideDir = path.join(projDir, SID);
  mkdirSync(path.join(sideDir, "subagents"), { recursive: true });
  mkdirSync(path.join(sideDir, "tool-results"), { recursive: true });

  const file = path.join(projDir, `${SID}.jsonl`);
  writeFileSync(file, fixtureLines(homeDir).join("\n") + "\n");

  const agentJsonl = path.join(sideDir, "subagents", "agent-aaa.jsonl");
  writeFileSync(
    agentJsonl,
    JSON.stringify({
      type: "user",
      uuid: "a1",
      parentUuid: null,
      sessionId: SID,
      cwd: FIXTURE_CWD,
      message: { role: "user", content: `do sub work in ${FIXTURE_CWD}/sub` },
    }) + "\n",
  );
  const agentMeta = path.join(sideDir, "subagents", "agent-aaa.meta.json");
  writeFileSync(agentMeta, JSON.stringify({ agentId: "agent-aaa", task: "do sub work" }) + "\n");

  const tr1 = path.join(sideDir, "tool-results", "toolu_01.txt");
  writeFileSync(tr1, `big output one from ${FIXTURE_CWD}/a.txt\n`);
  const tr2 = path.join(sideDir, "tool-results", "toolu_02.txt");
  writeFileSync(tr2, "big output two (subagent transcript)\n");

  return {
    source: "claude",
    id: SID,
    file,
    cwd: FIXTURE_CWD,
    project: FIXTURE_CWD,
    mtimeMs: statSync(file).mtimeMs,
    sizeBytes: statSync(file).size,
    sidecars: { subagents: [agentJsonl, agentMeta], toolResults: [tr1, tr2] },
  };
}

/** A tiny session whose last tool_use has no result anywhere (interrupted session). */
export function writeUnclosedSession(baseDir: string): SessionInfo {
  const projDir = path.join(baseDir, "-Users-tester-unclosed");
  mkdirSync(projDir, { recursive: true });
  const sid = "22222222-2222-4222-8222-222222222222";
  const file = path.join(projDir, `${sid}.jsonl`);
  const lines = [
    JSON.stringify(base({ type: "user", uuid: "x1", sessionId: sid, message: { role: "user", content: "go" } })),
    JSON.stringify(
      base({
        type: "assistant",
        uuid: "x2",
        parentUuid: "x1",
        sessionId: sid,
        message: { id: "mx", role: "assistant", content: [{ type: "tool_use", id: "toolu_09", name: "Bash", input: { command: "sleep 999" } }] },
      }),
    ),
  ];
  writeFileSync(file, lines.join("\n") + "\n");
  return {
    source: "claude",
    id: sid,
    file,
    cwd: FIXTURE_CWD,
    project: FIXTURE_CWD,
    mtimeMs: statSync(file).mtimeMs,
    sizeBytes: statSync(file).size,
    sidecars: { subagents: [], toolResults: [] },
  };
}

/**
 * Codex rollout with scaffold messages (F13): two role=user scaffold response_items
 * (environment_context + AGENTS.md) that must NOT count as tail turn boundaries, plus
 * N real user turns. Also a function_call whose output sits after the last real turn's
 * boundary to exercise call_id pairing back-fill.
 */
export function writeCodexScaffoldSession(baseDir: string): SessionInfo {
  const dir = path.join(baseDir, "codex", "2026", "07", "02");
  mkdirSync(dir, { recursive: true });
  const id = "44444444-4444-4444-8444-444444444444";
  const file = path.join(dir, `rollout-2026-07-02T00-00-00-${id}.jsonl`);
  const l = (o: Record<string, unknown>): string => JSON.stringify(o);
  const um = (text: string): Record<string, unknown> => ({
    type: "response_item",
    payload: { type: "message", role: "user", content: [{ type: "input_text", text }] },
  });
  const am = (text: string): Record<string, unknown> => ({
    type: "response_item",
    payload: { type: "message", role: "assistant", content: [{ type: "output_text", text }] },
  });
  const lines = [
    l({ type: "session_meta", payload: { id, cwd: FIXTURE_CWD, cli_version: "0.99.0" } }),
    l(um("<environment_context>\ncwd: /x\n</environment_context>")), // scaffold, not a turn
    l(um("# AGENTS.md instructions\nbe nice")), // scaffold, not a turn
    l(um("real turn one")),
    l(am("answer one")),
    l(um("real turn two")),
    l({ ...am(""), payload: { type: "function_call", name: "shell", call_id: "cc1", arguments: "{}" } }),
    l(um("real turn three")),
    l({ ...am(""), payload: { type: "function_call_output", call_id: "cc1", output: "ok" } }),
    l(am("answer three")),
  ];
  writeFileSync(file, lines.join("\n") + "\n");
  return {
    source: "codex",
    id,
    file,
    cwd: FIXTURE_CWD,
    project: FIXTURE_CWD,
    mtimeMs: statSync(file).mtimeMs,
    sizeBytes: statSync(file).size,
    sidecars: { subagents: [], toolResults: [] },
  };
}

/**
 * Session where a subagent transcript references an *externalized* tool-result that the main
 * transcript never mentions (F14). Main transcript references subagent agent-bbb via a
 * tool_result; agent-bbb.jsonl in turn references toolu_88.txt. Two-phase filterSidecars must
 * keep toolu_88.txt even though the main transcript never names it.
 */
export function writeSubagentRefSession(baseDir: string): SessionInfo {
  const projDir = path.join(baseDir, "-Users-tester-subref");
  const sid = "55555555-5555-4555-8555-555555555555";
  const sideDir = path.join(projDir, sid);
  mkdirSync(path.join(sideDir, "subagents"), { recursive: true });
  mkdirSync(path.join(sideDir, "tool-results"), { recursive: true });
  const file = path.join(projDir, `${sid}.jsonl`);
  const l = (o: Record<string, unknown>): string => JSON.stringify(o);
  const lines = [
    l(base({ type: "user", uuid: "r1", sessionId: sid, message: { role: "user", content: "start" } })),
    l(
      base({
        type: "assistant",
        uuid: "r2",
        parentUuid: "r1",
        sessionId: sid,
        message: { id: "rm1", role: "assistant", content: [{ type: "tool_use", id: "toolu_77", name: "Task", input: { prompt: "sub" } }] },
      }),
    ),
    l(
      base({
        type: "user",
        uuid: "r3",
        parentUuid: "r2",
        sessionId: sid,
        message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_77", content: "subagent agent-bbb finished" }] },
        toolUseResult: { agentId: "agent-bbb" },
        sourceToolAssistantUUID: "r2",
      }),
    ),
    l(base({ type: "assistant", uuid: "r4", parentUuid: "r3", sessionId: sid, message: { id: "rm2", role: "assistant", content: [{ type: "text", text: "done" }] } })),
  ];
  writeFileSync(file, lines.join("\n") + "\n");

  // subagent jsonl references toolu_88 — a tool-result the MAIN transcript never mentions
  const agentJsonl = path.join(sideDir, "subagents", "agent-bbb.jsonl");
  writeFileSync(
    agentJsonl,
    JSON.stringify({
      type: "user",
      uuid: "b1",
      parentUuid: null,
      sessionId: sid,
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_88", content: "see toolu_88.txt" }] },
    }) + "\n",
  );
  const tr = path.join(sideDir, "tool-results", "toolu_88.txt");
  writeFileSync(tr, "externalized big output referenced only by the subagent\n");
  // an unreferenced tool-result that must be dropped
  const trUnref = path.join(sideDir, "tool-results", "toolu_99.txt");
  writeFileSync(trUnref, "nobody references this\n");

  return {
    source: "claude",
    id: sid,
    file,
    cwd: FIXTURE_CWD,
    project: FIXTURE_CWD,
    mtimeMs: statSync(file).mtimeMs,
    sizeBytes: statSync(file).size,
    sidecars: { subagents: [agentJsonl], toolResults: [tr, trUnref] },
  };
}

/** Minimal codex rollout: session_meta + two user turns. */
export function writeCodexSession(baseDir: string): SessionInfo {
  const dir = path.join(baseDir, "codex", "2026", "07", "01");
  mkdirSync(dir, { recursive: true });
  const id = "33333333-3333-4333-8333-333333333333";
  const file = path.join(dir, `rollout-2026-07-01T00-00-00-${id}.jsonl`);
  const l = (o: Record<string, unknown>): string => JSON.stringify(o);
  const lines = [
    l({ type: "session_meta", payload: { id, cwd: FIXTURE_CWD, cli_version: "0.99.0" } }),
    l({ timestamp: "t1", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "codex q1" }] } }),
    l({ timestamp: "t2", type: "response_item", payload: { type: "function_call", name: "shell", call_id: "c1", arguments: "{}" } }),
    l({ timestamp: "t3", type: "response_item", payload: { type: "function_call_output", call_id: "c1", output: "ok" } }),
    l({ timestamp: "t4", type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "codex a1" }] } }),
    l({ timestamp: "t5", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "codex q2" }] } }),
    l({ timestamp: "t6", type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "codex a2" }] } }),
  ];
  writeFileSync(file, lines.join("\n") + "\n");
  return {
    source: "codex",
    id,
    file,
    cwd: FIXTURE_CWD,
    project: FIXTURE_CWD,
    mtimeMs: statSync(file).mtimeMs,
    sizeBytes: statSync(file).size,
    sidecars: { subagents: [], toolResults: [] },
  };
}
