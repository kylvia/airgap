import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ShareExportAdapter } from "../../../src/server/share-export.js";

const CAPTURE_WIDTH = 900;
const INITIAL_CAPTURE_HEIGHT = 780;
// Forced-2x integration covers 7,920 CSS px (15,840 physical px). Taller output
// needs tiled capture/composition rather than relying on one Chromium surface.
const MAX_CAPTURE_HEIGHT = 8_000;
const MAX_HTML_BYTES = 8 * 1024 * 1024;
const DEFAULT_CAPTURE_TIMEOUT_MS = 20_000;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export class DesktopCaptureSizeError extends Error {
  constructor(message = "The conversation is too large for one image") {
    super(message);
    this.name = "DesktopCaptureSizeError";
  }
}

export class DesktopCaptureTimeoutError extends Error {
  constructor() {
    super("Desktop image capture timed out");
    this.name = "DesktopCaptureTimeoutError";
  }
}

export interface CaptureWindowOptionsLike {
  show: false;
  width: number;
  height: number;
  enableLargerThanScreen: true;
  paintWhenInitiallyHidden: true;
  webPreferences: {
    nodeIntegration: false;
    contextIsolation: true;
    sandbox: true;
    webSecurity: true;
    devTools: false;
    backgroundThrottling: false;
    partition: string;
  };
}

interface NativeImageLike {
  isEmpty(): boolean;
  getSize?(): { width: number; height: number };
  resize?(options: {
    width: number;
    height: number;
    quality: "best";
  }): NativeImageLike;
  toPNG?(options?: { scaleFactor: number }): Buffer;
}

interface CapturedImageLike extends NativeImageLike {
  toPNG(options?: { scaleFactor: number }): Buffer;
}

interface CaptureWebContentsLike {
  on(event: string, listener: (...args: any[]) => void): void;
  setWindowOpenHandler(handler: () => { action: "deny" }): void;
  executeJavaScript(code: string): Promise<unknown>;
  capturePage(
    rect: { x: number; y: number; width: number; height: number },
    options: { stayHidden: true },
  ): Promise<CapturedImageLike>;
  session: {
    setPermissionRequestHandler(handler: (
      webContents: unknown,
      permission: string,
      callback: (allowed: boolean) => void,
    ) => void): void;
    setPermissionCheckHandler(handler: () => boolean): void;
    on(event: string, listener: (...args: any[]) => void): void;
    webRequest: {
      onBeforeRequest(handler: (
        details: { url: string },
        callback: (response: { cancel: boolean }) => void,
      ) => void): void;
    };
  };
}

export interface CaptureWindowLike {
  readonly webContents: CaptureWebContentsLike;
  loadURL(url: string): Promise<void>;
  setContentSize(width: number, height: number): void;
  destroy(): void;
  isDestroyed(): boolean;
}

interface SaveDialogOptionsLike {
  title: string;
  buttonLabel: string;
  defaultPath: string;
  properties: string[];
}

interface FileOperations {
  writeFile(
    filePath: string,
    data: Buffer,
    options: { flag: "wx"; mode: number },
  ): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  rm(filePath: string, options: { force: true }): Promise<void>;
}

export interface ElectronExportDependencies {
  createCaptureWindow(options: CaptureWindowOptionsLike): CaptureWindowLike;
  nativeImage: { createFromBuffer(buffer: Buffer): NativeImageLike };
  clipboard: {
    writeImage(image: NativeImageLike): void;
    writeText(text: string): void;
  };
  dialog: {
    showSaveDialog(
      parent: unknown | undefined,
      options: SaveDialogOptionsLike,
    ): Promise<{ canceled: boolean; filePath?: string }>;
  };
  getParentWindow?(): unknown | undefined;
  files?: FileOperations;
  randomId?(): string;
  captureTimeoutMs?: number;
}

interface CaptureDimensions {
  width: number;
  height: number;
}

const MEASURE_SCRIPT = `(() => new Promise((resolve) => {
  const afterFonts = document.fonts && document.fonts.ready
    ? document.fonts.ready.catch(() => undefined)
    : Promise.resolve();
  afterFonts.then(() => requestAnimationFrame(() => requestAnimationFrame(() => {
    const root = document.documentElement;
    resolve({ width: root.scrollWidth, height: root.scrollHeight });
  })));
}))()`;

function validateSuggestedName(suggestedName: string): void {
  if (
    suggestedName.length === 0 ||
    suggestedName === "." ||
    suggestedName === ".." ||
    path.basename(suggestedName) !== suggestedName
  ) {
    throw new Error("Invalid export filename");
  }
}

function validateRandomId(id: string): string {
  if (!/^[A-Za-z0-9-]+$/.test(id)) throw new Error("Invalid random identifier");
  return id;
}

function hardenCaptureHtml(html: string): string {
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'">`;
  if (/<head(?:\s[^>]*)?>/i.test(html)) {
    return html.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${csp}`);
  }
  return `${csp}${html}`;
}

function parseDimensions(value: unknown): CaptureDimensions {
  if (typeof value !== "object" || value === null) throw new DesktopCaptureSizeError();
  const record = value as Record<string, unknown>;
  const width = record["width"];
  const height = record["height"];
  if (
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Number.isFinite(width) ||
    !Number.isFinite(height)
  ) throw new DesktopCaptureSizeError();
  const dimensions = { width: Math.ceil(width), height: Math.ceil(height) };
  if (
    dimensions.width < 1 ||
    dimensions.width > CAPTURE_WIDTH ||
    dimensions.height < 1 ||
    dimensions.height > MAX_CAPTURE_HEIGHT
  ) throw new DesktopCaptureSizeError();
  return dimensions;
}

function hasPngSignature(buffer: Buffer): boolean {
  return buffer.length >= PNG_SIGNATURE.length &&
    buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new DesktopCaptureTimeoutError()), timeoutMs);
    timer.unref?.();
  });
  return Promise.race([operation, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function configureCaptureWindow(
  window: CaptureWindowLike,
  configuredSessions: WeakSet<object>,
): void {
  const deny = (event: { preventDefault(): void }): void => event.preventDefault();
  window.webContents.on("will-navigate", deny);
  window.webContents.on("will-frame-navigate", deny);
  window.webContents.on("will-redirect", deny);
  window.webContents.on("will-attach-webview", deny);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  const session = window.webContents.session;
  if (!configuredSessions.has(session)) {
    configuredSessions.add(session);
    session.setPermissionRequestHandler((_contents, _permission, callback) => {
      callback(false);
    });
    session.setPermissionCheckHandler(() => false);
    session.on("will-download", deny);
    session.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: !details.url.startsWith("data:") });
    });
  }
}

export function createElectronExportAdapter(
  dependencies: ElectronExportDependencies,
): ShareExportAdapter {
  const files = dependencies.files ?? { writeFile, rename, rm };
  const randomId = dependencies.randomId ?? randomUUID;
  const captureTimeoutMs = dependencies.captureTimeoutMs ?? DEFAULT_CAPTURE_TIMEOUT_MS;
  const capturePartition = `airgap-capture-${validateRandomId(randomId())}`;
  const configuredSessions = new WeakSet<object>();
  let captureQueue: Promise<void> = Promise.resolve();

  const renderPng = (html: string): Promise<Buffer> => {
    const run = async (): Promise<Buffer> => {
      const htmlBytes = Buffer.byteLength(html, "utf8");
      if (htmlBytes > MAX_HTML_BYTES) throw new DesktopCaptureSizeError();

      let window: CaptureWindowLike | undefined;
      const capture = async (): Promise<Buffer> => {
        window = dependencies.createCaptureWindow({
          show: false,
          width: CAPTURE_WIDTH,
          height: INITIAL_CAPTURE_HEIGHT,
          enableLargerThanScreen: true,
          paintWhenInitiallyHidden: true,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
            devTools: false,
            backgroundThrottling: false,
            partition: capturePartition,
          },
        });
        configureCaptureWindow(window, configuredSessions);
        window.setContentSize(CAPTURE_WIDTH, INITIAL_CAPTURE_HEIGHT);

        const hardenedHtml = hardenCaptureHtml(html);
        const dataUrl = `data:text/html;charset=utf-8;base64,${Buffer.from(hardenedHtml, "utf8").toString("base64")}`;
        await window.loadURL(dataUrl);

        let dimensions = parseDimensions(
          await window.webContents.executeJavaScript(MEASURE_SCRIPT),
        );
        let stable = false;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          window.setContentSize(CAPTURE_WIDTH, dimensions.height);
          const next = parseDimensions(
            await window.webContents.executeJavaScript(MEASURE_SCRIPT),
          );
          if (next.height === dimensions.height && next.width === dimensions.width) {
            dimensions = next;
            stable = true;
            break;
          }
          dimensions = next;
        }
        if (!stable) throw new DesktopCaptureSizeError("The image layout did not stabilize");

        const captured = await window.webContents.capturePage(
          { x: 0, y: 0, width: CAPTURE_WIDTH, height: dimensions.height },
          { stayHidden: true },
        );
        if (captured.isEmpty()) throw new Error("Electron returned an empty capture");
        let png = captured.toPNG({ scaleFactor: 1 });
        if (!hasPngSignature(png)) throw new Error("Electron returned an invalid PNG");
        let decoded = dependencies.nativeImage.createFromBuffer(png);
        let decodedSize = decoded.getSize?.();
        const retinaScale = decodedSize
          ? decodedSize.width / CAPTURE_WIDTH
          : 0;
        if (
          decodedSize &&
          Number.isInteger(retinaScale) &&
          retinaScale > 1 &&
          decodedSize.height === dimensions.height * retinaScale &&
          decoded.resize
        ) {
          const normalized = decoded.resize({
            width: CAPTURE_WIDTH,
            height: dimensions.height,
            quality: "best",
          });
          if (normalized.isEmpty() || !normalized.toPNG) {
            throw new Error("Electron could not normalize the PNG scale");
          }
          png = normalized.toPNG({ scaleFactor: 1 });
          if (!hasPngSignature(png)) throw new Error("Electron returned an invalid normalized PNG");
          decoded = dependencies.nativeImage.createFromBuffer(png);
          decodedSize = decoded.getSize?.();
        }
        if (
          decoded.isEmpty() ||
          !decodedSize ||
          decodedSize.width !== CAPTURE_WIDTH ||
          decodedSize.height !== dimensions.height
        ) {
          const actual = decodedSize ? `${decodedSize.width}x${decodedSize.height}` : "unknown";
          throw new Error(
            `Electron returned a truncated PNG (expected ${CAPTURE_WIDTH}x${dimensions.height}, got ${actual})`,
          );
        }
        return png;
      };

      try {
        return await withTimeout(capture(), captureTimeoutMs);
      } finally {
        if (window && !window.isDestroyed()) window.destroy();
      }
    };

    const result = captureQueue.then(run, run);
    captureQueue = result.then(() => undefined, () => undefined);
    return result;
  };

  return {
    renderPng,
    async copyImage(png) {
      const image = dependencies.nativeImage.createFromBuffer(png);
      if (image.isEmpty()) throw new Error("Invalid PNG clipboard image");
      dependencies.clipboard.writeImage(image);
    },
    async copyText(text) {
      dependencies.clipboard.writeText(text);
    },
    async saveFile(request) {
      validateSuggestedName(request.suggestedName);
      const selected = await dependencies.dialog.showSaveDialog(
        dependencies.getParentWindow?.(),
        {
          title: "保存 Airgap 导出",
          buttonLabel: "保存",
          defaultPath: request.suggestedName,
          properties: ["createDirectory", "showOverwriteConfirmation"],
        },
      );
      if (selected.canceled || !selected.filePath) return null;
      if (!path.isAbsolute(selected.filePath)) throw new Error("Invalid export destination");

      const targetPath = selected.filePath;
      const temporaryPath = path.join(
        path.dirname(targetPath),
        `.${path.basename(targetPath)}.airgap-${validateRandomId(randomId())}.tmp`,
      );
      const data = typeof request.data === "string"
        ? Buffer.from(request.data, "utf8")
        : request.data;
      try {
        await files.writeFile(temporaryPath, data, { flag: "wx", mode: 0o600 });
        await files.rename(temporaryPath, targetPath);
        return targetPath;
      } catch (error) {
        try {
          await files.rm(temporaryPath, { force: true });
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            "Export failed and its temporary file could not be cleaned up",
          );
        }
        throw error;
      }
    },
  };
}
