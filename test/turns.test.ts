import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { JsonlRecord } from "../src/types.js";
import { tryParse } from "../src/util/jsonl.js";
import { extractTurns, userTextFromRecord } from "../src/render/turns.js";

const here = path.dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): JsonlRecord[] {
  const text = readFileSync(path.join(here, "fixtures", name), "utf8");
  return text
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((line, i) => ({ raw: line, lineNo: i + 1, json: tryParse(line) }));
}

function record(json: Record<string, unknown>): JsonlRecord {
  return { raw: JSON.stringify(json), lineNo: 1, json };
}

describe("userTextFromRecord", () => {
  it("extracts a real Claude user message and rejects metadata/tool carriers", () => {
    expect(
      userTextFromRecord(
        { type: "user", message: { role: "user", content: "  修复这个报错  " } },
        "claude",
      ),
    ).toBe("修复这个报错");
    expect(
      userTextFromRecord(
        { type: "user", isMeta: true, message: { role: "user", content: "injected" } },
        "claude",
      ),
    ).toBeNull();
    expect(
      userTextFromRecord(
        {
          type: "user",
          message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] },
        },
        "claude",
      ),
    ).toBeNull();
  });

  it("extracts a real Codex user message and rejects injected scaffolding", () => {
    expect(
      userTextFromRecord(
        {
          type: "response_item",
          payload: { type: "message", role: "user", content: [{ type: "input_text", text: "修复登录页" }] },
        },
        "codex",
      ),
    ).toBe("修复登录页");
    expect(
      userTextFromRecord(
        {
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "<environment_context>noise</environment_context>" }],
          },
        },
        "codex",
      ),
    ).toBeNull();
  });
});

describe("extractTurns · inline user images", () => {
  it("keeps Claude embedded images on text and image-only turns", () => {
    const turns = extractTurns([
      record({
        type: "user",
        timestamp: "2026-07-23T01:00:00.000Z",
        message: {
          role: "user",
          content: [
            { type: "text", text: "看这张图" },
            { type: "image", source: { type: "base64", media_type: "image/png", data: "QUJDRA==" } },
          ],
        },
      }),
      record({
        type: "user",
        message: {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "QUJDRA==" } },
          ],
        },
      }),
    ], "claude");

    expect(turns).toHaveLength(2);
    expect(turns[0]!.userText).toBe("看这张图\n[图片]");
    expect(turns[0]!.userDisplayText).toBe("看这张图");
    expect(turns[0]!.userImages).toEqual([
      { mediaType: "image/png", dataUrl: "data:image/png;base64,QUJDRA==" },
    ]);
    expect(turns[1]!.userText).toBe("[图片]");
    expect(turns[1]!.userDisplayText).toBe("");
    expect(turns[1]!.userImages?.[0]?.mediaType).toBe("image/jpeg");
  });

  it("keeps Codex data images and opens image-only turns", () => {
    const turns = extractTurns([
      record({
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: "解释截图" },
            { type: "input_image", image_url: "data:image/webp;base64,QUJDRA==", detail: "auto" },
          ],
        },
      }),
      record({
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_image", image_url: "data:image/gif;base64,QUJDRA==" }],
        },
      }),
    ], "codex");

    expect(turns).toHaveLength(2);
    expect(turns[0]!.userText).toBe("解释截图\n[图片]");
    expect(turns[0]!.userDisplayText).toBe("解释截图");
    expect(turns[0]!.userImages?.[0]?.dataUrl).toBe("data:image/webp;base64,QUJDRA==");
    expect(turns[1]!.userText).toBe("[图片]");
    expect(turns[1]!.userDisplayText).toBe("");
    expect(turns[1]!.userImages?.[0]?.mediaType).toBe("image/gif");
  });

  it("keeps placeholders but rejects unsafe or unavailable image sources", () => {
    const claudeTurns = extractTurns([
      record({
        type: "user",
        message: {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/svg+xml", data: "PHN2Zz4=" } },
            { type: "image", file: { path: "/tmp/private.png" } },
          ],
        },
      }),
    ], "claude");
    const codexTurns = extractTurns([
      record({
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [
            { type: "input_image", image_url: "https://example.com/private.png" },
            { type: "input_image", image_url: "data:image/png;base64,not base64" },
          ],
        },
      }),
    ], "codex");

    expect(claudeTurns[0]!.userText).toBe("[图片]\n[图片]");
    expect(claudeTurns[0]!.userDisplayText).toBe("[图片]\n[图片]");
    expect(claudeTurns[0]!.userImages).toBeUndefined();
    expect(codexTurns[0]!.userText).toBe("[图片]\n[图片]");
    expect(codexTurns[0]!.userDisplayText).toBe("[图片]\n[图片]");
    expect(codexTurns[0]!.userImages).toBeUndefined();
  });

  it("distinguishes a literal image marker from a generated marker", () => {
    const turns = extractTurns([
      record({
        type: "user",
        message: {
          role: "user",
          content: [
            { type: "text", text: "[图片]\n这行是用户正文" },
            { type: "image", source: { type: "base64", media_type: "image/png", data: "QUJDRA==" } },
          ],
        },
      }),
    ], "claude");

    expect(turns[0]!.userText).toBe("[图片]\n这行是用户正文\n[图片]");
    expect(turns[0]!.userDisplayText).toBe("[图片]\n这行是用户正文");
  });
});

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
