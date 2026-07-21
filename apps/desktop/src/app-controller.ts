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
  reportError(error: unknown, phase: DesktopFailurePhase): void;
  showFatalError(actions: { retry(): void; quit(): void }): Promise<void>;
  quit(): void;
}

export type StartDesktopShareServer = (options: ShareServerOptions) => Promise<ShareServer>;
export type AppControllerState = "starting" | "ready" | "closing" | "closed";
export type DesktopFailurePhase =
  | "startup"
  | "startup-error-surface"
  | "fatal-error-surface"
  | "shutdown-close"
  | "shutdown-first-idle"
  | "shutdown-pending-attempt"
  | "shutdown-final-idle";

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
  private surfaceReady = false;
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
    return window;
  }

  private focusExistingWindow(): void {
    if (this.stateValue === "closing" || this.stateValue === "closed") return;
    const window = this.window;
    if (!window || window.isDestroyed() || !this.surfaceReady) {
      this.focusRequested = true;
      return;
    }
    this.focusRequested = false;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }

  private revealReadySurface(window: DesktopWindow): void {
    const shouldFocus = this.focusRequested;
    if (window.isMinimized()) window.restore();
    window.show();
    if (shouldFocus) window.focus();
    this.surfaceReady = true;
    this.focusRequested = false;
  }

  private errorActions(): { retry(): void; quit(): void } {
    return {
      retry: () => {
        void this.retry().catch((error: unknown) => {
          this.dependencies.runtime.reportError(error, "startup");
        });
      },
      quit: () => {
        void this.shutdown().catch((error: unknown) => {
          this.dependencies.runtime.reportError(error, "shutdown-close");
        });
      },
    };
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
      this.revealReadySurface(window);
      this.stateValue = "ready";
    } catch (error) {
      if (this.stateValue !== "starting") return;
      this.dependencies.runtime.reportError(error, "startup");
      const actions = this.errorActions();
      try {
        await Promise.race([window.showStartupError(actions), this.closingSignal]);
        if (this.stateValue !== "starting") return;
        this.revealReadySurface(window);
      } catch (surfaceError) {
        this.dependencies.runtime.reportError(surfaceError, "startup-error-surface");
        try {
          await Promise.race([
            this.dependencies.runtime.showFatalError(actions),
            this.closingSignal,
          ]);
        } catch (fatalError) {
          this.dependencies.runtime.reportError(fatalError, "fatal-error-surface");
        }
      }
    }
  }

  private retry(): Promise<void> {
    if (this.stateValue !== "starting") return Promise.resolve();
    const currentAttempt = this.attemptPromise;
    if (!currentAttempt) return this.runAttempt();
    return currentAttempt.then(() => {
      if (this.stateValue !== "starting") return;
      return this.runAttempt();
    });
  }

  private reportRejected(
    results: PromiseSettledResult<void>[],
    phases: DesktopFailurePhase[],
  ): void {
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        this.dependencies.runtime.reportError(result.reason, phases[index]!);
      }
    });
  }

  private async drainServer(server: ShareServer, pendingAttempt?: Promise<void>): Promise<void> {
    const close = callAsPromise(() => server.close());
    const firstIdle = callAsPromise(() => server.whenExportsIdle());
    const firstResults = await Promise.allSettled([
      close,
      firstIdle,
      ...(pendingAttempt ? [pendingAttempt] : []),
    ]);
    this.reportRejected(firstResults, [
      "shutdown-close",
      "shutdown-first-idle",
      ...(pendingAttempt ? ["shutdown-pending-attempt" as const] : []),
    ]);
    const finalResults = await Promise.allSettled([
      callAsPromise(() => server.whenExportsIdle()),
    ]);
    this.reportRejected(finalResults, ["shutdown-final-idle"]);
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
