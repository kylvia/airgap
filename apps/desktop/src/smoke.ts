import { spawn, type ChildProcess } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";

export interface DesktopSmokeConfig {
  resultPath: string;
  userDataPath: string;
  isSecondLaunch: boolean;
}

export interface DesktopSmokeResult {
  ok: boolean;
  appVersion: string;
  authenticatedRedirect: boolean;
  nodeGlobalsAbsent: boolean;
  sessionsDiscovered: boolean;
  settingsDialogOpened: boolean;
  settingsBackdropInputSent: boolean;
  settingsDialogClosed: boolean;
  settingsInteractionSettled: boolean;
  settingsFocusRestored: boolean;
  conversationChanged: boolean;
  turnSelected: boolean;
  rawIdsHidden: boolean;
  textClipboardBytes: number;
  imageClipboardBytes: number;
  secondInstanceObserved: boolean;
  secondLaunchExited: boolean;
  lifecycleEvents: string[];
}

interface SmokeBrowserWindow {
  readonly webContents: {
    executeJavaScript<T>(code: string): Promise<T>;
    getURL(): string;
    sendInputEvent(event: {
      type: "mouseDown" | "mouseUp";
      x: number;
      y: number;
      button: "left";
      clickCount: number;
    }): void;
  };
  close(): void;
  isDestroyed(): boolean;
}

interface SmokeApp {
  getVersion(): string;
  once(event: "second-instance", listener: () => void): void;
}

interface SmokeClipboard {
  clear(): void;
  readText(): string;
  readImage(): { isEmpty(): boolean; toPNG(): Buffer };
}

export interface DesktopSmokeDependencies {
  config: DesktopSmokeConfig;
  app: SmokeApp;
  window: SmokeBrowserWindow;
  clipboard: SmokeClipboard;
  executablePath?: string;
  entryPath?: string;
  env?: NodeJS.ProcessEnv;
  logOrigin?(origin: string): void;
}

export function readDesktopSmokeConfig(options: {
  isPackaged: boolean;
  env: NodeJS.ProcessEnv;
}): DesktopSmokeConfig | null {
  if (options.isPackaged || options.env["AIRGAP_DESKTOP_SMOKE"] !== "1") return null;

  const resultPath = options.env["AIRGAP_DESKTOP_SMOKE_RESULT"];
  const userDataPath = options.env["AIRGAP_DESKTOP_SMOKE_USER_DATA"];
  if (!resultPath || !userDataPath || !path.isAbsolute(resultPath) || !path.isAbsolute(userDataPath)) {
    throw new TypeError("desktop smoke result and user-data paths must be absolute paths");
  }
  return {
    resultPath,
    userDataPath,
    isSecondLaunch: options.env["AIRGAP_DESKTOP_SMOKE_CHILD"] === "1",
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function poll<T>(
  operation: () => Promise<T> | T,
  accept: (value: T) => boolean,
  timeoutMs = 8_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = await operation();
      if (accept(value)) return value;
    } catch {
      // Navigation can invalidate a single renderer evaluation; retry until the deadline.
    }
    await delay(80);
  }
  throw new Error("desktop smoke stage timed out");
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (exited: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(exited);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(false);
    }, timeoutMs);
    child.once("error", () => finish(false));
    child.once("exit", (code) => finish(code === 0));
  });
}

function waitForSecondInstance(app: SmokeApp, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    app.once("second-instance", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

async function writeResult(resultPath: string, result: DesktopSmokeResult): Promise<void> {
  await writeFile(resultPath, `${JSON.stringify(result)}\n`, "utf8");
}

function createInitialResult(appVersion: string): DesktopSmokeResult {
  return {
    ok: false,
    appVersion,
    authenticatedRedirect: false,
    nodeGlobalsAbsent: false,
    sessionsDiscovered: false,
    settingsDialogOpened: false,
    settingsBackdropInputSent: false,
    settingsDialogClosed: false,
    settingsInteractionSettled: false,
    settingsFocusRestored: false,
    conversationChanged: false,
    turnSelected: false,
    rawIdsHidden: false,
    textClipboardBytes: 0,
    imageClipboardBytes: 0,
    secondInstanceObserved: false,
    secondLaunchExited: false,
    lifecycleEvents: ["ready"],
  };
}

export async function runDesktopSmoke(dependencies: DesktopSmokeDependencies): Promise<void> {
  const result = createInitialResult(dependencies.app.getVersion());
  let stage = "authenticated";

  try {
    const rendererState = await poll(
      () => dependencies.window.webContents.executeJavaScript<{
        authenticated: boolean;
        secureGlobals: boolean;
        sessions: number;
        rows: number;
        rawIdsHidden: boolean;
      }>(`(() => {
        const picker = document.querySelector('[data-testid="conversation-picker"]');
        const text = document.body ? document.body.innerText : '';
        return {
          authenticated: location.hostname === '127.0.0.1' && location.search === '' && document.body?.dataset.surface === 'desktop',
          secureGlobals: typeof globalThis.process === 'undefined' && typeof globalThis.require === 'undefined',
          sessions: picker instanceof HTMLSelectElement ? picker.options.length : 0,
          rows: document.querySelectorAll('[data-testid="turn-list"] .row').length,
          rawIdsHidden: !/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(text),
        };
      })()`),
      (value) => value.authenticated && value.sessions >= 2 && value.rows > 0,
    );
    result.authenticatedRedirect = rendererState.authenticated;
    result.nodeGlobalsAbsent = rendererState.secureGlobals;
    result.sessionsDiscovered = rendererState.sessions >= 2;
    result.rawIdsHidden = rendererState.rawIdsHidden;
    if (!result.nodeGlobalsAbsent || !result.rawIdsHidden) throw new Error("renderer boundary check failed");
    result.lifecycleEvents.push("authenticated");

    const currentUrl = new URL(dependencies.window.webContents.getURL());
    dependencies.logOrigin?.(currentUrl.origin);

    stage = "settings-dialog";
    const settingsState = await dependencies.window.webContents.executeJavaScript<{
      opened: boolean;
      busyStarted: boolean;
      x: number;
      y: number;
      viewportWidth: number;
      viewportHeight: number;
      dialogLeft: number;
      dialogTop: number;
      dialogRight: number;
      dialogBottom: number;
    }>(`(() => {
      const button = document.querySelector('[data-testid="settings"]');
      const panel = document.getElementById('prefpanel');
      const limit = document.getElementById('limit');
      if (!(button instanceof HTMLButtonElement) ||
          !(panel instanceof HTMLDialogElement) ||
          !(limit instanceof HTMLSelectElement)) {
        return { opened: false, busyStarted: false, x: -1, y: -1,
          viewportWidth: innerWidth, viewportHeight: innerHeight,
          dialogLeft: 0, dialogTop: 0, dialogRight: 0, dialogBottom: 0 };
      }
      button.click();
      const opened = panel.open && document.activeElement === panel;
      const target = [...limit.options].find((option) => option.value !== limit.value);
      let busyStarted = false;
      if (opened && target) {
        limit.value = target.value;
        limit.dispatchEvent(new Event('change', { bubbles: true }));
        busyStarted = button.disabled;
      }
      const rect = panel.getBoundingClientRect();
      const candidates = [
        { x: 1, y: 1 },
        { x: Math.max(0, innerWidth - 2), y: 1 },
        { x: 1, y: Math.max(0, innerHeight - 2) },
        { x: Math.max(0, innerWidth - 2), y: Math.max(0, innerHeight - 2) },
      ];
      const point = candidates.find(({ x, y }) =>
        x >= 0 && y >= 0 && x < innerWidth && y < innerHeight &&
        (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom));
      return {
        opened,
        busyStarted,
        x: point?.x ?? -1,
        y: point?.y ?? -1,
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        dialogLeft: rect.left,
        dialogTop: rect.top,
        dialogRight: rect.right,
        dialogBottom: rect.bottom,
      };
    })()`);
    result.settingsDialogOpened = settingsState.opened;
    const coordinates = [
      settingsState.x,
      settingsState.y,
      settingsState.viewportWidth,
      settingsState.viewportHeight,
      settingsState.dialogLeft,
      settingsState.dialogTop,
      settingsState.dialogRight,
      settingsState.dialogBottom,
    ];
    const pointInViewport = settingsState.x >= 0 && settingsState.y >= 0 &&
      settingsState.x < settingsState.viewportWidth &&
      settingsState.y < settingsState.viewportHeight;
    const pointOutsideDialog = settingsState.x < settingsState.dialogLeft ||
      settingsState.x >= settingsState.dialogRight ||
      settingsState.y < settingsState.dialogTop ||
      settingsState.y >= settingsState.dialogBottom;
    if (!settingsState.opened || !settingsState.busyStarted ||
        !coordinates.every(Number.isFinite) || !pointInViewport || !pointOutsideDialog) {
      throw new Error("settings dialog check failed");
    }
    dependencies.window.webContents.sendInputEvent({
      type: "mouseDown",
      x: settingsState.x,
      y: settingsState.y,
      button: "left",
      clickCount: 1,
    });
    dependencies.window.webContents.sendInputEvent({
      type: "mouseUp",
      x: settingsState.x,
      y: settingsState.y,
      button: "left",
      clickCount: 1,
    });
    result.settingsBackdropInputSent = true;
    result.settingsDialogClosed = await poll(
      () => dependencies.window.webContents.executeJavaScript<boolean>(`(() => {
        const panel = document.getElementById('prefpanel');
        return panel instanceof HTMLDialogElement && !panel.open;
      })()`),
      Boolean,
    );
    result.settingsInteractionSettled = await poll(
      () => dependencies.window.webContents.executeJavaScript<boolean>(`(() => {
        const panel = document.getElementById('prefpanel');
        const button = document.querySelector('[data-testid="settings"]');
        return panel instanceof HTMLDialogElement && !panel.open &&
          button instanceof HTMLButtonElement && !button.disabled;
      })()`),
      Boolean,
      15_000,
    );
    result.settingsFocusRestored = await poll(
      () => dependencies.window.webContents.executeJavaScript<boolean>(`(() => {
        const button = document.querySelector('[data-testid="settings"]');
        return button instanceof HTMLButtonElement && document.activeElement === button;
      })()`),
      Boolean,
      2_000,
    );
    result.lifecycleEvents.push("settings-dialog");

    stage = "conversation-selected";
    const selectionStarted = await dependencies.window.webContents.executeJavaScript<boolean>(`(() => {
      const picker = document.querySelector('[data-testid="conversation-picker"]');
      if (!(picker instanceof HTMLSelectElement) || picker.options.length < 2) return false;
      const original = picker.value;
      const target = [...picker.options].find((option) => option.value !== original);
      if (!target) return false;
      globalThis.__airgapSmokeOriginalConversation = original;
      picker.value = target.value;
      picker.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    if (!selectionStarted) throw new Error("conversation selection did not start");
    result.conversationChanged = await poll(
      () => dependencies.window.webContents.executeJavaScript<boolean>(`(() => {
        const picker = document.querySelector('[data-testid="conversation-picker"]');
        const textButton = document.querySelector('[data-testid="copy-text"]');
        return picker instanceof HTMLSelectElement &&
          picker.value !== globalThis.__airgapSmokeOriginalConversation &&
          !picker.disabled &&
          document.querySelectorAll('[data-testid="turn-list"] .row').length > 0 &&
          textButton instanceof HTMLButtonElement && !textButton.disabled;
      })()`),
      Boolean,
    );
    result.lifecycleEvents.push("conversation-selected");

    stage = "turn-selected";
    result.turnSelected = await dependencies.window.webContents.executeJavaScript<boolean>(`(() => {
      const none = document.getElementById('none');
      if (!(none instanceof HTMLButtonElement) || none.disabled) return false;
      none.click();
      const checkbox = document.querySelector('[data-testid="turn-list"] input[type="checkbox"]');
      if (!(checkbox instanceof HTMLInputElement) || checkbox.disabled) return false;
      checkbox.click();
      return checkbox.checked;
    })()`);
    if (!result.turnSelected) throw new Error("turn selection failed");
    result.lifecycleEvents.push("turn-selected");

    stage = "text-exported";
    dependencies.clipboard.clear();
    const textClick = await dependencies.window.webContents.executeJavaScript<boolean>(`(() => {
      const button = document.querySelector('[data-testid="copy-text"]');
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
      button.click();
      return true;
    })()`);
    if (!textClick) throw new Error("text export did not start");
    const clipboardText = await poll(() => dependencies.clipboard.readText(), (value) => value.length > 0);
    result.textClipboardBytes = Buffer.byteLength(clipboardText, "utf8");
    result.lifecycleEvents.push("text-exported");

    stage = "image-exported";
    dependencies.clipboard.clear();
    await poll(
      () => dependencies.window.webContents.executeJavaScript<boolean>(`(() => {
        const button = document.querySelector('[data-testid="copy-image"]');
        if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
        button.click();
        return true;
      })()`),
      Boolean,
    );
    const clipboardImage = await poll(
      () => dependencies.clipboard.readImage(),
      (image) => !image.isEmpty() && image.toPNG().length > 8,
      20_000,
    );
    result.imageClipboardBytes = clipboardImage.toPNG().length;
    result.lifecycleEvents.push("image-exported");

    stage = "second-instance";
    const executablePath = dependencies.executablePath ?? process.execPath;
    const entryPath = dependencies.entryPath ?? process.argv[1];
    if (!entryPath || !path.isAbsolute(entryPath)) throw new Error("desktop smoke entry path is invalid");
    const secondInstance = waitForSecondInstance(dependencies.app, 5_000);
    const child = spawn(executablePath, [entryPath], {
      stdio: "ignore",
      env: {
        ...(dependencies.env ?? process.env),
        AIRGAP_DESKTOP_SMOKE_CHILD: "1",
      },
    });
    const [secondInstanceObserved, secondLaunchExited] = await Promise.all([
      secondInstance,
      waitForExit(child, 5_000),
    ]);
    result.secondInstanceObserved = secondInstanceObserved;
    result.secondLaunchExited = secondLaunchExited;
    if (!secondInstanceObserved || !secondLaunchExited) throw new Error("single-instance check failed");
    result.lifecycleEvents.push("second-instance", "second-launch-exited");

    result.ok = true;
    result.lifecycleEvents.push("result-written");
    await writeResult(dependencies.config.resultPath, result);
    result.lifecycleEvents.push("window-close-requested");
    await writeResult(dependencies.config.resultPath, result);
    dependencies.window.close();
  } catch {
    result.ok = false;
    result.lifecycleEvents.push(`failed:${stage}`);
    await writeResult(dependencies.config.resultPath, result);
    if (!dependencies.window.isDestroyed()) dependencies.window.close();
    throw new Error(`desktop smoke failed at ${stage}`);
  }
}
