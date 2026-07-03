import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * PNG rendering with zero npm dependencies: we drive a Chrome the user already
 * has via the DevTools Protocol over Node's global WebSocket (Node >= 22).
 * puppeteer-core would work too, but it is a heavy dep that npx users would not
 * get, and airgap's whole premise is "no install friction". This talks to
 * Chrome directly instead.
 */

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Arc.app/Contents/MacOS/Arc",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/snap/bin/chromium",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];

export function findChrome(): string | null {
  const fromEnv = process.env["CHROME_PATH"];
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  for (const candidate of CHROME_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Read Chrome's stderr until it prints the DevTools browser WebSocket URL. */
function waitForWsUrl(chrome: ReturnType<typeof spawn>, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Chrome 未在预期时间内就绪（DevTools 端点超时）"));
    }, timeoutMs);
    const onData = (chunk: Buffer): void => {
      buf += chunk.toString("utf8");
      const m = /ws:\/\/[^\s]+/.exec(buf);
      if (m) {
        cleanup();
        resolve(m[0]);
      }
    };
    const onExit = (code: number | null): void => {
      cleanup();
      reject(new Error(`Chrome 提前退出（code ${code}），无法出图`));
    };
    function cleanup(): void {
      clearTimeout(timer);
      chrome.stderr?.off("data", onData);
      chrome.off("exit", onExit);
    }
    chrome.stderr?.on("data", onData);
    chrome.on("exit", onExit);
  });
}

interface CdpMessage {
  id?: number;
  method?: string;
  result?: Record<string, unknown>;
  error?: { message: string };
  sessionId?: string;
}

/** Minimal CDP client over one browser WebSocket, flatten-mode sessions. */
class CdpClient {
  private ws: WebSocket;
  private nextId = 0;
  private pending = new Map<number, { resolve: (r: Record<string, unknown>) => void; reject: (e: Error) => void }>();
  private eventWaiters: Array<{ method: string; sessionId?: string; resolve: () => void }> = [];

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener("message", (ev: MessageEvent) => this.onMessage(String(ev.data)));
  }

  static async connect(wsUrl: string): Promise<CdpClient> {
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error("无法连接 Chrome DevTools")), { once: true });
    });
    return new CdpClient(ws);
  }

  private onMessage(data: string): void {
    let msg: CdpMessage;
    try {
      msg = JSON.parse(data) as CdpMessage;
    } catch {
      return;
    }
    if (typeof msg.id === "number") {
      const waiter = this.pending.get(msg.id);
      if (waiter) {
        this.pending.delete(msg.id);
        if (msg.error) waiter.reject(new Error(msg.error.message));
        else waiter.resolve(msg.result ?? {});
      }
      return;
    }
    if (msg.method) {
      for (let i = this.eventWaiters.length - 1; i >= 0; i--) {
        const w = this.eventWaiters[i]!;
        if (w.method === msg.method && (w.sessionId === undefined || w.sessionId === msg.sessionId)) {
          this.eventWaiters.splice(i, 1);
          w.resolve();
        }
      }
    }
  }

  send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<Record<string, unknown>> {
    const id = ++this.nextId;
    const payload: Record<string, unknown> = { id, method, params };
    if (sessionId) payload["sessionId"] = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }

  waitEvent(method: string, sessionId: string | undefined, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`等待 ${method} 超时`)), timeoutMs);
      this.eventWaiters.push({
        method,
        sessionId,
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
      });
    });
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Render an HTML string to a full-height PNG using the system Chrome.
 * deviceScaleFactor 2 for crisp text. Throws with a friendly message on failure.
 */
export async function renderPngViaChrome(html: string, outFile: string, chromePath: string): Promise<void> {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "airgap-png-"));
  const htmlFile = path.join(tmp, "page.html");
  const userDataDir = path.join(tmp, "profile");
  await writeFile(htmlFile, html, "utf8");

  const chrome = spawn(
    chromePath,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      `--user-data-dir=${userDataDir}`,
      "--remote-debugging-port=0",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );

  let client: CdpClient | null = null;
  try {
    const wsUrl = await waitForWsUrl(chrome, 15000);
    client = await CdpClient.connect(wsUrl);

    const target = await client.send("Target.createTarget", { url: "about:blank" });
    const targetId = target["targetId"] as string;
    const attached = await client.send("Target.attachToTarget", { targetId, flatten: true });
    const sessionId = attached["sessionId"] as string;

    await client.send("Page.enable", {}, sessionId);
    const loaded = client.waitEvent("Page.loadEventFired", sessionId, 15000);
    await client.send("Page.navigate", { url: `file://${htmlFile}` }, sessionId);
    await loaded;

    const metrics = await client.send("Page.getLayoutMetrics", {}, sessionId);
    const css = (metrics["cssContentSize"] ?? metrics["contentSize"]) as { width: number; height: number } | undefined;
    const width = Math.max(1, Math.ceil(css?.width ?? 1200));
    const height = Math.max(1, Math.ceil(css?.height ?? 800));

    const shot = await client.send(
      "Page.captureScreenshot",
      { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width, height, scale: 2 } },
      sessionId,
    );
    const data = shot["data"];
    if (typeof data !== "string") throw new Error("Chrome 未返回截图数据");
    await writeFile(outFile, Buffer.from(data, "base64"));
  } finally {
    client?.close();
    chrome.kill();
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}
