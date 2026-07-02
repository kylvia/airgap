import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { sliceSession } from "../src/slice.js";
import {
  writeCodexScaffoldSession,
  writeCodexSession,
  writeFixtureSession,
  writeSubagentRefSession,
  writeUnclosedSession,
} from "./fixtures/claude-session.js";

const tmp = mkdtempSync(path.join(os.tmpdir(), "airgap-slice-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const info = writeFixtureSession(path.join(tmp, "full"));

function uuidsOf(records: Array<{ json: Record<string, unknown> | null }>): string[] {
  return records.map((r) => r.json?.uuid).filter((u): u is string => typeof u === "string");
}

describe("sliceSession (claude, full)", () => {
  it("keeps the whole main chain plus its summary, drops session-state noise", async () => {
    const sliced = await sliceSession(info, {});
    const uuids = uuidsOf(sliced.records);
    expect(uuids).toEqual(["u1", "u2", "u3", "u3b", "u4", "u5", "u6", "u7", "u8", "u8b", "u9", "u10"]);
    // summary record has no uuid but is carried (leafUuid u10 in slice)
    expect(sliced.records.some((r) => r.json?.type === "summary")).toBe(true);
    expect(sliced.report.totalRecords).toBe(17);
    expect(sliced.report.keptRecords).toBe(13);
    expect(sliced.report.droppedTypes).toEqual({
      mode: 1,
      "file-history-snapshot": 1,
      user: 1, // sidechain record
      progress: 1,
    });
    expect(sliced.report.toolUsePairs).toBe(2);
    expect(sliced.report.closureComplete).toBe(true);
  });

  it("carries every referenced sidecar file", async () => {
    const sliced = await sliceSession(info, {});
    expect(sliced.report.subagentFiles).toBe(2); // agent-aaa.jsonl + agent-aaa.meta.json
    expect(sliced.report.toolResultFiles).toBe(2);
    expect(sliced.sidecars.toolResults.map((f) => path.basename(f)).sort()).toEqual(["toolu_01.txt", "toolu_02.txt"]);
  });

  it("keeps records in original file order with original raw for untouched lines", async () => {
    const sliced = await sliceSession(info, {});
    const lineNos = sliced.records.map((r) => r.lineNo);
    expect([...lineNos].sort((a, b) => a - b)).toEqual(lineNos);
    const u5 = sliced.records.find((r) => r.json?.uuid === "u5");
    expect(u5?.raw).toContain("answer one with token");
    expect(u5 && JSON.parse(u5.raw).parentUuid).toBe("u4");
  });
});

describe("sliceSession tail=N", () => {
  it("tail=1: starts at the last user prompt, pulls cross-boundary tool pair back in, keeps compact summary", async () => {
    const sliced = await sliceSession(info, { tail: 1 });
    const uuids = uuidsOf(sliced.records);
    // u8b is the last prompt; u9's tool_result forced u8 (its tool_use) back in;
    // u6 (isCompactSummary) is retained although it sits before the cut.
    expect(uuids).toEqual(["u6", "u8", "u8b", "u9", "u10"]);
    expect(sliced.report.toolUsePairs).toBe(1);
    expect(sliced.report.closureComplete).toBe(true);

    // F12: the retained compact summary (u6) is the null root; the active-chain head (u8,
    // whose real parent u7 fell outside the slice) re-parents to u6 instead of becoming a
    // second isolated root — so the pre-compaction context stays on the resume chain.
    const byUuid = new Map(sliced.records.map((r) => [r.json?.uuid, r]));
    expect(byUuid.get("u6")?.json?.parentUuid).toBeNull();
    expect(byUuid.get("u8")?.json?.parentUuid).toBe("u6");
    expect(byUuid.get("u8b")?.json?.parentUuid).toBe("u8");
    // re-rooting is reflected in raw too
    expect(JSON.parse(byUuid.get("u8")?.raw ?? "{}").parentUuid).toBe("u6");
    expect(sliced.report.compactSummaryRerooted).toBe(true);

    // active chain: walking leaf -> root via parentUuid must reach the compact summary
    const leaf = sliced.records.find((r) => r.json?.uuid === "u10");
    const chain: string[] = [];
    let cur = leaf;
    const guard = new Set<string>();
    while (cur?.json) {
      const u = cur.json.uuid as string | undefined;
      if (!u || guard.has(u)) break;
      guard.add(u);
      chain.push(u);
      const p = cur.json.parentUuid;
      cur = typeof p === "string" ? byUuid.get(p) : undefined;
    }
    expect(chain).toEqual(["u10", "u9", "u8b", "u8", "u6"]);
    expect(chain).toContain("u6"); // compact summary is on the active chain, not orphaned
  });

  it("tail=1: only referenced sidecars are carried", async () => {
    const sliced = await sliceSession(info, { tail: 1 });
    expect(sliced.sidecars.toolResults.map((f) => path.basename(f))).toEqual(["toolu_02.txt"]);
    expect(sliced.report.toolResultFiles).toBe(1);
    expect(sliced.report.subagentFiles).toBe(2); // agent-aaa referenced by u9
  });

  it("tail=3: closure expansion never splits a message.id group (m1 spans two records)", async () => {
    const sliced = await sliceSession(info, { tail: 3 });
    const uuids = uuidsOf(sliced.records);
    // cut lands at u3b; u4's tool_result pulls u3 in, and u3's message.id m1 pulls u2 in
    expect(uuids).toEqual(["u2", "u3", "u3b", "u4", "u5", "u6", "u7", "u8", "u8b", "u9", "u10"]);
    const byUuid = new Map(sliced.records.map((r) => [r.json?.uuid, r]));
    expect(byUuid.get("u2")?.json?.parentUuid).toBeNull(); // new head
    expect(byUuid.get("u3")?.json?.parentUuid).toBe("u2"); // group intact
    expect(sliced.report.toolUsePairs).toBe(2);
    expect(sliced.report.closureComplete).toBe(true);
  });

  it("tail larger than available prompts keeps everything", async () => {
    const sliced = await sliceSession(info, { tail: 99 });
    expect(sliced.report.keptRecords).toBe(13);
  });
});

describe("sliceSession stripThinking", () => {
  it("removes thinking blocks (and their signatures) without touching uuids or tool_use blocks", async () => {
    const sliced = await sliceSession(info, { stripThinking: true });
    const u2 = sliced.records.find((r) => r.json?.uuid === "u2");
    expect(u2).toBeDefined();
    expect(u2?.raw).not.toContain("SIGSIGSIG");
    expect(u2?.raw).not.toContain('"thinking"');
    const msg = (u2?.json as { message: { id: string; content: unknown[] } }).message;
    expect(msg.id).toBe("m1");
    expect(msg.content).toEqual([]);
    const u3 = sliced.records.find((r) => r.json?.uuid === "u3");
    expect(u3?.raw).toContain("toolu_01"); // tool_use untouched
  });
});

describe("sliceSession closure failure tolerance", () => {
  it("reports closureComplete=false when a tool_use has no result anywhere, instead of throwing", async () => {
    const unclosed = writeUnclosedSession(path.join(tmp, "unclosed"));
    const sliced = await sliceSession(unclosed, {});
    expect(uuidsOf(sliced.records)).toEqual(["x1", "x2"]);
    expect(sliced.report.closureComplete).toBe(false);
    expect(sliced.report.toolUsePairs).toBe(0);
  });
});

describe("sliceSession (codex, linear)", () => {
  it("keeps session_meta and applies tail by user messages", async () => {
    const codex = writeCodexSession(path.join(tmp, "codex"));
    const full = await sliceSession(codex, {});
    expect(full.report.keptRecords).toBe(7);
    expect(full.report.toolUsePairs).toBe(1);
    expect(full.report.closureComplete).toBe(true);

    const tail1 = await sliceSession(codex, { tail: 1 });
    expect(tail1.records[0]?.json?.type).toBe("session_meta");
    expect(tail1.report.keptRecords).toBe(3); // meta + q2 + a2
    const texts = tail1.records.map((r) => r.raw).join("\n");
    expect(texts).toContain("codex q2");
    expect(texts).not.toContain("codex q1");
  });
});

describe("F13 · codex scaffold does not count as a tail turn", () => {
  const codex = writeCodexScaffoldSession(path.join(tmp, "codex-scaffold"));

  it("tail=N counts only real user turns, excluding scaffold response_items", async () => {
    // 3 real turns ("real turn one/two/three") + 2 scaffold user messages.
    // tail=2 must land on real turns two & three, NOT on a scaffold boundary.
    const tail2 = await sliceSession(codex, { tail: 2 });
    const texts = tail2.records.map((r) => r.raw).join("\n");
    expect(texts).toContain("real turn two");
    expect(texts).toContain("real turn three");
    expect(texts).not.toContain("real turn one");
    // scaffold before the window is dropped (would have been kept if counted as a turn)
    expect(texts).not.toContain("environment_context");
    expect(texts).not.toContain("AGENTS.md");
  });

  it("tail=3 == all three real turns, so no cut happens (scaffold count-blindness verified)", async () => {
    // 3 real turns and tail=3: because scaffolds are NOT counted, idx.length===3 (not >3),
    // so the window never opens and the whole session is kept. If scaffolds were miscounted
    // as turns the window would have cut into the real turns.
    const tail3 = await sliceSession(codex, { tail: 3 });
    const texts = tail3.records.map((r) => r.raw).join("\n");
    expect(texts).toContain("real turn one");
    expect(texts).toContain("real turn two");
    expect(texts).toContain("real turn three");
    expect(tail3.report.keptRecords).toBe(tail3.report.totalRecords);
  });

  it("call_id pairing pulls a cross-boundary function_call/output partner back in", async () => {
    // function_call cc1 sits with turn two; its output sits after turn three's boundary.
    // tail=1 window opens at "real turn three": the call (before the window) must be pulled
    // back so the pair is closed.
    const tail1 = await sliceSession(codex, { tail: 1 });
    expect(tail1.report.toolUsePairs).toBe(1);
    expect(tail1.report.closureComplete).toBe(true);
    const texts = tail1.records.map((r) => r.raw).join("\n");
    expect(texts).toContain("cc1");
  });
});

describe("F14 · filterSidecars keeps tool-results referenced only by a subagent", () => {
  it("retains toolu_88.txt (named only inside agent-bbb.jsonl) and drops the unreferenced one", async () => {
    const sess = writeSubagentRefSession(path.join(tmp, "subref"));
    const sliced = await sliceSession(sess, {});
    const trNames = sliced.sidecars.toolResults.map((f) => path.basename(f)).sort();
    expect(trNames).toEqual(["toolu_88.txt"]);
    expect(sliced.sidecars.subagents.map((f) => path.basename(f))).toEqual(["agent-bbb.jsonl"]);
    expect(sliced.report.toolResultFiles).toBe(1);
  });
});
