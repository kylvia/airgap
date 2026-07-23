import { describe, expect, it } from "vitest";
import { showImageRiskAction } from "../src/commands/show.js";
import type { Turn } from "../src/types.js";

const INLINE_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z7VwAAAAASUVORK5CYII=";
const INLINE_PNG_WITH_PARAMETER = INLINE_PNG.replace(
  "data:image/png;",
  "data:image/png;charset=utf-8;",
);
const INLINE_PNG_WITH_ENTITY = INLINE_PNG.replace("data:", "data&#x3A;");

function turnWithImage(): Turn {
  return {
    index: 1,
    userText: "[图片]",
    userImages: [{ mediaType: "image/png", dataUrl: "data:image/png;base64,QUJDRA==" }],
    assistant: [],
    timestamp: null,
  };
}

function turnWithMarkdownImage(dataUrl = INLINE_PNG): Turn {
  return {
    index: 1,
    userText: "hello",
    assistant: [{ kind: "text", text: `![secret screenshot](${dataUrl})` }],
    timestamp: null,
  };
}

describe("showImageRiskAction", () => {
  it("blocks a non-interactive HTML image export until risk is explicitly accepted", () => {
    expect(showImageRiskAction([turnWithImage()], "html", false, false)).toBe("block");
  });

  it("asks for confirmation before an interactive PNG image export", () => {
    expect(showImageRiskAction([turnWithImage()], "png", false, true)).toBe("confirm");
  });

  it("allows HTML/PNG image export after --yes explicitly accepts the risk", () => {
    expect(showImageRiskAction([turnWithImage()], "html", true, false)).toBe("allow");
    expect(showImageRiskAction([turnWithImage()], "png", true, false)).toBe("allow");
  });

  it("allows Markdown because it omits image bytes", () => {
    expect(showImageRiskAction([turnWithImage()], "md", false, false)).toBe("allow");
  });

  it("does not affect image-free HTML export", () => {
    const turn: Turn = { index: 1, userText: "hello", assistant: [], timestamp: null };
    expect(showImageRiskAction([turn], "html", false, false)).toBe("allow");
  });

  it("blocks image bytes embedded in assistant Markdown", () => {
    expect(showImageRiskAction([turnWithMarkdownImage()], "html", false, false)).toBe("block");
    expect(showImageRiskAction([turnWithMarkdownImage()], "png", false, true)).toBe("confirm");
  });

  it.each([
    ["MIME parameter", INLINE_PNG_WITH_PARAMETER],
    ["HTML entity", INLINE_PNG_WITH_ENTITY],
  ])("blocks image bytes after Markdown normalizes a %s data URI", (_label, dataUrl) => {
    expect(showImageRiskAction([turnWithMarkdownImage(dataUrl)], "html", false, false)).toBe("block");
  });
});
