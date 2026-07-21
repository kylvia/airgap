import { describe, expect, test, vi } from "vitest";
import {
  RELEASES_URL,
  REPOSITORY_URL,
  createElectronRuntime,
  type BrowserWindowLike,
  type BrowserWindowOptionsLike,
  type ElectronRuntimeDependencies,
} from "../src/electron-runtime.js";
import {
  STARTUP_ERROR_QUIT_URL,
  STARTUP_ERROR_RETRY_URL,
} from "../src/startup-error.js";

class FakeEvent {
  prevented = false;

  preventDefault(): void {
    this.prevented = true;
  }
}

class FakeWindow implements BrowserWindowLike {
  minimized = false;
  destroyed = false;
  readonly windowListeners = new Map<string, (...args: unknown[]) => void>();
  readonly webListeners = new Map<string, (...args: unknown[]) => void>();
  readonly loadedUrls: string[] = [];
  openHandler: ((details: { url: string; disposition: string }) => { action: "deny" }) | undefined;
  permissionHandler: ((webContents: unknown, permission: string, callback: (allowed: boolean) => void) => void) | undefined;
  permissionCheckHandler: ((webContents: unknown, permission: string, requestingOrigin: string) => boolean) | undefined;
  showCalls = 0;
  focusCalls = 0;
  restoreCalls = 0;
  historyClearCalls = 0;

  readonly webContents = {
    on: (event: string, listener: (...args: unknown[]) => void) => {
      this.webListeners.set(event, listener);
    },
    setWindowOpenHandler: (handler: (details: { url: string; disposition: string }) => { action: "deny" }) => {
      this.openHandler = handler;
    },
    navigationHistory: {
      clear: () => {
        this.historyClearCalls += 1;
      },
    },
    session: {
      setPermissionRequestHandler: (handler: (webContents: unknown, permission: string, callback: (allowed: boolean) => void) => void) => {
        this.permissionHandler = handler;
      },
      setPermissionCheckHandler: (handler: (webContents: unknown, permission: string, requestingOrigin: string) => boolean) => {
        this.permissionCheckHandler = handler;
      },
    },
  };

  once(event: string, listener: (...args: unknown[]) => void): void {
    this.windowListeners.set(event, listener);
  }

  async loadURL(url: string): Promise<void> {
    this.loadedUrls.push(url);
  }

  show(): void { this.showCalls += 1; }
  focus(): void { this.focusCalls += 1; }
  restore(): void { this.restoreCalls += 1; this.minimized = false; }
  isMinimized(): boolean { return this.minimized; }
  isDestroyed(): boolean { return this.destroyed; }
}

function setup(options: { packaged?: boolean; dialogResponse?: number } = {}) {
  const windows: FakeWindow[] = [];
  const browserWindowOptions: BrowserWindowOptionsLike[] = [];
  const appListeners = new Map<string, (...args: unknown[]) => void>();
  const externalUrls: string[] = [];
  const reports: Array<{ phase: string; error: unknown }> = [];
  let quitCalls = 0;
  let now = 1_000;
  const dependencies: ElectronRuntimeDependencies = {
    app: {
      isPackaged: options.packaged ?? true,
      requestSingleInstanceLock: vi.fn(() => true),
      on: (event, listener) => { appListeners.set(event, listener); },
      getVersion: () => "0.3.0-test",
      quit: () => { quitCalls += 1; },
    },
    createBrowserWindow(windowOptions) {
      browserWindowOptions.push(windowOptions);
      const window = new FakeWindow();
      windows.push(window);
      return window;
    },
    shell: {
      openExternal: async (url) => { externalUrls.push(url); },
    },
    dialog: {
      showMessageBox: async () => ({ response: options.dialogResponse ?? 1 }),
    },
    report: (error, phase) => { reports.push({ error, phase }); },
    sessionPartition: "airgap-test-session",
    now: () => now,
  };
  const runtime = createElectronRuntime(dependencies);
  return {
    runtime,
    dependencies,
    windows,
    browserWindowOptions,
    appListeners,
    externalUrls,
    reports,
    advanceTime: (milliseconds: number) => { now += milliseconds; },
    get quitCalls() { return quitCalls; },
  };
}

describe("Electron desktop runtime", () => {
  test("creates one hidden sandboxed Airgap window with the approved dimensions", () => {
    const { runtime, browserWindowOptions } = setup({ packaged: true });
    runtime.createWindow();

    expect(browserWindowOptions).toEqual([{
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
        devTools: false,
        partition: "airgap-test-session",
      },
    }]);
  });

  test("keeps devtools available only in an unpackaged development runtime", () => {
    const { runtime, browserWindowOptions } = setup({ packaged: false });
    runtime.createWindow();
    expect(browserWindowOptions[0]?.webPreferences.devTools).toBe(true);
  });

  test("rejects a persistent Electron session partition", () => {
    const { dependencies } = setup();
    expect(() => createElectronRuntime({
      ...dependencies,
      sessionPartition: "persist:airgap",
    })).toThrow(/non-persistent/);
  });

  test("allows only the active loopback origin and denies every other navigation", () => {
    const { runtime, windows } = setup();
    const window = runtime.createWindow();
    window.setAllowedOrigin("http://127.0.0.1:49152");
    const fake = windows[0]!;
    const navigate = fake.webListeners.get("will-navigate")!;
    const redirect = fake.webListeners.get("will-redirect")!;

    const allowed = new FakeEvent();
    navigate({ ...allowed, preventDefault: allowed.preventDefault.bind(allowed), url: "http://127.0.0.1:49152/api/sessions" });
    expect(allowed.prevented).toBe(false);
    const allowedRedirect = new FakeEvent();
    redirect({
      ...allowedRedirect,
      preventDefault: allowedRedirect.preventDefault.bind(allowedRedirect),
      url: "http://127.0.0.1:49152/",
    });
    expect(allowedRedirect.prevented).toBe(false);

    for (const url of [
      "http://127.0.0.1:49153/",
      "http://localhost:49152/",
      "https://github.com/kylvia/airgap",
      "file:///tmp/leak",
    ]) {
      const blocked = new FakeEvent();
      navigate({ ...blocked, preventDefault: blocked.preventDefault.bind(blocked), url });
      expect(blocked.prevented, url).toBe(true);

      const blockedRedirect = new FakeEvent();
      redirect({
        ...blockedRedirect,
        preventDefault: blockedRedirect.preventDefault.bind(blockedRedirect),
        url,
      });
      expect(blockedRedirect.prevented, `redirect: ${url}`).toBe(true);
    }
  });

  test("opens exact project links only after a short-lived physical gesture", async () => {
    const { runtime, windows, externalUrls, advanceTime } = setup();
    runtime.createWindow();
    const fake = windows[0]!;
    const open = fake.openHandler!;

    expect(open({ url: REPOSITORY_URL, disposition: "foreground-tab" })).toEqual({ action: "deny" });
    expect(externalUrls).toEqual([]);

    fake.webListeners.get("before-mouse-event")!({}, { type: "mouseUp" });
    expect(open({ url: REPOSITORY_URL, disposition: "foreground-tab" })).toEqual({ action: "deny" });
    expect(open({ url: RELEASES_URL, disposition: "background-tab" })).toEqual({ action: "deny" });

    fake.webListeners.get("before-input-event")!({}, { type: "keyDown", key: "Enter", isAutoRepeat: false });
    expect(open({ url: RELEASES_URL, disposition: "background-tab" })).toEqual({ action: "deny" });

    fake.webListeners.get("before-mouse-event")!({}, { type: "mouseUp" });
    advanceTime(1_001);
    expect(open({ url: REPOSITORY_URL, disposition: "foreground-tab" })).toEqual({ action: "deny" });
    expect(open({ url: REPOSITORY_URL, disposition: "default" })).toEqual({ action: "deny" });
    expect(open({ url: `${REPOSITORY_URL}/issues`, disposition: "foreground-tab" })).toEqual({ action: "deny" });
    await vi.waitFor(() => expect(externalUrls).toEqual([REPOSITORY_URL, RELEASES_URL]));
  });

  test("routes only the local startup actions and denies permissions", async () => {
    const { runtime, windows } = setup();
    const window = runtime.createWindow();
    const retry = vi.fn();
    const quit = vi.fn();
    await window.showStartupError({ retry, quit });
    const fake = windows[0]!;
    const navigate = fake.webListeners.get("will-navigate")!;

    const retryEvent = new FakeEvent();
    navigate({ ...retryEvent, preventDefault: retryEvent.preventDefault.bind(retryEvent), url: STARTUP_ERROR_RETRY_URL });
    await window.showStartupError({ retry, quit });
    const quitEvent = new FakeEvent();
    navigate({ ...quitEvent, preventDefault: quitEvent.preventDefault.bind(quitEvent), url: STARTUP_ERROR_QUIT_URL });
    expect(retry).toHaveBeenCalledOnce();
    expect(quit).toHaveBeenCalledOnce();
    expect(fake.loadedUrls[0]).toMatch(/^data:text\/html;charset=utf-8,/);
    expect(fake.historyClearCalls).toBe(2);

    await window.loadURL("http://127.0.0.1:49152/");
    const staleAction = new FakeEvent();
    navigate({ ...staleAction, preventDefault: staleAction.preventDefault.bind(staleAction), url: STARTUP_ERROR_RETRY_URL });
    expect(staleAction.prevented).toBe(true);
    expect(retry).toHaveBeenCalledOnce();

    let permissionAllowed: boolean | undefined;
    fake.permissionHandler!({}, "clipboard-read", (allowed) => { permissionAllowed = allowed; });
    expect(permissionAllowed).toBe(false);
    expect(fake.permissionCheckHandler!({}, "geolocation", "http://127.0.0.1:49152")).toBe(false);
  });

  test("reports main-frame load failures and renderer exits without leaking URLs", () => {
    const { runtime, windows } = setup();
    const window = runtime.createWindow();
    const failures: unknown[] = [];
    window.onRendererFailure((error) => failures.push(error));
    const fake = windows[0]!;

    fake.webListeners.get("did-fail-load")!({}, -3, "aborted", "http://127.0.0.1:1/?access=secret", true);
    fake.webListeners.get("did-fail-load")!({}, -2, "failed", "http://127.0.0.1:1/?access=secret", false);
    fake.webListeners.get("did-fail-load")!({}, -2, "failed", "http://127.0.0.1:1/?access=secret", true);
    fake.webListeners.get("render-process-gone")!({}, { reason: "crashed", exitCode: 9 });

    expect(failures).toHaveLength(2);
    expect(failures.map(String).join(" ")).not.toContain("secret");
  });

  test("maps the native fatal dialog to retry or quit and reports no raw error text", async () => {
    const retrySetup = setup({ dialogResponse: 0 });
    const retry = vi.fn();
    await retrySetup.runtime.showFatalError({ retry, quit: vi.fn() });
    expect(retry).toHaveBeenCalledOnce();

    const quitSetup = setup({ dialogResponse: 1 });
    const quit = vi.fn();
    await quitSetup.runtime.showFatalError({ retry: vi.fn(), quit });
    expect(quit).toHaveBeenCalledOnce();

    quitSetup.runtime.reportError(new Error("?access=secret"), "startup");
    expect(quitSetup.reports).toEqual([{ phase: "startup", error: expect.any(Error) }]);
  });
});
