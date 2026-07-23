import { describe, expect, it } from "vitest";
import type { Turn } from "../src/types.js";
import { shareTurnsForDisplay } from "../src/server/share-server.js";

const ideInjectedRequest = `# Context from my IDE setup:

## Active file: CLAUDE.md

## Open tabs:
- CLAUDE.md: CLAUDE.md

## My request for Codex:
继续做`;

function turn(userText = ideInjectedRequest): Turn {
  return { index: 1, userText, assistant: [], timestamp: null };
}

describe("share IDE 上下文展示", () => {
  it.each(["none", "summary"] as const)("%s 档剥离 IDE 上下文，只保留真实请求", (tools) => {
    const source = turn();

    const shown = shareTurnsForDisplay([source], tools);

    expect(shown[0]!.userText).toBe("继续做");
    expect(source.userText).toBe(ideInjectedRequest);
  });

  it("full 档保留完整的 IDE 上下文", () => {
    expect(shareTurnsForDisplay([turn()], "full")[0]!.userText).toBe(ideInjectedRequest);
  });

  it("不是 IDE 注入格式的用户消息原样保留", () => {
    expect(shareTurnsForDisplay([turn("普通问题")], "summary")[0]!.userText).toBe("普通问题");
  });

  it("同时裁剪富文本展示字段里的 IDE 注入上下文", () => {
    const source: Turn = { ...turn(), userDisplayText: ideInjectedRequest };

    const shown = shareTurnsForDisplay([source], "summary");

    expect(shown[0]!.userDisplayText).toBe("继续做");
    expect(source.userDisplayText).toBe(ideInjectedRequest);
  });
});
