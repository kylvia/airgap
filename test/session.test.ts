import { describe, expect, it } from "vitest";
import type { RuleMatch, SessionInfo, Turn } from "../src/types.js";
import { pickSession, redactTurns, scanOneTurn, scanTurns, turnTag } from "../src/session.js";

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

  it("scans a secret hiding only in a tool result (the `cat .env` leak)", () => {
    // summary + user text are clean; the secret lives only in toolResult, which IS rendered.
    const t: Turn = {
      index: 1,
      userText: "cat 一下 .env 看看",
      assistant: [
        { kind: "tool", text: "Bash: cat .env", toolName: "Bash", toolInput: "cat .env", toolResult: "AWS_SECRET=sk-ant-LEAK" },
      ],
      timestamp: null,
    };
    expect(scanTurns([t], scan)).toHaveLength(1);
  });

  it("scans a secret in a tool input (e.g. a Write body)", () => {
    const t: Turn = {
      index: 1,
      userText: "写个配置文件",
      assistant: [
        { kind: "tool", text: "Write: config.ts", toolName: "Write", toolInput: "const KEY = 'sk-ant-LEAK'", toolResult: "ok" },
      ],
      timestamp: null,
    };
    expect(scanTurns([t], scan)).toHaveLength(1);
  });
});

describe("redactTurns", () => {
  it("replaces a secret in a tool result, reports the count, and leaves the input turns untouched", () => {
    const t: Turn = {
      index: 1,
      userText: "cat .env",
      timestamp: null,
      assistant: [
        { kind: "tool", text: "Bash: cat .env", toolName: "Bash", toolInput: "cat .env", toolResult: "K=sk-ant-LEAK" },
      ],
    };
    const { turns, count } = redactTurns([t], scan);
    expect(count).toBe(1);
    const block = turns[0]!.assistant[0]!;
    expect(block.toolResult).not.toContain("sk-ant-LEAK");
    expect(block.toolResult).toMatch(/REDACTED/);
    // input untouched (fresh copy), and the redacted output scans clean
    expect(t.assistant[0]!.toolResult).toBe("K=sk-ant-LEAK");
    expect(scanTurns(turns, scan)).toHaveLength(0);
  });

  it("uses one consistent placeholder for the same secret across fields", () => {
    const t: Turn = {
      index: 1,
      userText: "key sk-ant-LEAK",
      timestamp: null,
      assistant: [{ kind: "tool", text: "Bash: run", toolName: "Bash", toolInput: "echo sk-ant-LEAK", toolResult: "sk-ant-LEAK" }],
    };
    const { turns, count } = redactTurns([t], scan);
    expect(count).toBe(1); // one distinct secret
    const out = turns[0]!;
    const placeholder = out.userText.replace("key ", "");
    expect(out.assistant[0]!.toolInput).toBe(`echo ${placeholder}`);
    expect(out.assistant[0]!.toolResult).toBe(placeholder);
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
