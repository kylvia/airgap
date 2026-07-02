import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { JsonlRecord } from "../src/types.js";
import { tryParse } from "../src/util/jsonl.js";
import { extractTurns } from "../src/render/turns.js";

const here = path.dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): JsonlRecord[] {
  const text = readFileSync(path.join(here, "fixtures", name), "utf8");
  return text
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((line, i) => ({ raw: line, lineNo: i + 1, json: tryParse(line) }));
}

describe("extractTurns · claude", () => {
  const turns = extractTurns(loadFixture("claude-mini.jsonl"), "claude");

  it("只把真正的用户发言开成 turn（isMeta / tool_result 承载 / sidechain / stdout 都不算）", () => {
    expect(turns.length).toBe(3);
    expect(turns.map((t) => t.index)).toEqual([1, 2, 3]);
  });

  it("第 1 轮：user 字符串 content + 跨多条 assistant 记录归并", () => {
    const t = turns[0]!;
    expect(t.userText).toBe("帮我看看这个报错");
    expect(t.timestamp).toBe("2026-07-01T10:00:01.000Z");
    // thinking → text → tool_use（同 message.id 拆多条）→ tool_result 承载记录之后的 text 仍归本轮
    expect(t.assistant.map((b) => b.kind)).toEqual(["thinking", "text", "tool", "text"]);
    expect(t.assistant[0]!.text).toBe("用户想修报错，先复现。");
    expect(t.assistant[3]!.text).toContain("**结论**");
  });

  it("tool_use 折叠为一行：工具名 + ≤80 字符摘要", () => {
    const tool = turns[0]!.assistant[2]!;
    expect(tool.kind).toBe("tool");
    expect(tool.text.startsWith("Bash: ")).toBe(true);
    const brief = tool.text.slice("Bash: ".length);
    expect(brief.length).toBeLessThanOrEqual(80);
    expect(brief.endsWith("…")).toBe(true);
  });

  it("第 2 轮：数组 content 里 text + image 块", () => {
    const t = turns[1]!;
    expect(t.userText).toContain("那部署吧");
    expect(t.userText).toContain("[图片]");
    expect(t.assistant.map((b) => b.kind)).toEqual(["text"]);
  });

  it("第 3 轮：斜杠命令 XML 压缩成 /name args，local-command-stdout 不开新 turn", () => {
    const t = turns[2]!;
    expect(t.userText).toBe("/model opus");
    expect(t.assistant).toEqual([]);
  });

  it("非 JSON 行（json: null）不炸也不产生 turn", () => {
    // fixture 里有一行 "not a json line"，上面 length===3 已隐含覆盖；这里显式确认没有空 userText 的 turn
    expect(turns.every((t) => t.userText.trim().length > 0)).toBe(true);
  });
});

describe("extractTurns · codex", () => {
  const turns = extractTurns(loadFixture("codex-mini.jsonl"), "codex");

  it("message role=user 开新 turn，developer/脚手架/事件流不算", () => {
    expect(turns.length).toBe(2);
    expect(turns[0]!.userText).toBe("查一下 8080 端口被谁占了");
    expect(turns[0]!.timestamp).toBe("2026-07-02T12:00:02.000Z");
    expect(turns[1]!.userText).toBe("把它杀掉");
  });

  it("第 1 轮：reasoning → function_call → assistant message", () => {
    const t = turns[0]!;
    expect(t.assistant.map((b) => b.kind)).toEqual(["thinking", "tool", "text"]);
    expect(t.assistant[0]!.text).toBe("需要用 lsof 查端口");
    expect(t.assistant[1]!.text).toBe('exec_command: {"cmd":"lsof -i :8080"}');
    expect(t.assistant[2]!.text).toBe("8080 被 node（pid 1234）占用。");
  });

  it("第 2 轮：空 summary 的 reasoning 不产生块，custom_tool_call 算工具行", () => {
    const t = turns[1]!;
    expect(t.assistant.map((b) => b.kind)).toEqual(["tool", "text"]);
    expect(t.assistant[0]!.text).toBe("apply_patch: *** Begin Patch ***");
    expect(t.assistant[1]!.text).toBe("已杀掉进程。");
  });
});
