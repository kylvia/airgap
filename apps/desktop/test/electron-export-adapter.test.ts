import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import {
  DesktopCaptureError,
  DesktopCaptureSizeError,
  createElectronExportAdapter,
  type CaptureWindowLike,
  type CaptureWindowOptionsLike,
  type ElectronExportDependencies,
} from "../src/electron-export-adapter.js";

class FakeEvent {
  prevented = false;
  preventDefault(): void { this.prevented = true; }
}

class FakeCaptureWindow implements CaptureWindowLike {
  readonly listeners = new Map<string, (...args: any[]) => void>();
  openHandler: (() => { action: "deny" }) | undefined;
  requestPermission: ((contents: unknown, permission: string, callback: (allowed: boolean) => void) => void) | undefined;
  checkPermission: (() => boolean) | undefined;
  beforeRequest: ((details: { url: string }, callback: (response: { cancel: boolean }) => void) => void) | undefined;
  loadedUrl = "";
  destroyed = false;
  contentSize: [number, number] | undefined;
  dimensions: unknown = { width: 900, height: 1680 };
  capturedRect: unknown;
  capturedOptions: unknown;
  png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  hangLoad = false;
  failLoadWithUrl = false;

  readonly webContents = {
    on: (event: string, listener: (...args: any[]) => void) => {
      this.listeners.set(event, listener);
    },
    setWindowOpenHandler: (handler: () => { action: "deny" }) => {
      this.openHandler = handler;
    },
    executeJavaScript: async () => this.dimensions,
    capturePage: async (rect: unknown, options: unknown) => {
      this.capturedRect = rect;
      this.capturedOptions = options;
      return { toPNG: () => this.png, isEmpty: () => false };
    },
    session: {
      setPermissionRequestHandler: (handler: (contents: unknown, permission: string, callback: (allowed: boolean) => void) => void) => {
        this.requestPermission = handler;
      },
      setPermissionCheckHandler: (handler: () => boolean) => {
        this.checkPermission = handler;
      },
      on: (event: string, listener: (...args: any[]) => void) => {
        this.listeners.set(`session:${event}`, listener);
      },
      webRequest: {
        onBeforeRequest: (handler: (details: { url: string }, callback: (response: { cancel: boolean }) => void) => void) => {
          this.beforeRequest = handler;
        },
      },
    },
  };

  async loadURL(url: string): Promise<void> {
    this.loadedUrl = url;
    if (this.failLoadWithUrl) throw new Error(`ERR_FAILED loading ${url}`);
    if (this.hangLoad) await new Promise<void>(() => {});
  }
  setContentSize(width: number, height: number): void { this.contentSize = [width, height]; }
  destroy(): void { this.destroyed = true; }
  isDestroyed(): boolean { return this.destroyed; }
}

function setup(options: {
  cancelled?: boolean;
  dimensions?: unknown;
  hangLoad?: boolean;
  failLoadWithUrl?: boolean;
  invalidClipboardImage?: boolean;
  captureTimeoutMs?: number;
  decodedScale?: number;
} = {}) {
  const captureWindows: FakeCaptureWindow[] = [];
  const captureOptions: CaptureWindowOptionsLike[] = [];
  const image = { isEmpty: (): boolean => options.invalidClipboardImage ?? false };
  const writeImage = vi.fn();
  const writeText = vi.fn();
  const fileLog: string[] = [];
  const writeFile = vi.fn(async (filePath: string) => { fileLog.push(`write:${filePath}`); });
  const rename = vi.fn(async (from: string, to: string) => { fileLog.push(`rename:${from}->${to}`); });
  const rm = vi.fn(async (filePath: string) => { fileLog.push(`rm:${filePath}`); });
  const capturedPng = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const normalizedPng = Buffer.concat([capturedPng, Buffer.from("normalized")]);
  const resize = vi.fn(() => ({
    isEmpty: (): boolean => false,
    getSize: () => ({ width: 900, height: 1680 }),
    toPNG: () => normalizedPng,
  }));
  const dependencies: ElectronExportDependencies = {
    createCaptureWindow(windowOptions) {
      captureOptions.push(windowOptions);
      const window = new FakeCaptureWindow();
      if (options.dimensions !== undefined) window.dimensions = options.dimensions;
      window.hangLoad = options.hangLoad ?? false;
      window.failLoadWithUrl = options.failLoadWithUrl ?? false;
      captureWindows.push(window);
      return window;
    },
    nativeImage: {
      createFromBuffer: vi.fn((buffer) => buffer.subarray(0, 8).equals(capturedPng)
        ? {
          isEmpty: (): boolean => false,
          getSize: () => buffer.equals(normalizedPng)
            ? { width: 900, height: 1680 }
            : {
              width: 900 * (options.decodedScale ?? 1),
              height: 1680 * (options.decodedScale ?? 1),
            },
          resize,
          toPNG: () => buffer,
        }
        : image),
    },
    clipboard: { writeImage, writeText },
    dialog: {
      showSaveDialog: vi.fn(async () => options.cancelled
        ? { canceled: true }
        : { canceled: false, filePath: "/Users/test/Desktop/export.md" }),
    },
    files: {
      writeFile,
      rename,
      rm,
    },
    randomId: () => "fixed-id",
    captureTimeoutMs: options.captureTimeoutMs,
  };
  const adapter = createElectronExportAdapter(dependencies);
  return {
    adapter,
    dependencies,
    captureWindows,
    captureOptions,
    writeImage,
    writeText,
    fileLog,
    resize,
  };
}

describe("Electron native export adapter", () => {
  test("copies PNG and text through Electron clipboard APIs", async () => {
    const { adapter, dependencies, writeImage, writeText } = setup();
    const png = Buffer.from("png-bytes");

    await adapter.copyImage!(png);
    await adapter.copyText!("markdown");

    expect(dependencies.nativeImage.createFromBuffer).toHaveBeenCalledWith(png);
    expect(writeImage).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith("markdown");
  });

  test("rejects an invalid clipboard image", async () => {
    const { adapter, writeImage } = setup({ invalidClipboardImage: true });
    await expect(adapter.copyImage!(Buffer.from("not-png"))).rejects.toThrow(/Invalid PNG/);
    expect(writeImage).not.toHaveBeenCalled();
  });

  test("returns null on save cancellation without touching the filesystem", async () => {
    const { adapter, fileLog } = setup({ cancelled: true });
    await expect(adapter.saveFile({
      suggestedName: "export.md",
      data: "hello",
      dialogTitle: "Save Airgap export",
      buttonLabel: "Save",
    })).resolves.toBeNull();
    expect(fileLog).toEqual([]);
  });

  test("writes a private temporary file beside the destination then atomically renames it", async () => {
    const { adapter, dependencies, fileLog } = setup();
    const saved = await adapter.saveFile({
      suggestedName: "export.md",
      data: "hello",
      dialogTitle: "Save Airgap export",
      buttonLabel: "Save",
    });
    const temporary = "/Users/test/Desktop/.export.md.airgap-fixed-id.tmp";

    expect(saved).toBe("/Users/test/Desktop/export.md");
    expect(dependencies.dialog.showSaveDialog).toHaveBeenCalledWith(
      dependencies.getParentWindow?.(),
      expect.objectContaining({ title: "Save Airgap export", buttonLabel: "Save" }),
    );
    expect(dependencies.files!.writeFile).toHaveBeenCalledWith(
      temporary,
      Buffer.from("hello"),
      { flag: "wx", mode: 0o600 },
    );
    expect(fileLog).toEqual([
      `write:${temporary}`,
      `rename:${temporary}->/Users/test/Desktop/export.md`,
    ]);
    expect(path.dirname(temporary)).toBe("/Users/test/Desktop");
  });

  test("removes only its temporary file after a failed write", async () => {
    const { adapter, dependencies, fileLog } = setup();
    dependencies.files!.writeFile = vi.fn(async (filePath) => {
      fileLog.push(`write:${filePath}`);
      throw new Error("disk full");
    });

    await expect(adapter.saveFile({
      suggestedName: "export.md",
      data: "hello",
      dialogTitle: "Save Airgap export",
      buttonLabel: "Save",
    })).rejects.toThrow("disk full");
    expect(fileLog).toEqual([
      "write:/Users/test/Desktop/.export.md.airgap-fixed-id.tmp",
      "rm:/Users/test/Desktop/.export.md.airgap-fixed-id.tmp",
    ]);
    expect(dependencies.files!.rename).not.toHaveBeenCalled();
  });

  test("removes its temporary file after an atomic rename failure", async () => {
    const { adapter, dependencies, fileLog } = setup();
    dependencies.files!.rename = vi.fn(async (from, to) => {
      fileLog.push(`rename:${from}->${to}`);
      throw new Error("rename failed");
    });

    await expect(adapter.saveFile({
      suggestedName: "export.md",
      data: Buffer.from("hello"),
      dialogTitle: "Save Airgap export",
      buttonLabel: "Save",
    }))
      .rejects.toThrow("rename failed");
    expect(fileLog).toEqual([
      "write:/Users/test/Desktop/.export.md.airgap-fixed-id.tmp",
      "rename:/Users/test/Desktop/.export.md.airgap-fixed-id.tmp->/Users/test/Desktop/export.md",
      "rm:/Users/test/Desktop/.export.md.airgap-fixed-id.tmp",
    ]);
  });

  test("captures a long page in a hidden isolated window and always destroys it", async () => {
    const { adapter, captureWindows, captureOptions } = setup();
    await expect(adapter.renderPng("<!doctype html><html><head></head><body>hello</body></html>"))
      .resolves.toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const window = captureWindows[0]!;

    expect(captureOptions[0]).toMatchObject({
      show: false,
      width: 900,
      height: 780,
      enableLargerThanScreen: true,
      paintWhenInitiallyHidden: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        devTools: false,
        backgroundThrottling: false,
      },
    });
    expect(captureOptions[0]!.webPreferences.partition).toMatch(/^airgap-capture-/);
    expect(captureOptions[0]!.webPreferences.partition).not.toMatch(/^persist:/);
    const encodedDocument = window.loadedUrl.split(",", 2)[1]!;
    expect(Buffer.from(encodedDocument, "base64").toString("utf8"))
      .toContain("Content-Security-Policy");
    expect(window.contentSize).toEqual([900, 1680]);
    expect(window.capturedRect).toEqual({ x: 0, y: 0, width: 900, height: 1680 });
    expect(window.capturedOptions).toEqual({ stayHidden: true });
    expect(window.openHandler!()).toEqual({ action: "deny" });
    expect(window.checkPermission!()).toBe(false);
    let permission: boolean | undefined;
    window.requestPermission!({}, "camera", (allowed) => { permission = allowed; });
    expect(permission).toBe(false);
    const navigation = new FakeEvent();
    window.listeners.get("will-navigate")!({ preventDefault: navigation.preventDefault.bind(navigation) });
    expect(navigation.prevented).toBe(true);
    const download = new FakeEvent();
    window.listeners.get("session:will-download")!({ preventDefault: download.preventDefault.bind(download) });
    expect(download.prevented).toBe(true);
    let remoteCancelled: boolean | undefined;
    window.beforeRequest!({ url: "https://example.com/pixel" }, ({ cancel }) => { remoteCancelled = cancel; });
    expect(remoteCancelled).toBe(true);
    let dataCancelled: boolean | undefined;
    window.beforeRequest!({ url: "data:image/png;base64,AA==" }, ({ cancel }) => { dataCancelled = cancel; });
    expect(dataCancelled).toBe(false);
    expect(window.destroyed).toBe(true);
  });

  test("normalizes an exact Retina representation to a 900px PNG", async () => {
    const { adapter, resize } = setup({ decodedScale: 2 });
    const png = await adapter.renderPng("<html><head></head><body>retina</body></html>");

    expect(resize).toHaveBeenCalledWith({ width: 900, height: 1680, quality: "best" });
    expect(png).toEqual(Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      Buffer.from("normalized"),
    ]));
  });

  test("rejects oversized captures and destroys the hidden window", async () => {
    const { adapter, captureWindows } = setup({ dimensions: { width: 900, height: 8_001 } });
    const rendering = adapter.renderPng("<html><head></head><body>long</body></html>");

    await expect(rendering).rejects.toBeInstanceOf(DesktopCaptureSizeError);
    expect(captureWindows[0]!.capturedRect).toBeUndefined();
    expect(captureWindows[0]!.destroyed).toBe(true);
  });

  test("sanitizes a failed data-URL load before the error leaves the adapter", async () => {
    const secret = "sk-ant-api03-DO-NOT-LOG-THIS-SECRET";
    const { adapter, captureWindows } = setup({ failLoadWithUrl: true });
    const html = `<html><head></head><body>${secret}</body></html>`;

    const rendering = adapter.renderPng(html);
    await expect(rendering).rejects.toBeInstanceOf(DesktopCaptureError);
    await expect(rendering).rejects.not.toThrow(secret);
    await expect(rendering).rejects.not.toThrow(Buffer.from(secret).toString("base64"));
    expect(captureWindows[0]!.destroyed).toBe(true);
  });

  test("rejects oversized HTML before creating a capture window", async () => {
    const { adapter, captureWindows } = setup();
    await expect(adapter.renderPng("x".repeat(8 * 1024 * 1024 + 1)))
      .rejects.toBeInstanceOf(DesktopCaptureSizeError);
    expect(captureWindows).toEqual([]);
  });

  test("times out a stuck capture and destroys its exact hidden window", async () => {
    const { adapter, captureWindows } = setup({ hangLoad: true, captureTimeoutMs: 5 });
    await expect(adapter.renderPng("<html><head></head><body>stuck</body></html>"))
      .rejects.toThrow(/timed out/);
    expect(captureWindows).toHaveLength(1);
    expect(captureWindows[0]!.destroyed).toBe(true);
  });
});
