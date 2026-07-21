import { describe, expect, test, vi } from "vitest";
import {
  AppController,
  type DesktopRuntime,
  type DesktopWindow,
  type StartDesktopShareServer,
} from "../src/app-controller.js";
import {
  STARTUP_ERROR_QUIT_URL,
  STARTUP_ERROR_RETRY_URL,
  renderStartupErrorDocument,
} from "../src/startup-error.js";
import type { ShareExportAdapter } from "../../../src/server/share-export.js";
import type { ShareServer, ShareServerOptions } from "../../../src/server/share-server.js";

type WindowEvent = "ready-to-show" | "closed";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class FakeWindow implements DesktopWindow {
  readonly events = new Map<WindowEvent, Array<() => void>>();
  readonly loadedUrls: string[] = [];
  errorActions: { retry(): void; quit(): void } | undefined;
  loadFailures = 0;
  autoReady = true;
  minimized = false;
  destroyed = false;

  constructor(private readonly log: string[]) {}

  show(): void {
    this.log.push("window.show");
  }

  focus(): void {
    this.log.push("window.focus");
  }

  restore(): void {
    this.log.push("window.restore");
    this.minimized = false;
  }

  isMinimized(): boolean {
    return this.minimized;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  once(event: WindowEvent, listener: () => void): void {
    const listeners = this.events.get(event) ?? [];
    listeners.push(listener);
    this.events.set(event, listeners);
  }

  emit(event: WindowEvent): void {
    const listeners = this.events.get(event) ?? [];
    this.events.delete(event);
    if (event === "closed") {
      this.destroyed = true;
      this.log.push("window.closed");
    } else {
      this.log.push("window.ready");
    }
    for (const listener of listeners) listener();
  }

  async loadURL(url: string): Promise<void> {
    this.loadedUrls.push(url);
    this.log.push(`window.load:${url}`);
    if (this.loadFailures > 0) {
      this.loadFailures -= 1;
      throw new Error("renderer load failed");
    }
    if (this.autoReady) queueMicrotask(() => this.emit("ready-to-show"));
  }

  setAllowedOrigin(origin: string): void {
    this.log.push(`window.origin:${origin}`);
  }

  clearNavigationHistory(): void {
    this.log.push("window.clear-history");
  }

  async showStartupError(actions: { retry(): void; quit(): void }): Promise<void> {
    this.errorActions = actions;
    this.log.push("window.startup-error");
  }
}

class FakeRuntime implements DesktopRuntime {
  lockAvailable = true;
  quitCalls = 0;
  createWindowCalls = 0;
  secondInstanceListener: (() => void) | undefined;
  readonly window: FakeWindow;

  constructor(readonly log: string[] = []) {
    this.window = new FakeWindow(log);
  }

  acquireSingleInstanceLock(): boolean {
    this.log.push("runtime.acquire-lock");
    return this.lockAvailable;
  }

  onSecondInstance(listener: () => void): void {
    this.log.push("runtime.on-second-instance");
    this.secondInstanceListener = listener;
  }

  createWindow(): DesktopWindow {
    this.createWindowCalls += 1;
    this.log.push("runtime.create-window");
    return this.window;
  }

  getVersion(): string {
    return "0.3.0-test";
  }

  quit(): void {
    this.quitCalls += 1;
    this.log.push("runtime.quit");
  }
}

function fakeServer(log: string[] = [], closeError?: Error): ShareServer {
  let idleCalls = 0;
  return {
    url: "http://127.0.0.1:49152/",
    entryUrl: "http://127.0.0.1:49152/?access=secret-bootstrap",
    closed: Promise.resolve(),
    isClosed: () => false,
    async close() {
      log.push("server.close");
      if (closeError) throw closeError;
    },
    async whenExportsIdle() {
      idleCalls += 1;
      log.push(`server.idle:${idleCalls}`);
    },
  };
}

function setup(options: {
  runtime?: FakeRuntime;
  startServer?: StartDesktopShareServer;
  exportAdapter?: ShareExportAdapter;
} = {}) {
  const runtime = options.runtime ?? new FakeRuntime();
  const exportAdapter = options.exportAdapter ?? {
    renderPng: vi.fn(async () => Buffer.from("png")),
    saveFile: vi.fn(async () => null),
  };
  const server = fakeServer(runtime.log);
  const calls: ShareServerOptions[] = [];
  const startServer = options.startServer ?? (async (serverOptions) => {
    calls.push(serverOptions);
    runtime.log.push("server.start");
    return server;
  });
  const controller = AppController.acquire({
    runtime,
    startShareServer: startServer,
    createAccessToken: () => "A".repeat(43),
    exportAdapter,
  });
  return { runtime, exportAdapter, server, calls, controller };
}

describe("AppController", () => {
  test("failed single-instance acquisition quits without creating a window or service", async () => {
    const runtime = new FakeRuntime();
    runtime.lockAvailable = false;
    const startServer = vi.fn<StartDesktopShareServer>();

    const controller = AppController.acquire({
      runtime,
      startShareServer: startServer,
      createAccessToken: () => "A".repeat(43),
      exportAdapter: { renderPng: vi.fn(), saveFile: vi.fn() },
    });

    expect(controller).toBeNull();
    expect(runtime.quitCalls).toBe(1);
    expect(runtime.createWindowCalls).toBe(0);
    expect(startServer).not.toHaveBeenCalled();
    expect(runtime.secondInstanceListener).toBeUndefined();
  });

  test("first launch owns exactly one service and window and shows only after bootstrap is ready", async () => {
    const { controller, runtime, calls, exportAdapter } = setup();
    expect(controller).not.toBeNull();

    const first = controller!.start();
    const second = controller!.start();

    expect(second).toBe(first);
    await first;
    expect(runtime.createWindowCalls).toBe(1);
    expect(calls).toEqual([{
      surface: "desktop",
      idleTimeoutMs: null,
      accessToken: "A".repeat(43),
      appVersion: "0.3.0-test",
      exportAdapter,
    }]);
    expect(runtime.window.loadedUrls).toEqual(["http://127.0.0.1:49152/?access=secret-bootstrap"]);
    expect(runtime.log).toEqual([
      "runtime.acquire-lock",
      "runtime.on-second-instance",
      "runtime.create-window",
      "server.start",
      "window.origin:http://127.0.0.1:49152",
      "window.load:http://127.0.0.1:49152/?access=secret-bootstrap",
      "window.ready",
      "window.clear-history",
      "window.show",
    ]);
    expect(controller!.state).toBe("ready");
  });

  test("second instance reveals and focuses a hidden or minimized existing window", async () => {
    const runtime = new FakeRuntime();
    runtime.window.autoReady = false;
    const { controller } = setup({ runtime });

    const starting = controller!.start();
    await vi.waitFor(() => expect(runtime.window.loadedUrls).toHaveLength(1));
    runtime.secondInstanceListener!();
    expect(runtime.log.slice(-2)).toEqual(["window.show", "window.focus"]);

    runtime.window.emit("ready-to-show");
    await starting;
    runtime.window.minimized = true;
    runtime.secondInstanceListener!();
    expect(runtime.log.slice(-3)).toEqual(["window.restore", "window.show", "window.focus"]);
    expect(runtime.createWindowCalls).toBe(1);
  });

  test("second instance before app readiness focuses the first window once it exists", async () => {
    const runtime = new FakeRuntime();
    runtime.window.autoReady = false;
    const { controller } = setup({ runtime });

    runtime.secondInstanceListener!();
    const starting = controller!.start();
    await vi.waitFor(() => expect(runtime.window.loadedUrls).toHaveLength(1));

    expect(runtime.log).toContain("window.show");
    expect(runtime.log).toContain("window.focus");
    expect(runtime.createWindowCalls).toBe(1);
    runtime.window.emit("ready-to-show");
    await starting;
  });

  test("service startup failure exposes retry and quit actions", async () => {
    const runtime = new FakeRuntime();
    const server = fakeServer(runtime.log);
    const startServer = vi.fn<StartDesktopShareServer>()
      .mockRejectedValueOnce(new Error("port unavailable"))
      .mockResolvedValueOnce(server);
    const { controller } = setup({ runtime, startServer });

    await controller!.start();
    expect(controller!.state).toBe("starting");
    expect(runtime.window.errorActions).toBeDefined();
    expect(startServer).toHaveBeenCalledTimes(1);

    runtime.window.errorActions!.retry();
    await vi.waitFor(() => expect(controller!.state).toBe("ready"));
    expect(startServer).toHaveBeenCalledTimes(2);
    expect(runtime.createWindowCalls).toBe(1);

    runtime.window.errorActions!.quit();
    await vi.waitFor(() => expect(controller!.state).toBe("closed"));
    expect(runtime.quitCalls).toBe(1);
  });

  test("retry reuses a healthy server after page load fails", async () => {
    const runtime = new FakeRuntime();
    runtime.window.loadFailures = 1;
    const startServer = vi.fn<StartDesktopShareServer>(async () => fakeServer(runtime.log));
    const { controller } = setup({ runtime, startServer });

    await controller!.start();
    expect(runtime.window.errorActions).toBeDefined();
    expect(startServer).toHaveBeenCalledTimes(1);

    runtime.window.errorActions!.retry();
    await vi.waitFor(() => expect(controller!.state).toBe("ready"));
    expect(startServer).toHaveBeenCalledTimes(1);
    expect(runtime.window.loadedUrls).toHaveLength(2);
    expect(runtime.log.slice(-2)).toEqual(["window.clear-history", "window.show"]);
  });

  test("window close releases service through both idle barriers before quitting even if close rejects", async () => {
    const log: string[] = [];
    const runtime = new FakeRuntime(log);
    const server = fakeServer(log, new Error("close failed"));
    const { controller } = setup({ runtime, startServer: async () => server });
    await controller!.start();

    log.length = 0;
    runtime.window.emit("closed");
    const shutdown = controller!.shutdown();
    expect(controller!.shutdown()).toBe(shutdown);
    await shutdown;

    expect(log).toEqual([
      "window.closed",
      "server.close",
      "server.idle:1",
      "server.idle:2",
      "runtime.quit",
    ]);
    expect(runtime.quitCalls).toBe(1);
    expect(controller!.state).toBe("closed");
  });

  test("simultaneous load retry and close never resurrects the window or duplicates the service", async () => {
    const runtime = new FakeRuntime();
    runtime.window.loadFailures = 1;
    const secondLoad = deferred<void>();
    const originalLoad = runtime.window.loadURL.bind(runtime.window);
    let loadCalls = 0;
    runtime.window.loadURL = async (url) => {
      loadCalls += 1;
      if (loadCalls === 2) {
        runtime.window.loadedUrls.push(url);
        runtime.log.push(`window.load:${url}`);
        await secondLoad.promise;
        return;
      }
      await originalLoad(url);
    };
    const startServer = vi.fn<StartDesktopShareServer>(async () => fakeServer(runtime.log));
    const { controller } = setup({ runtime, startServer });
    await controller!.start();

    runtime.window.errorActions!.retry();
    await vi.waitFor(() => expect(loadCalls).toBe(2));
    const shutdown = controller!.shutdown();
    secondLoad.resolve();
    await shutdown;

    expect(controller!.state).toBe("closed");
    expect(startServer).toHaveBeenCalledTimes(1);
    expect(runtime.createWindowCalls).toBe(1);
    expect(runtime.log.filter((entry) => entry === "window.clear-history")).toHaveLength(0);
    expect(runtime.log.filter((entry) => entry === "runtime.quit")).toHaveLength(1);
  });

  test("close during pending service startup closes the late service before quitting", async () => {
    const runtime = new FakeRuntime();
    const pendingServer = deferred<ShareServer>();
    const server = fakeServer(runtime.log);
    const startServer = vi.fn<StartDesktopShareServer>(() => pendingServer.promise);
    const { controller } = setup({ runtime, startServer });

    const starting = controller!.start();
    await vi.waitFor(() => expect(startServer).toHaveBeenCalledTimes(1));
    const shutdown = controller!.shutdown();
    pendingServer.resolve(server);
    await Promise.all([starting, shutdown]);

    expect(runtime.window.loadedUrls).toHaveLength(0);
    expect(runtime.log).toContain("server.close");
    expect(runtime.log.slice(-1)).toEqual(["runtime.quit"]);
    expect(controller!.state).toBe("closed");
  });
});

describe("startup error document", () => {
  test("is a self-contained local document with retry and quit actions", () => {
    const document = renderStartupErrorDocument();

    expect(document).toContain("Airgap 暂时无法启动");
    expect(document).toContain(`href=\"${STARTUP_ERROR_RETRY_URL}\"`);
    expect(document).toContain(`href=\"${STARTUP_ERROR_QUIT_URL}\"`);
    expect(document).toContain("default-src 'none'");
    expect(document).toContain("var(--bg-subtle)");
    expect(document).not.toMatch(/https?:\/\//);
  });
});
