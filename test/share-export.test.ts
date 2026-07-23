import { describe, expect, it, vi } from "vitest";
import type { RuleMatch, Turn } from "../src/types.js";
import {
  CliChromeMissingError,
  ShareExportAdapterError,
  createCliExportAdapter,
  createShareExportCoordinator,
  type ExportRequest,
  type ExportSelection,
  type SaveFileRequest,
  type ShareExportAdapter,
} from "../src/server/share-export.js";

const cleanTurn: Turn = {
  index: 1,
  userText: "hello",
  timestamp: "2026-07-20T10:00:00.000Z",
  assistant: [{ kind: "text", text: "world" }],
};

const inlinePng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z7VwAAAAASUVORK5CYII=";
const inlinePngWithParameter = inlinePng.replace(
  "data:image/png;",
  "data:image/png;charset=utf-8;",
);
const inlinePngWithEntity = inlinePng.replace("data:", "data&#x3A;");

const selection: ExportSelection = {
  turns: [cleanTurn],
  title: "Conversation",
  date: "2026-07-20",
};

const baseRequest: ExportRequest = {
  sessionId: "session-1",
  turns: [1],
  action: "clipboard",
  format: "png",
  redact: true,
  acceptRisk: false,
  tools: "summary",
  locale: "en",
};

function fakeAdapter(overrides: Partial<ShareExportAdapter> = {}) {
  const saved: SaveFileRequest[] = [];
  const adapter: ShareExportAdapter = {
    renderPng: vi.fn(async () => Buffer.from("png")),
    copyImage: vi.fn(async () => {}),
    copyText: vi.fn(async () => {}),
    saveFile: vi.fn(async (request) => {
      saved.push(request);
      return `/chosen/${request.suggestedName}`;
    }),
    ...overrides,
  };
  return { adapter, saved };
}

function coordinator(adapter: ShareExportAdapter, resolved: ExportSelection | null = selection) {
  return createShareExportCoordinator({
    adapter,
    resolveSelection: vi.fn(async () => resolved),
  });
}

describe("Share export coordinator", () => {
  it("renders and copies a PNG through the adapter", async () => {
    const { adapter } = fakeAdapter();
    const result = await coordinator(adapter).export(baseRequest);

    expect(result).toMatchObject({ outcome: "success", code: "IMAGE_COPIED" });
    expect(adapter.renderPng).toHaveBeenCalledOnce();
    expect(adapter.copyImage).toHaveBeenCalledWith(Buffer.from("png"));
  });

  it("renders and saves a PNG with the stable suggested name", async () => {
    const { adapter, saved } = fakeAdapter();
    const result = await coordinator(adapter).export({ ...baseRequest, action: "save" });

    expect(result).toMatchObject({ outcome: "success", code: "EXPORT_SAVED" });
    expect(saved).toHaveLength(1);
    expect(saved[0]!.suggestedName).toMatch(/^airgap-share-\d{8}-\d{6}\.png$/);
    expect(saved[0]!.data).toEqual(Buffer.from("png"));
    expect(saved[0]!.dialogTitle).toBe("Save Airgap export");
    expect(saved[0]!.buttonLabel).toBe("Save");
    expect(result.message).toContain(`/chosen/${saved[0]!.suggestedName}`);
  });

  it.each(["html", "md"] as const)("saves %s without capturing a PNG", async (format) => {
    const { adapter, saved } = fakeAdapter();
    const result = await coordinator(adapter).export({ ...baseRequest, action: "save", format });

    expect(result).toMatchObject({ outcome: "success", code: "EXPORT_SAVED" });
    expect(saved[0]!.suggestedName).toMatch(new RegExp(`\\.${format}$`));
    expect(typeof saved[0]!.data).toBe("string");
    expect(adapter.renderPng).not.toHaveBeenCalled();
  });

  it("returns download bytes without a second encoding step", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const { adapter } = fakeAdapter({ renderPng: vi.fn(async () => png) });
    const result = await coordinator(adapter).export({ ...baseRequest, action: "download" });

    expect(result).toMatchObject({ outcome: "success", code: "EXPORT_DOWNLOAD", bytes: png });
    expect(result.filename).toMatch(/^airgap-share-\d{8}-\d{6}\.png$/);
  });

  it("renders Markdown and copies text without capturing a PNG", async () => {
    const { adapter } = fakeAdapter();
    const result = await coordinator(adapter).export({ ...baseRequest, format: "md" });

    expect(result).toMatchObject({ outcome: "success", code: "TEXT_COPIED" });
    expect(adapter.copyText).toHaveBeenCalledWith(expect.stringContaining("hello"));
    expect(adapter.renderPng).not.toHaveBeenCalled();
  });

  it("reports save cancellation as neither success nor failure", async () => {
    const { adapter } = fakeAdapter({ saveFile: vi.fn(async () => null) });
    const result = await coordinator(adapter).export({ ...baseRequest, action: "save" });

    expect(result).toMatchObject({ outcome: "cancelled", code: "EXPORT_CANCELLED" });
  });

  it.each([
    ["capture", { renderPng: vi.fn(async () => { throw new Error("capture"); }) }, "EXPORT_CAPTURE_FAILED"],
    ["clipboard", { copyImage: vi.fn(async () => { throw new Error("clipboard"); }) }, "EXPORT_CLIPBOARD_FAILED"],
    ["save", { saveFile: vi.fn(async () => { throw new Error("save"); }) }, "EXPORT_SAVE_FAILED"],
  ] as const)("classifies %s failures", async (_name, overrides, code) => {
    const { adapter } = fakeAdapter(overrides);
    const request = code === "EXPORT_SAVE_FAILED" ? { ...baseRequest, action: "save" as const } : baseRequest;
    await expect(coordinator(adapter).export(request)).resolves.toMatchObject({ outcome: "error", code });
  });

  it("maps an oversized image to actionable localized feedback", async () => {
    const { adapter } = fakeAdapter({
      renderPng: vi.fn(async () => {
        throw new ShareExportAdapterError("IMAGE_TOO_LARGE", "Image export is too large");
      }),
    });

    await expect(coordinator(adapter).export(baseRequest)).resolves.toMatchObject({
      outcome: "error",
      code: "EXPORT_IMAGE_TOO_LARGE",
      message: expect.stringMatching(/fewer turns|copy text/i),
    });
  });

  it("never forwards arbitrary adapter error text to the reporter", async () => {
    const secret = "sk-ant-api03-DO-NOT-LOG-THIS-SECRET";
    const onError = vi.fn();
    const { adapter } = fakeAdapter({
      renderPng: vi.fn(async () => { throw new Error(secret); }),
    });
    const exportCoordinator = createShareExportCoordinator({
      adapter,
      resolveSelection: vi.fn(async () => selection),
      onError,
    });

    await exportCoordinator.export(baseRequest);

    expect(onError).toHaveBeenCalledOnce();
    expect(String(onError.mock.calls[0]![0])).not.toContain(secret);
  });

  it("classifies synchronous renderer failures separately", async () => {
    const { adapter } = fakeAdapter();
    const exportCoordinator = createShareExportCoordinator({
      adapter,
      resolveSelection: vi.fn(async () => selection),
      renderHtml: vi.fn(() => { throw new Error("render"); }),
    });

    await expect(exportCoordinator.export({ ...baseRequest, action: "download" }))
      .resolves.toMatchObject({ outcome: "error", code: "EXPORT_RENDER_FAILED" });
    expect(adapter.renderPng).not.toHaveBeenCalled();
  });

  it("redacts before any rendered content reaches the adapter", async () => {
    const secret = "sk-ant-LEAK";
    const risky: ExportSelection = {
      ...selection,
      turns: [{ ...cleanTurn, userText: secret }],
    };
    const finding: RuleMatch = { ruleId: "anthropic-key", severity: "critical", secret, preview: "sk-a…LEAK" };
    const { adapter } = fakeAdapter();
    const exportCoordinator = createShareExportCoordinator({
      adapter,
      resolveSelection: vi.fn(async () => risky),
      scan: (value) => value.includes(secret) ? [finding] : [],
    });

    await exportCoordinator.export(baseRequest);
    const html = vi.mocked(adapter.renderPng).mock.calls[0]![0];
    expect(html).not.toContain(secret);
    expect(html).toContain("REDACTED");
  });

  it("blocks image exports until the user confirms images were checked manually", async () => {
    const withImage: ExportSelection = {
      ...selection,
      turns: [{
        ...cleanTurn,
        userText: "[图片]",
        userImages: [{ mediaType: "image/png", dataUrl: "data:image/png;base64,QUJDRA==" }],
      }],
    };
    const { adapter } = fakeAdapter();

    const result = await coordinator(adapter, withImage).export(baseRequest);

    expect(result).toMatchObject({
      outcome: "error",
      code: "EXPORT_IMAGE_RISK",
      blocked: true,
      message: expect.stringMatching(/cannot (?:scan|check).*image/i),
    });
    expect(adapter.renderPng).not.toHaveBeenCalled();
    expect(adapter.copyImage).not.toHaveBeenCalled();
  });

  it("continues an image export after explicit risk confirmation", async () => {
    const withImage: ExportSelection = {
      ...selection,
      turns: [{
        ...cleanTurn,
        userText: "[图片]",
        userImages: [{ mediaType: "image/png", dataUrl: "data:image/png;base64,QUJDRA==" }],
      }],
    };
    const { adapter } = fakeAdapter();

    const result = await coordinator(adapter, withImage).export({ ...baseRequest, acceptRisk: true });

    expect(result).toMatchObject({ outcome: "success", code: "IMAGE_COPIED" });
    expect(adapter.renderPng).toHaveBeenCalledOnce();
  });

  it("blocks image bytes embedded in assistant Markdown", async () => {
    const withMarkdownImage: ExportSelection = {
      ...selection,
      turns: [{
        ...cleanTurn,
        assistant: [{ kind: "text", text: `![secret screenshot](${inlinePng})` }],
      }],
    };
    const { adapter } = fakeAdapter();

    const result = await coordinator(adapter, withMarkdownImage).export(baseRequest);

    expect(result).toMatchObject({
      outcome: "error",
      code: "EXPORT_IMAGE_RISK",
      blocked: true,
    });
    expect(adapter.renderPng).not.toHaveBeenCalled();
  });

  it.each([
    ["MIME parameter", inlinePngWithParameter],
    ["HTML entity", inlinePngWithEntity],
  ])("blocks Share image export after Markdown normalizes a %s data URI", async (_label, dataUrl) => {
    const withMarkdownImage: ExportSelection = {
      ...selection,
      turns: [{
        ...cleanTurn,
        assistant: [{ kind: "text", text: `![secret screenshot](${dataUrl})` }],
      }],
    };
    const { adapter } = fakeAdapter();

    const result = await coordinator(adapter, withMarkdownImage).export(baseRequest);

    expect(result).toMatchObject({
      outcome: "error",
      code: "EXPORT_IMAGE_RISK",
      blocked: true,
    });
    expect(adapter.renderPng).not.toHaveBeenCalled();
  });

  it("blocks image download even if a caller mismatches the declared format", async () => {
    const withImage: ExportSelection = {
      ...selection,
      turns: [{
        ...cleanTurn,
        userText: "[图片]",
        userImages: [{ mediaType: "image/png", dataUrl: "data:image/png;base64,QUJDRA==" }],
      }],
    };
    const { adapter } = fakeAdapter();

    const result = await coordinator(adapter, withImage).export({
      ...baseRequest,
      action: "download",
      format: "md",
    });

    expect(result).toMatchObject({ outcome: "error", code: "EXPORT_IMAGE_RISK", blocked: true });
    expect(adapter.renderPng).not.toHaveBeenCalled();
  });

  it("copies Markdown without an image-risk prompt because image bytes are omitted", async () => {
    const withImage: ExportSelection = {
      ...selection,
      turns: [{
        ...cleanTurn,
        userText: "查看截图\n[图片]",
        userImages: [{ mediaType: "image/png", dataUrl: "data:image/png;base64,QUJDRA==" }],
      }],
    };
    const { adapter } = fakeAdapter();

    const result = await coordinator(adapter, withImage).export({ ...baseRequest, format: "md" });

    expect(result).toMatchObject({ outcome: "success", code: "TEXT_COPIED" });
    expect(adapter.copyText).toHaveBeenCalledWith(expect.stringContaining("[图片]"));
  });

  it("strips assistant Markdown image bytes before copying Markdown", async () => {
    const withMarkdownImage: ExportSelection = {
      ...selection,
      turns: [{
        ...cleanTurn,
        assistant: [{ kind: "text", text: `![secret screenshot](${inlinePng})` }],
      }],
    };
    const { adapter } = fakeAdapter();

    const result = await coordinator(adapter, withMarkdownImage).export({ ...baseRequest, format: "md" });

    expect(result).toMatchObject({ outcome: "success", code: "TEXT_COPIED" });
    const copied = vi.mocked(adapter.copyText!).mock.calls[0]![0];
    expect(copied).toContain("[图片]");
    expect(copied).not.toContain("data:image/");
    expect(copied).not.toContain("iVBORw0KGgo");
  });

  it("redacts before rendered text reaches the clipboard adapter", async () => {
    const secret = "sk-ant-LEAK";
    const finding: RuleMatch = { ruleId: "anthropic-key", severity: "critical", secret, preview: "sk-a…LEAK" };
    const { adapter } = fakeAdapter();
    const exportCoordinator = createShareExportCoordinator({
      adapter,
      resolveSelection: vi.fn(async () => ({ ...selection, turns: [{ ...cleanTurn, userText: secret }] })),
      scan: (value) => value.includes(secret) ? [finding] : [],
    });

    await exportCoordinator.export({ ...baseRequest, format: "md" });
    const text = vi.mocked(adapter.copyText!).mock.calls[0]![0];
    expect(text).not.toContain(secret);
    expect(text).toContain("REDACTED");
  });

  it("redacts a secret in the conversation title before rendering", async () => {
    const secret = "sk-ant-TITLE-LEAK";
    const finding: RuleMatch = { ruleId: "anthropic-key", severity: "critical", secret, preview: "sk-a…LEAK" };
    const { adapter } = fakeAdapter();
    const exportCoordinator = createShareExportCoordinator({
      adapter,
      resolveSelection: vi.fn(async () => ({ ...selection, title: secret })),
      scan: (value) => value.includes(secret) ? [finding] : [],
    });

    await exportCoordinator.export(baseRequest);
    const html = vi.mocked(adapter.renderPng).mock.calls[0]![0];
    expect(html).not.toContain(secret);
    expect(html).toContain("REDACTED");
  });

  it("blocks an unredacted secret found only in the conversation title", async () => {
    const secret = "sk-ant-TITLE-LEAK";
    const finding: RuleMatch = { ruleId: "anthropic-key", severity: "critical", secret, preview: "sk-a…LEAK" };
    const { adapter } = fakeAdapter();
    const exportCoordinator = createShareExportCoordinator({
      adapter,
      resolveSelection: vi.fn(async () => ({ ...selection, title: secret })),
      scan: (value) => value.includes(secret) ? [finding] : [],
    });

    const result = await exportCoordinator.export({ ...baseRequest, redact: false });
    expect(result).toMatchObject({ outcome: "error", code: "EXPORT_SECRET_RISK", blocked: true });
    expect(adapter.renderPng).not.toHaveBeenCalled();
  });

  it("blocks an unredacted secret before invoking the adapter", async () => {
    const secret = "sk-ant-LEAK";
    const finding: RuleMatch = { ruleId: "anthropic-key", severity: "critical", secret, preview: "sk-a…LEAK" };
    const { adapter } = fakeAdapter();
    const exportCoordinator = createShareExportCoordinator({
      adapter,
      resolveSelection: vi.fn(async () => ({ ...selection, turns: [{ ...cleanTurn, userText: secret }] })),
      scan: (value) => value.includes(secret) ? [finding] : [],
    });

    const result = await exportCoordinator.export({ ...baseRequest, redact: false });
    expect(result).toMatchObject({ outcome: "error", code: "EXPORT_SECRET_RISK", blocked: true });
    expect(adapter.renderPng).not.toHaveBeenCalled();
    expect(adapter.copyImage).not.toHaveBeenCalled();
  });

  it("checks optional clipboard capabilities before rendering", async () => {
    const { adapter } = fakeAdapter();
    delete adapter.copyImage;

    const result = await coordinator(adapter).export(baseRequest);
    expect(result).toMatchObject({ outcome: "error", code: "CLIPBOARD_UNSUPPORTED" });
    expect(adapter.renderPng).not.toHaveBeenCalled();
  });

  it("tracks the export before session resolution and settles when idle", async () => {
    let release!: (value: ExportSelection) => void;
    const pendingSelection = new Promise<ExportSelection>((resolve) => { release = resolve; });
    const { adapter } = fakeAdapter();
    const exportCoordinator = createShareExportCoordinator({
      adapter,
      resolveSelection: vi.fn(() => pendingSelection),
    });

    const exporting = exportCoordinator.export(baseRequest);
    let idle = false;
    const waiting = exportCoordinator.whenIdle().then(() => { idle = true; });
    await Promise.resolve();
    expect(idle).toBe(false);

    release(selection);
    await exporting;
    await waiting;
    expect(idle).toBe(true);
  });

  it("settles idle waiters after failures too", async () => {
    const { adapter } = fakeAdapter({ renderPng: vi.fn(async () => { throw new Error("capture"); }) });
    const exportCoordinator = coordinator(adapter);
    await exportCoordinator.export(baseRequest);
    await expect(exportCoordinator.whenIdle()).resolves.toBeUndefined();
  });

  it("rejects path-like suggested names inside the CLI adapter", async () => {
    const adapter = createCliExportAdapter();
    await expect(adapter.saveFile({
      suggestedName: "../../../.zshrc",
      data: "bad",
      dialogTitle: "Save Airgap export",
      buttonLabel: "Save",
    }))
      .rejects.toThrow(/filename/i);
  });

  it("reports the actionable localized Chrome-missing diagnostic", async () => {
    const onError = vi.fn();
    const { adapter } = fakeAdapter({
      renderPng: vi.fn(async () => { throw new CliChromeMissingError(); }),
    });
    const exportCoordinator = createShareExportCoordinator({
      adapter,
      resolveSelection: vi.fn(async () => selection),
      onError,
    });

    await exportCoordinator.export({ ...baseRequest, locale: "zh-CN", action: "download" });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringMatching(/CHROME_PATH.*HTML\/Markdown/),
    }));
  });
});
