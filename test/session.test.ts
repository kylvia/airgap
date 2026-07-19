import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { RuleMatch, SessionInfo, Turn } from "../src/types.js";
import { peekTitle, pickSession, redactTurns, scanOneTurn, scanTurns, sessionTitle, turnTag } from "../src/session.js";

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

  it("returns English system tags when requested", () => {
    expect(turnTag("<task-notification>\n...", "en")).toBe("Task notification");
    expect(turnTag("/model claude", "en")).toBe("Command");
    expect(turnTag("[图片]", "en")).toBe("Image");
    expect(turnTag("<ide_selection>...", "en")).toBe("System");
  });
});

describe("sessionTitle", () => {
  it("localizes only the generated fallback title", () => {
    const info = sess("abc", "/work/demo", 1);
    expect(sessionTitle([], info, "en")).toBe("demo · session turns");
    expect(sessionTitle([], info, "zh-CN")).toBe("demo · 会话片段");
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

describe("peekTitle", () => {
  async function jsonlFile(lines: string[]): Promise<string> {
    const dir = await mkdtemp(path.join(os.tmpdir(), "airgap-title-"));
    const file = path.join(dir, "s.jsonl");
    await writeFile(file, lines.join("\n") + "\n", "utf8");
    return file;
  }

  it("取最新一条 ai-title（claude 会追加更新，晚出现的赢）", async () => {
    const f = await jsonlFile([
      '{"type":"user","message":{"content":"hi"}}',
      '{"type":"ai-title","aiTitle":"旧标题"}',
      '{"type":"assistant","message":{"content":[]}}',
      '{"type":"ai-title","aiTitle":"新标题"}',
    ]);
    expect(await peekTitle(f)).toBe("新标题");
  });

  it("没有 ai-title（codex / 未生成）→ null；空白标题不算", async () => {
    expect(await peekTitle(await jsonlFile(['{"type":"user"}']))).toBeNull();
    expect(await peekTitle(await jsonlFile(['{"type":"ai-title","aiTitle":"  "}']))).toBeNull();
  });

  it("文件不存在 → null，不抛", async () => {
    expect(await peekTitle("/nonexistent/airgap-title.jsonl")).toBeNull();
  });
});

describe("peekTitle: custom-title（用户 rename）优先", () => {
  async function jsonlFile(lines: string[]): Promise<string> {
    const dir = await mkdtemp(path.join(os.tmpdir(), "airgap-ctitle-"));
    const file = path.join(dir, "s.jsonl");
    await writeFile(file, lines.join("\n") + "\n", "utf8");
    return file;
  }

  it("rename 之后 Claude 仍会追加 ai-title——custom-title 必须永久赢，不是取最后一条", async () => {
    const f = await jsonlFile([
      '{"type":"ai-title","aiTitle":"AI 起的标题"}',
      '{"type":"custom-title","customTitle":"我改的标题"}',
      '{"type":"ai-title","aiTitle":"AI 又起了一个"}',
    ]);
    expect(await peekTitle(f)).toBe("我改的标题");
  });

  it("多次 rename 取最新一条 custom-title", async () => {
    const f = await jsonlFile([
      '{"type":"custom-title","customTitle":"第一次改"}',
      '{"type":"custom-title","customTitle":"第二次改"}',
    ]);
    expect(await peekTitle(f)).toBe("第二次改");
  });
});
