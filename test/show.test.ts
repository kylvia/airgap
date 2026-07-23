import { describe, expect, it } from "vitest";
import { showImageRiskAction } from "../src/commands/show.js";
import type { Turn } from "../src/types.js";

function turnWithImage(): Turn {
  return {
    index: 1,
    userText: "[图片]",
    userImages: [{ mediaType: "image/png", dataUrl: "data:image/png;base64,QUJDRA==" }],
    assistant: [],
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
});
