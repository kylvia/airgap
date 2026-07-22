import { randomUUID } from "node:crypto";
import type {
  DesktopFailurePhase,
  DesktopRuntime,
  DesktopWindow,
} from "./app-controller.js";
import {
  STARTUP_ERROR_QUIT_URL,
  STARTUP_ERROR_RETRY_URL,
  renderStartupErrorDocument,
} from "./startup-error.js";

export const REPOSITORY_URL = "https://github.com/kylvia/airgap";
export const RELEASES_URL = "https://github.com/kylvia/airgap/releases";

const CLICK_DISPOSITIONS = new Set(["foreground-tab", "background-tab"]);
const EXTERNAL_URLS = new Set([REPOSITORY_URL, RELEASES_URL]);
const ERR_ABORTED = -3;
const USER_GESTURE_WINDOW_MS = 1_000;
const NATIVE_FOCUS_SCRIPT = 'window.dispatchEvent(new Event("airgap-native-focus"));';

export interface BrowserWindowOptionsLike {
  title: string;
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  show: boolean;
  webPreferences: {
    nodeIntegration: boolean;
    contextIsolation: boolean;
    sandbox: boolean;
    webSecurity: boolean;
    devTools: boolean;
    partition: string;
  };
}

interface NavigationEventLike {
  url: string;
  preventDefault(): void;
}

interface WebContentsLike {
  on(event: string, listener: (...args: any[]) => void): void;
  executeJavaScript(script: string): Promise<unknown>;
  setWindowOpenHandler(handler: (details: {
    url: string;
    disposition: string;
  }) => { action: "deny" }): void;
  navigationHistory: { clear(): void };
  session: {
    setPermissionRequestHandler(handler: (
      webContents: unknown,
      permission: string,
      callback: (allowed: boolean) => void,
    ) => void): void;
    setPermissionCheckHandler(handler: (
      webContents: unknown,
      permission: string,
      requestingOrigin: string,
    ) => boolean): void;
  };
}

export interface BrowserWindowLike {
  readonly webContents: WebContentsLike;
  on(event: string, listener: (...args: any[]) => void): void;
  once(event: string, listener: (...args: any[]) => void): void;
  loadURL(url: string): Promise<void>;
  show(): void;
  focus(): void;
  restore(): void;
  isMinimized(): boolean;
  isDestroyed(): boolean;
}

interface AppLike {
  readonly isPackaged: boolean;
  requestSingleInstanceLock(): boolean;
  on(event: string, listener: (...args: any[]) => void): void;
  getVersion(): string;
  quit(): void;
}

export interface ElectronRuntimeDependencies {
  app: AppLike;
  createBrowserWindow(options: BrowserWindowOptionsLike): BrowserWindowLike;
  shell: { openExternal(url: string): Promise<void> };
  dialog: {
    showMessageBox(options: {
      type: "error";
      title: string;
      message: string;
      detail: string;
      buttons: string[];
      defaultId: number;
      cancelId: number;
      noLink: boolean;
    }): Promise<{ response: number }>;
  };
  report?(error: unknown, phase: DesktopFailurePhase): void;
  sessionPartition?: string;
  now?(): number;
}

function isAllowedOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.origin === origin &&
      url.protocol === "http:" &&
      url.hostname === "127.0.0.1" &&
      url.username === "" &&
      url.password === "" &&
      url.port !== "";
  } catch {
    return false;
  }
}

function isSameOrigin(url: string, allowedOrigin: string | undefined): boolean {
  if (!allowedOrigin) return false;
  try {
    return new URL(url).origin === allowedOrigin;
  } catch {
    return false;
  }
}

class ElectronDesktopWindow implements DesktopWindow {
  private allowedOrigin: string | undefined;
  private errorActions: { retry(): void; quit(): void } | undefined;
  private rendererFailureListener: ((error: unknown) => void) | undefined;

  constructor(
    private readonly window: BrowserWindowLike,
    private readonly openExternal: (url: string) => void,
    private readonly now: () => number,
  ) {
    let gestureExpiresAt = 0;
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => {
      callback(false);
    });
    window.webContents.session.setPermissionCheckHandler(() => false);
    window.on("focus", () => {
      // DOM focus also fires when focus moves out of the preview iframe. Bridge the
      // native BrowserWindow event so the renderer refreshes only on real app focus.
      void window.webContents.executeJavaScript(NATIVE_FOCUS_SCRIPT).catch(() => {});
    });
    window.webContents.on("before-mouse-event", (_event: unknown, mouse: { type: string }) => {
      if (mouse.type === "mouseUp") gestureExpiresAt = this.now() + USER_GESTURE_WINDOW_MS;
    });
    window.webContents.on(
      "before-input-event",
      (_event: unknown, input: { type: string; key: string; isAutoRepeat: boolean }) => {
        if (input.type === "keyDown" && input.key === "Enter" && !input.isAutoRepeat) {
          gestureExpiresAt = this.now() + USER_GESTURE_WINDOW_MS;
        }
      },
    );
    window.webContents.setWindowOpenHandler((details) => {
      const hasPhysicalGesture = gestureExpiresAt >= this.now() && gestureExpiresAt !== 0;
      gestureExpiresAt = 0;
      if (
        EXTERNAL_URLS.has(details.url) &&
        CLICK_DISPOSITIONS.has(details.disposition) &&
        hasPhysicalGesture
      ) {
        this.openExternal(details.url);
      }
      return { action: "deny" };
    });
    window.webContents.on("will-navigate", (event: NavigationEventLike) => {
      if (event.url === STARTUP_ERROR_RETRY_URL && this.errorActions) {
        event.preventDefault();
        const actions = this.errorActions;
        this.errorActions = undefined;
        actions.retry();
        return;
      }
      if (event.url === STARTUP_ERROR_QUIT_URL && this.errorActions) {
        event.preventDefault();
        const actions = this.errorActions;
        this.errorActions = undefined;
        actions.quit();
        return;
      }
      if (!isSameOrigin(event.url, this.allowedOrigin)) event.preventDefault();
    });
    window.webContents.on("will-redirect", (event: NavigationEventLike) => {
      if (!isSameOrigin(event.url, this.allowedOrigin)) event.preventDefault();
    });
    window.webContents.on(
      "did-fail-load",
      (
        _event: unknown,
        errorCode: number,
        _errorDescription: string,
        _validatedUrl: string,
        isMainFrame: boolean,
      ) => {
        if (!isMainFrame || errorCode === ERR_ABORTED) return;
        this.rendererFailureListener?.(new Error(`main-frame load failed (${errorCode})`));
      },
    );
    window.webContents.on("render-process-gone", () => {
      this.rendererFailureListener?.(new Error("renderer process exited"));
    });
  }

  show(): void { this.window.show(); }
  focus(): void { this.window.focus(); }
  restore(): void { this.window.restore(); }
  isMinimized(): boolean { return this.window.isMinimized(); }
  isDestroyed(): boolean { return this.window.isDestroyed(); }

  once(event: "ready-to-show" | "closed", listener: () => void): void {
    this.window.once(event, listener);
  }

  loadURL(url: string): Promise<void> {
    this.errorActions = undefined;
    return this.window.loadURL(url);
  }

  setAllowedOrigin(origin: string): void {
    if (!isAllowedOrigin(origin)) {
      throw new TypeError("desktop origin must be an exact IPv4 loopback HTTP origin");
    }
    this.allowedOrigin = origin;
  }

  clearNavigationHistory(): void {
    this.window.webContents.navigationHistory.clear();
  }

  onRendererFailure(listener: (error: unknown) => void): void {
    this.rendererFailureListener = listener;
  }

  async showStartupError(actions: { retry(): void; quit(): void }): Promise<void> {
    this.errorActions = actions;
    const document = renderStartupErrorDocument();
    try {
      await this.window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(document)}`);
      this.window.webContents.navigationHistory.clear();
    } catch (error) {
      this.errorActions = undefined;
      throw error;
    }
  }
}

export function createElectronRuntime(
  dependencies: ElectronRuntimeDependencies,
): DesktopRuntime {
  const sessionPartition = dependencies.sessionPartition ?? `airgap-${randomUUID()}`;
  if (sessionPartition.length === 0 || sessionPartition.startsWith("persist:")) {
    throw new TypeError("desktop session partition must be non-persistent");
  }
  const now = dependencies.now ?? Date.now;
  const reportError = (error: unknown, phase: DesktopFailurePhase): void => {
    if (dependencies.report) {
      dependencies.report(error, phase);
      return;
    }
    // Never print Error.message here: load errors can contain the bootstrap capability URL.
    console.error(`[Airgap] ${phase}`);
  };

  return {
    acquireSingleInstanceLock: () => dependencies.app.requestSingleInstanceLock(),
    onSecondInstance: (listener) => { dependencies.app.on("second-instance", listener); },
    createWindow: () => {
      const window = dependencies.createBrowserWindow({
        title: "Airgap",
        width: 1180,
        height: 780,
        minWidth: 960,
        minHeight: 640,
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          devTools: !dependencies.app.isPackaged,
          partition: sessionPartition,
        },
      });
      return new ElectronDesktopWindow(window, (url) => {
        void dependencies.shell.openExternal(url).catch((error: unknown) => {
          reportError(error, "external-open");
        });
      }, now);
    },
    getVersion: () => dependencies.app.getVersion(),
    reportError,
    async showFatalError(actions) {
      const result = await dependencies.dialog.showMessageBox({
        type: "error",
        title: "Airgap 启动失败",
        message: "Airgap 暂时无法启动",
        detail: "没有读取或发送任何会话内容。你可以重试，或退出后重新打开 Airgap。",
        buttons: ["重试", "退出"],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      if (result.response === 0) actions.retry();
      else actions.quit();
    },
    quit: () => dependencies.app.quit(),
  };
}
