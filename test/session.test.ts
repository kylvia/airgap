import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { RuleMatch, SessionInfo, Turn } from "../src/types.js";
import { peekListTitle, pickSession, redactTurns, scanOneTurn, scanTurns, sessionTitle, turnTag } from "../src/session.js";

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

describe("peekListTitle", () => {
  async function jsonlFile(lines: string[]): Promise<string> {
    const dir = await mkdtemp(path.join(os.tmpdir(), "airgap-title-"));
    const file = path.join(dir, "s.jsonl");
    await writeFile(file, lines.join("\n") + "\n", "utf8");
    return file;
  }

  it("keeps native-title precedence over the first user message", async () => {
    const f = await jsonlFile([
      '{"type":"user","message":{"content":"第一条真实消息"}}',
      '{"type":"ai-title","aiTitle":"AI 标题"}',
      '{"type":"custom-title","customTitle":"旧用户标题"}',
      '{"type":"ai-title","aiTitle":"更新的 AI 标题"}',
      '{"type":"custom-title","customTitle":"用户标题"}',
      '{"type":"ai-title","aiTitle":"更晚的 AI 标题"}',
    ]);
    expect(await peekListTitle(f, "claude")).toBe("用户标题");
  });

  it("uses the latest AI title when no custom title exists", async () => {
    const f = await jsonlFile([
      '{"type":"user","message":{"content":"第一条真实消息"}}',
      '{"type":"ai-title","aiTitle":"旧标题"}',
      '{"type":"ai-title","aiTitle":"新标题"}',
    ]);
    expect(await peekListTitle(f, "claude")).toBe("新标题");
  });

  it("uses the first substantive Claude prompt and skips non-title turns", async () => {
    const f = await jsonlFile([
      '{"type":"user","isMeta":true,"message":{"content":"meta"}}',
      '{"type":"user","isSidechain":true,"message":{"content":"sidechain"}}',
      '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"ok"}]}}',
      '{"type":"user","message":{"content":"/model opus"}}',
      '{"type":"user","message":{"content":"<task-notification>done</task-notification>"}}',
      '{"type":"user","message":{"content":"<ide_selection>noise</ide_selection>"}}',
      '{"type":"user","message":{"content":[{"type":"image"}]}}',
      '{"type":"user","message":{"content":[{"type":"document"}]}}',
      '{"type":"user","message":{"content":"  修复   登录页\\n的报错  "}}',
      '{"type":"user","message":{"content":"后续消息"}}',
    ]);
    expect(await peekListTitle(f, "claude")).toBe("修复 登录页 的报错");
  });

  it("uses the first substantive Codex prompt after scaffolding", async () => {
    const f = await jsonlFile([
      '{"type":"response_item","payload":{"type":"message","role":"developer","content":[{"type":"input_text","text":"system"}]}}',
      '{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"<user_instructions>noise</user_instructions>"}]}}',
      '{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"查一下 8080 端口"}]}}',
    ]);
    expect(await peekListTitle(f, "codex")).toBe("查一下 8080 端口");
  });

  it("bounds generated titles to 60 visible characters", async () => {
    const prompt = "x".repeat(80);
    const f = await jsonlFile([JSON.stringify({ type: "user", message: { content: prompt } })]);
    const title = await peekListTitle(f, "claude");
    expect(title).toBe(`${"x".repeat(59)}…`);
    expect(title).toHaveLength(60);
  });

  it("fails soft for missing, malformed, and candidate-free files", async () => {
    expect(await peekListTitle("/nonexistent/airgap-title.jsonl", "claude")).toBeNull();
    expect(
      await peekListTitle(await jsonlFile(["not json", '{"type":"ai-title","aiTitle":"  "}', '{"type":"user"}']), "claude"),
    ).toBeNull();
  });
});
