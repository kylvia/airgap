import { describe, expect, it } from "vitest";
import type { RuleMatch, SessionInfo, Turn } from "../src/types.js";
import { pickSession, scanOneTurn, scanTurns, turnTag } from "../src/session.js";

describe("turnTag", () => {
  it("flags non-question user turns", () => {
    expect(turnTag("<task-notification>\n...")).toBe("任务通知");
    expect(turnTag("<task-id>abc</task-id>")).toBe("任务通知");
    expect(turnTag("/model claude")).toBe("命令");
    expect(turnTag("[图片]")).toBe("图片");
    expect(turnTag("<ide_selection>...")).toBe("系统");
    expect(turnTag("<local-command-stdout>x")).toBe("系统");
  });
  it("returns empty for a normal user question", () => {
    expect(turnTag("怎么导出某几轮？")).toBe("");
    expect(turnTag("  hello  ")).toBe("");
  });
});

function turn(index: number, userText: string, aiText = ""): Turn {
  return { index, userText, assistant: aiText ? [{ kind: "text", text: aiText }] : [], timestamp: null };
}

const scan = (s: string): RuleMatch[] =>
  s.includes("sk-ant-LEAK")
    ? [{ ruleId: "anthropic-key", severity: "critical", secret: "sk-ant-LEAK", preview: "sk-a…LEAK" }]
    : [];

describe("scanTurns / scanOneTurn", () => {
  it("finds secrets in user or assistant text and dedups", () => {
    const turns = [turn(1, "clean"), turn(2, "key sk-ant-LEAK here", "also sk-ant-LEAK")];
    expect(scanTurns(turns, scan)).toHaveLength(1); // deduped across user+assistant
    expect(scanOneTurn(turns[1]!, scan)).toHaveLength(1);
    expect(scanOneTurn(turns[0]!, scan)).toHaveLength(0);
  });
});

function sess(id: string, cwd: string | null, mtimeMs: number): SessionInfo {
  return {
    source: "claude",
    id,
    file: `/x/${id}.jsonl`,
    cwd,
    project: cwd ?? id,
    mtimeMs,
    sizeBytes: 0,
    sidecars: { subagents: [], toolResults: [] },
  };
}

describe("pickSession", () => {
  const list = [sess("aaa1", "/other", 300), sess("bbb2", process.cwd(), 100), sess("ccc3", "/other", 200)];
  it("prefix wins", () => {
    expect(pickSession(list, { session: "bbb" })?.id).toBe("bbb2");
  });
  it("cwd match beats most-recent when no prefix", () => {
    expect(pickSession(list, {})?.id).toBe("bbb2");
  });
  it("falls back to most recent when no cwd match", () => {
    const noCwd = [sess("aaa1", "/other", 300), sess("ccc3", "/other", 200)];
    expect(pickSession(noCwd, {})?.id).toBe("aaa1");
  });
});
