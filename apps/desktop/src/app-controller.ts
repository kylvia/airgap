import type { ShareExportAdapter } from "../../../src/server/share-export.js";
import type { ShareServer, ShareServerOptions } from "../../../src/server/share-server.js";

export interface DesktopWindow {
  show(): void;
  focus(): void;
  restore(): void;
  isMinimized(): boolean;
  isDestroyed(): boolean;
  once(event: "ready-to-show" | "closed", listener: () => void): void;
  loadURL(url: string): Promise<void>;
  setAllowedOrigin(origin: string): void;
  clearNavigationHistory(): void;
  showStartupError(actions: { retry(): void; quit(): void }): Promise<void>;
}

export interface DesktopRuntime {
  acquireSingleInstanceLock(): boolean;
  onSecondInstance(listener: () => void): void;
  createWindow(): DesktopWindow;
  getVersion(): string;
  quit(): void;
}

export type StartDesktopShareServer = (options: ShareServerOptions) => Promise<ShareServer>;
export type AppControllerState = "starting" | "ready" | "closing" | "closed";

export interface AppControllerDependencies {
  runtime: DesktopRuntime;
  startShareServer: StartDesktopShareServer;
  createAccessToken(): string;
  exportAdapter: ShareExportAdapter;
}

function eventPromise(window: DesktopWindow, event: "ready-to-show"): Promise<void> {
  return new Promise((resolve) => window.once(event, resolve));
}

function callAsPromise(operation: () => Promise<void>): Promise<void> {
  try {
    return operation();
  } catch (error) {
    return Promise.reject(error);
  }
}

export class AppController {
  static acquire(dependencies: AppControllerDependencies): AppController | null {
    if (!dependencies.runtime.acquireSingleInstanceLock()) {
      dependencies.runtime.quit();
      return null;
    }

    const controller = new AppController(dependencies);
    dependencies.runtime.onSecondInstance(() => controller.focusExistingWindow());
    return controller;
  }

  private stateValue: AppControllerState = "starting";
  private window: DesktopWindow | undefined;
  private server: ShareServer | undefined;
  private startPromise: Promise<void> | undefined;
  private attemptPromise: Promise<void> | undefined;
  private shutdownPromise: Promise<void> | undefined;
  private focusRequested = false;
  private readonly closingSignal: Promise<void>;
  private resolveClosing!: () => void;

  private constructor(private readonly dependencies: AppControllerDependencies) {
    this.closingSignal = new Promise((resolve) => {
      this.resolveClosing = resolve;
    });
  }

  get state(): AppControllerState {
    return this.stateValue;
  }

  start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    if (this.stateValue === "closing" || this.stateValue === "closed") return Promise.resolve();
    this.startPromise = this.runAttempt();
    return this.startPromise;
  }

  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.stateValue = "closing";
    this.resolveClosing();
    this.shutdownPromise = this.performShutdown();
    return this.shutdownPromise;
  }

  private ensureWindow(): DesktopWindow {
    if (this.window && !this.window.isDestroyed()) return this.window;
    const window = this.dependencies.runtime.createWindow();
    this.window = window;
    window.once("closed", () => {
      void this.shutdown();
    });
    if (this.focusRequested) this.focusExistingWindow();
    return window;
  }

  private focusExistingWindow(): void {
    if (this.stateValue === "closing" || this.stateValue === "closed") return;
    const window = this.window;
    if (!window || window.isDestroyed()) {
      this.focusRequested = true;
      return;
    }
    this.focusRequested = false;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }

  private runAttempt(): Promise<void> {
    if (this.attemptPromise) return this.attemptPromise;
    if (this.stateValue !== "starting") return Promise.resolve();

    const attempt = this.performAttempt();
    this.attemptPromise = attempt.finally(() => {
      if (this.attemptPromise === trackedAttempt) this.attemptPromise = undefined;
    });
    const trackedAttempt = this.attemptPromise;
    return trackedAttempt;
  }

  private async performAttempt(): Promise<void> {
    const window = this.ensureWindow();
    try {
      if (!this.server) {
        const server = await this.dependencies.startShareServer({
          surface: "desktop",
          idleTimeoutMs: null,
          accessToken: this.dependencies.createAccessToken(),
          appVersion: this.dependencies.runtime.getVersion(),
          exportAdapter: this.dependencies.exportAdapter,
        });
        this.server = server;
      }
      if (this.stateValue !== "starting") return;

      const server = this.server;
      const ready = eventPromise(window, "ready-to-show");
      window.setAllowedOrigin(new URL(server.url).origin);
      await window.loadURL(server.entryUrl);
      if (this.stateValue !== "starting") return;

      const becameReady = await Promise.race([
        ready.then(() => true),
        this.closingSignal.then(() => false),
      ]);
      if (!becameReady || this.stateValue !== "starting") return;

      window.clearNavigationHistory();
      window.show();
      this.stateValue = "ready";
    } catch {
      if (this.stateValue !== "starting") return;
      await Promise.race([
        window.showStartupError({
          retry: () => {
            void this.retry();
          },
          quit: () => {
            void this.shutdown();
          },
        }),
        this.closingSignal,
      ]);
    }
  }

  private retry(): Promise<void> {
    if (this.stateValue !== "starting") return Promise.resolve();
    return this.runAttempt();
  }

  private async drainServer(server: ShareServer, pendingAttempt?: Promise<void>): Promise<void> {
    const close = callAsPromise(() => server.close());
    const firstIdle = callAsPromise(() => server.whenExportsIdle());
    await Promise.allSettled([
      close,
      firstIdle,
      ...(pendingAttempt ? [pendingAttempt] : []),
    ]);
    await Promise.allSettled([callAsPromise(() => server.whenExportsIdle())]);
  }

  private async performShutdown(): Promise<void> {
    const pendingAttempt = this.attemptPromise;
    let server = this.server;

    if (server) {
      await this.drainServer(server, pendingAttempt);
    } else if (pendingAttempt) {
      await Promise.allSettled([pendingAttempt]);
      server = this.server;
      if (server) await this.drainServer(server);
    }

    this.stateValue = "closed";
    this.dependencies.runtime.quit();
  }
}
