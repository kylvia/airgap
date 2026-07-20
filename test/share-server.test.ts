import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuleMatch, Turn } from "../src/types.js";
import { createShareAccessToken, shareCookieName } from "../src/server/share-access.js";
import { exportBlockReason, startShareServer } from "../src/server/share-server.js";
import { renderPage, serializeForScript } from "../src/server/page.js";

const scan = (s: string): RuleMatch[] =>
  s.includes("sk-ant-LEAK")
    ? [{ ruleId: "anthropic-key", severity: "critical", secret: "sk-ant-LEAK", preview: "sk-a…LEAK" }]
    : [];

const tempHomes: string[] = [];

async function tempHome(config?: string): Promise<string> {
  const home = await mkdtemp(path.join(os.tmpdir(), "airgap-share-language-"));
  tempHomes.push(home);
  if (config !== undefined) {
    await mkdir(path.join(home, ".airgap"), { recursive: true });
    await writeFile(path.join(home, ".airgap", "config.json"), config, "utf8");
  }
  return home;
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(tempHomes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

async function responseHeadForRawRequest(port: number, request: string): Promise<string> {
  const socket = createConnection({ host: "127.0.0.1", port });
  socket.on("error", () => {});
  await once(socket, "connect");
  socket.write(request);

  return new Promise<string>((resolve, reject) => {
    let received = "";
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error("timed out waiting for HTTP response headers"));
    }, 1_000);
    socket.on("data", (chunk: Buffer) => {
      received += chunk.toString("utf8");
      const end = received.indexOf("\r\n\r\n");
      if (end === -1) return;
      clearTimeout(timeout);
      socket.destroy();
      resolve(received.slice(0, end + 4));
    });
    socket.on("close", () => {
      if (!received.includes("\r\n\r\n")) {
        clearTimeout(timeout);
        reject(new Error("connection closed before HTTP response headers"));
      }
    });
  });
}

async function bootstrapCookie(entryUrl: string): Promise<{ response: Response; cookie: string }> {
  const response = await fetch(entryUrl, { redirect: "manual" });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie === null) throw new Error("bootstrap response did not set a cookie");
  return { response, cookie: setCookie.split(";", 1)[0] ?? "" };
}

/** A tool turn whose only secret (if any) sits in the requested slot; summary/user text stay clean. */
function toolTurn(secretIn: "input" | "result" | "none"): Turn {
  return {
    index: 1,
    userText: "run it",
    timestamp: null,
    assistant: [
      {
        kind: "tool",
        text: "Bash: run",
        toolName: "Bash",
        toolInput: secretIn === "input" ? "export K=sk-ant-LEAK" : "run",
        toolResult: secretIn === "result" ? "K=sk-ant-LEAK" : "ok",
      },
    ],
  };
}

describe("exportBlockReason (share server-side export gate)", () => {
  it("blocks a secret hiding in a tool result when acceptRisk is not set", () => {
    expect(exportBlockReason([toolTurn("result")], undefined, scan)).toMatch(/疑似密钥/);
  });

  it("blocks a secret in a tool input too", () => {
    expect(exportBlockReason([toolTurn("input")], false, scan)).not.toBeNull();
  });

  it("allows export when the caller explicitly accepts the risk", () => {
    expect(exportBlockReason([toolTurn("result")], true, scan)).toBeNull();
  });

  it("allows clean content through", () => {
    expect(exportBlockReason([toolTurn("none")], false, scan)).toBeNull();
  });

  it("localizes the server-side risk response", () => {
    expect(exportBlockReason([toolTurn("result")], false, scan, "en")).toMatch(/1 possible secret\b/i);
  });
});

describe("renderPage (share picker shell)", () => {
  const page = renderPage();

  it("loading overlay 锚点在位：切会话/切档时盖住内容区，动画尊重 reduced-motion", () => {
    expect(page).toContain('id="loading"');
    expect(page).toContain("gap-pulse");
    expect(page).toContain("prefers-reduced-motion");
  });

  it("预览 iframe 文档带 <base target=_blank>：点会话内容里的链接开新标签，iframe 不被导航走", () => {
    expect(page).toContain('<base target="_blank">');
  });

  it("关键 DOM/JS 锚点齐全（design.md 清单）", () => {
    for (const id of ["sess", "sbanner", "list", "preview", "status", "count", "all", "none", "done", "tools", "language", "redact", "loading", "limit", "sid", "prefs", "prefpanel"]) {
      expect(page).toContain(`id="${id}"`);
    }
    expect(page).toContain('data-a="clipboard"');
  });

  it("Dossier 铁律：无 backdrop-filter、色值走 token、HTML-UI 零 emoji", () => {
    expect(page).not.toContain("backdrop-filter");
    expect(page).toContain("var(--bg-subtle)");
    expect(page).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });
});

describe("renderPage internationalization", () => {
  it("renders an English picker with matching document and browser locale", () => {
    const page = renderPage(undefined, "summary", true, "en");
    expect(page).toContain('<html lang="en">');
    expect(page).toContain("Share session turns");
    expect(page).toContain('title="Refresh session data"');
    expect(page).toContain(">Copy image</button>");
    expect(page).toContain('const LOCALE = "en";');
    expect(page).not.toContain("分享会话片段");
  });

  it("escapes strings before embedding them in an inline script", () => {
    expect(serializeForScript({ value: "</script><script>alert(1)</script>" })).not.toContain("</script>");
    expect(serializeForScript({ value: "</script>" })).toContain("\\u003c/script>");
  });

  it("renders a localized language preference selector and reload flow", () => {
    const page = renderPage(undefined, "summary", true, "en", "auto");
    expect(page).toContain('id="language"');
    expect(page).toMatch(/<option value="auto" selected>Follow system<\/option>/);
    expect(page).toContain('<option value="zh-CN">Simplified Chinese</option>');
    expect(page).toContain('<option value="en">English</option>');
    expect(page).toContain('JSON.stringify({ language: $("language").value })');
    expect(page).toContain("window.location.reload()");
    expect(page).toContain("select.value = LANGUAGE_PREFERENCE");
    const handler = page.slice(
      page.indexOf('$("language").onchange'),
      page.indexOf('$("done").onclick'),
    );
    expect(handler).toContain('const select = $("language")');
    expect(handler).toContain("select.disabled = true");
    expect(handler).toContain("try {");
    expect(handler).toContain("} catch {");
    expect(handler).toContain("select.value = LANGUAGE_PREFERENCE");
    expect(handler).toContain("select.disabled = false");
  });

  it("selects the current explicit Chinese preference", () => {
    const page = renderPage(undefined, "summary", true, "zh-CN", "zh-CN");
    expect(page).toContain('<option value="zh-CN" selected>简体中文</option>');
    expect(page).toContain('<option value="auto">跟随系统</option>');
    expect(page).toContain('<option value="en">英文</option>');
  });
});

describe("Share server locale wiring", () => {
  it("serves the resolved locale and stable localized API errors", async () => {
    const server = await startShareServer({ locale: "en" });
    try {
      expect(new URL(server.url).hostname).toBe("127.0.0.1");
      const page = await fetch(server.url).then((response) => response.text());
      expect(page).toContain('<html lang="en">');
      expect(page).toContain("Share session turns");

      const response = await fetch(new URL("/missing", server.url));
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ code: "NOT_FOUND", message: "Not found" });
    } finally {
      await server.close();
    }
  });

  it("persists explicit language, switches live responses, then follows the injected system locale", async () => {
    const home = await tempHome();
    let detectorCalls = 0;
    const server = await startShareServer({
      locale: "en",
      languagePreference: "en",
      configHome: home,
      systemLocaleDetector: async () => {
        detectorCalls += 1;
        return { locale: "en-US", source: "test system" };
      },
    });
    try {
      const explicit = await fetch(new URL("/api/config", server.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ language: "zh-CN" }),
      });
      expect(explicit.status).toBe(200);
      await expect(explicit.json()).resolves.toMatchObject({
        ok: true,
        language: "zh-CN",
        locale: "zh-CN",
      });
      expect(await readFile(path.join(home, ".airgap", "config.json"), "utf8")).toContain(
        '"language": "zh-CN"',
      );
      const chinesePage = await fetch(server.url).then((response) => response.text());
      expect(chinesePage).toContain('<html lang="zh-CN">');
      expect(chinesePage).toContain('<option value="zh-CN" selected>简体中文</option>');
      await expect(fetch(new URL("/missing", server.url)).then((response) => response.json())).resolves.toEqual({
        code: "NOT_FOUND",
        message: "未找到",
      });

      const automatic = await fetch(new URL("/api/config", server.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ language: "auto" }),
      });
      await expect(automatic.json()).resolves.toMatchObject({
        ok: true,
        language: "auto",
        locale: "en",
      });
      expect(detectorCalls).toBe(1);
      const persisted = JSON.parse(
        await readFile(path.join(home, ".airgap", "config.json"), "utf8"),
      ) as Record<string, unknown>;
      expect(persisted).not.toHaveProperty("language");
      const englishPage = await fetch(server.url).then((response) => response.text());
      expect(englishPage).toContain('<html lang="en">');
      expect(englishPage).toContain('<option value="auto" selected>Follow system</option>');
    } finally {
      await server.close();
    }
  });

  it("rejects unsupported language values without changing the live locale", async () => {
    const server = await startShareServer({ locale: "en", configHome: await tempHome() });
    try {
      const response = await fetch(new URL("/api/config", server.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ language: "fr" }),
      });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ code: "INVALID_LANGUAGE" });
      expect(await fetch(server.url).then((result) => result.text())).toContain('<html lang="en">');
    } finally {
      await server.close();
    }
  });

  it("rejects a null config request body as a stable client error", async () => {
    const server = await startShareServer({ locale: "en", configHome: await tempHome() });
    try {
      const response = await fetch(new URL("/api/config", server.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "null",
      });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ code: "INVALID_CONFIG_BODY" });
    } finally {
      await server.close();
    }
  });

  it("keeps the live locale unchanged when language persistence fails", async () => {
    const home = await tempHome("{ broken");
    const server = await startShareServer({ locale: "en", languagePreference: "en", configHome: home });
    try {
      const response = await fetch(new URL("/api/config", server.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ language: "zh-CN" }),
      });
      expect(response.status).toBe(500);
      expect(await readFile(path.join(home, ".airgap", "config.json"), "utf8")).toBe("{ broken");
      expect(await fetch(server.url).then((result) => result.text())).toContain('<html lang="en">');
      await expect(fetch(new URL("/missing", server.url)).then((result) => result.json())).resolves.toEqual({
        code: "NOT_FOUND",
        message: "Not found",
      });
    } finally {
      await server.close();
    }
  });
});

describe("Share server desktop loopback access", () => {
  it.each(["", "short", "a".repeat(42), "a".repeat(44), "_".repeat(43)])(
    "rejects an invalid configured capability before listening: %s",
    async (accessToken) => {
      await expect(startShareServer({ accessToken, idleTimeoutMs: null })).rejects.toThrow(/accessToken/);
    },
  );

  it("keeps the CLI surface unauthenticated when no capability is configured", async () => {
    const server = await startShareServer({ idleTimeoutMs: null });
    try {
      expect((await fetch(server.url)).status).toBe(200);
      expect((await fetch(new URL("/missing", server.url))).status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it("bootstraps an isolated HttpOnly cookie without leaking the token into url or HTML", async () => {
    const accessToken = createShareAccessToken();
    const server = await startShareServer({ accessToken, idleTimeoutMs: null });
    try {
      const port = Number(new URL(server.url).port);
      expect(server.url).toBe(`http://127.0.0.1:${port}/`);
      expect(server.url).not.toContain(accessToken);
      expect(server.entryUrl).toBe(`${server.url}?access=${accessToken}`);

      const { response, cookie } = await bootstrapCookie(server.entryUrl);
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(response.headers.get("set-cookie")).toBe(
        `${shareCookieName(port)}=${accessToken}; HttpOnly; SameSite=Strict; Path=/`,
      );

      const pageResponse = await fetch(server.url, { headers: { cookie } });
      expect(pageResponse.status).toBe(200);
      const html = await pageResponse.text();
      expect(html).not.toContain(accessToken);

      const nonCookieResponseData = [
        String(response.status),
        response.headers.get("location") ?? "",
        response.headers.get("cache-control") ?? "",
        response.headers.get("referrer-policy") ?? "",
        await response.text(),
        html,
      ].join("\n");
      expect(nonCookieResponseData).not.toContain(accessToken);
    } finally {
      await server.close();
    }
  });

  it("allows the process-local bootstrap capability to be replayed until shutdown", async () => {
    const server = await startShareServer({ accessToken: createShareAccessToken(), idleTimeoutMs: null });
    try {
      expect((await fetch(server.entryUrl, { redirect: "manual" })).status).toBe(303);
      expect((await fetch(server.entryUrl, { redirect: "manual" })).status).toBe(303);
    } finally {
      await server.close();
    }
  });

  it("marks every authenticated HTML, API, not-found, and error response no-store", async () => {
    const accessToken = createShareAccessToken();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const home = await tempHome();
    const previousHome = process.env["HOME"];
    process.env["HOME"] = home;
    const server = await startShareServer({
      accessToken,
      idleTimeoutMs: null,
      configHome: home,
    });
    try {
      const { cookie } = await bootstrapCookie(server.entryUrl);
      const origin = server.url.slice(0, -1);
      const requests = [
        await fetch(server.url, { headers: { cookie } }),
        await fetch(new URL("/api/sessions", server.url), { headers: { cookie } }),
        await fetch(new URL("/api/session/definitely-not-a-real-session", server.url), {
          headers: { cookie },
        }),
        await fetch(new URL("/missing", server.url), { headers: { cookie } }),
        await fetch(new URL("/api/config", server.url), {
          method: "POST",
          headers: { cookie, origin, "content-type": "application/json" },
          body: JSON.stringify({ sessionListLimit: 10 }),
        }),
        await fetch(new URL("/api/export", server.url), {
          method: "POST",
          headers: { cookie, origin, "content-type": "application/json" },
          body: "{",
        }),
      ];

      expect(requests.map((response) => response.status)).toEqual([200, 200, 404, 404, 200, 500]);
      for (const response of requests) {
        expect(response.headers.get("cache-control"), String(response.status)).toBe("no-store");
      }
    } finally {
      await server.close();
      if (previousHome === undefined) delete process.env["HOME"];
      else process.env["HOME"] = previousHome;
      error.mockRestore();
    }
  });

  it("rejects absolute, network-path, backslash, and fragmented request targets before bootstrap", async () => {
    const accessToken = createShareAccessToken();
    const server = await startShareServer({ accessToken, idleTimeoutMs: null });
    try {
      const port = Number(new URL(server.url).port);
      const targets = [
        `//evil.example/?access=${accessToken}`,
        `//127.0.0.1:${port}/?access=${accessToken}`,
        `/\\evil.example/?access=${accessToken}`,
        `http://127.0.0.1:${port}/?access=${accessToken}`,
        `/?access=${accessToken}#fragment`,
      ];

      for (const target of targets) {
        const response = await responseHeadForRawRequest(
          port,
          `GET ${target} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`,
        );
        expect(response, target).toMatch(/^HTTP\/1\.1 400 /);
        expect(response, target).not.toMatch(/^set-cookie:/im);
      }
    } finally {
      await server.close();
    }
  });

  it("refreshes the finite idle timeout after a successful bootstrap", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const server = await startShareServer({ accessToken: createShareAccessToken(), idleTimeoutMs: 100 });
    try {
      await vi.advanceTimersByTimeAsync(60);
      expect((await fetch(server.entryUrl, { redirect: "manual" })).status).toBe(303);

      await vi.advanceTimersByTimeAsync(40);
      expect(server.isClosed()).toBe(false);
      await vi.advanceTimersByTimeAsync(60);
      await expect(server.closed).resolves.toBeUndefined();
    } finally {
      await server.close();
    }
  });

  it("fails closed for every route before cookie authentication", async () => {
    const server = await startShareServer({ accessToken: createShareAccessToken(), idleTimeoutMs: null });
    try {
      for (const pathname of ["/", "/favicon.ico", "/missing", "/api/sessions"]) {
        const response = await fetch(new URL(pathname, server.url));
        expect(response.status, pathname).toBe(401);
        await expect(response.json()).resolves.toMatchObject({ code: "UNAUTHORIZED" });
      }
    } finally {
      await server.close();
    }
  });

  it("rejects malformed bootstrap queries even when a valid cookie is present", async () => {
    const accessToken = createShareAccessToken();
    const server = await startShareServer({ accessToken, idleTimeoutMs: null });
    try {
      const { cookie } = await bootstrapCookie(server.entryUrl);
      const malformed = [
        `/?access=${accessToken}&access=${accessToken}`,
        `/?access=${accessToken}&extra=1`,
        "/?other=1",
        `/?access=${createShareAccessToken()}`,
        `/api/sessions?access=${accessToken}`,
      ];
      for (const target of malformed) {
        const response = await fetch(new URL(target, server.url), { headers: { cookie } });
        expect(response.status, target).toBe(401);
      }

      expect((await fetch(server.url, { headers: { cookie } })).status).toBe(200);
    } finally {
      await server.close();
    }
  });

  it("rejects duplicate or URL-encoded capability cookies", async () => {
    const accessToken = createShareAccessToken();
    const server = await startShareServer({ accessToken, idleTimeoutMs: null });
    try {
      const name = shareCookieName(Number(new URL(server.url).port));
      const duplicate = `${name}=${accessToken}; ${name}=${accessToken}`;
      expect((await fetch(server.url, { headers: { cookie: duplicate } })).status).toBe(401);

      const encoded = `${name}=${accessToken.replace(/[A-Za-z]/, (character) =>
        `%${character.charCodeAt(0).toString(16)}`,
      )}`;
      expect((await fetch(server.url, { headers: { cookie: encoded } })).status).toBe(401);
    } finally {
      await server.close();
    }
  });

  it("requires the exact loopback Host before bootstrap or cookie checks", async () => {
    const accessToken = createShareAccessToken();
    const server = await startShareServer({ accessToken, idleTimeoutMs: null });
    try {
      const port = Number(new URL(server.url).port);
      const response = await responseHeadForRawRequest(
        port,
        `GET /?access=${accessToken} HTTP/1.1\r\nHost: localhost:${port}\r\nConnection: close\r\n\r\n`,
      );
      expect(response).toMatch(/^HTTP\/1\.1 400 /);
      expect(response).not.toContain(accessToken);
    } finally {
      await server.close();
    }
  });

  it("checks cookie before POST Origin and accepts only the exact loopback Origin", async () => {
    const accessToken = createShareAccessToken();
    const server = await startShareServer({
      accessToken,
      idleTimeoutMs: null,
      configHome: await tempHome(),
    });
    try {
      const { cookie } = await bootstrapCookie(server.entryUrl);
      const endpoint = new URL("/api/config", server.url);
      const body = JSON.stringify({ sessionListLimit: 10 });

      const noCookieWrongOrigin = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://evil.example" },
        body,
      });
      expect(noCookieWrongOrigin.status).toBe(401);

      for (const origin of [undefined, "https://evil.example", server.url, "http://localhost:1"]) {
        const headers: Record<string, string> = { cookie, "content-type": "application/json" };
        if (origin !== undefined) headers.origin = origin;
        const response = await fetch(endpoint, { method: "POST", headers, body: "{" });
        expect(response.status, String(origin)).toBe(403);
      }

      const expectedOrigin = server.url.slice(0, -1);
      const allowed = await fetch(endpoint, {
        method: "POST",
        headers: { cookie, "content-type": "application/json", origin: expectedOrigin },
        body,
      });
      expect(allowed.status).toBe(200);
    } finally {
      await server.close();
    }
  });

  it("returns 401 without reading a declared huge POST body", async () => {
    const server = await startShareServer({ accessToken: createShareAccessToken(), idleTimeoutMs: null });
    try {
      const port = Number(new URL(server.url).port);
      const response = await responseHeadForRawRequest(
        port,
        "POST /api/export HTTP/1.1\r\n" +
          `Host: 127.0.0.1:${port}\r\n` +
          `Origin: http://127.0.0.1:${port}\r\n` +
          "Content-Type: application/json\r\n" +
          "Content-Length: 999999999\r\n" +
          "Connection: close\r\n\r\n",
      );
      expect(response).toMatch(/^HTTP\/1\.1 401 /);
    } finally {
      await server.close();
    }
  });

  it("does not refresh idle time for an unauthenticated request", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const server = await startShareServer({ accessToken: createShareAccessToken(), idleTimeoutMs: 100 });
    try {
      await vi.advanceTimersByTimeAsync(60);
      expect((await fetch(server.url)).status).toBe(401);
      await vi.advanceTimersByTimeAsync(40);
      await expect(server.closed).resolves.toBeUndefined();
    } finally {
      await server.close();
    }
  });

  it("does not write the configured capability into server errors", async () => {
    const accessToken = createShareAccessToken();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const server = await startShareServer({ accessToken, idleTimeoutMs: null });
    try {
      const { cookie } = await bootstrapCookie(server.entryUrl);
      const response = await fetch(new URL("/api/export", server.url), {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/json",
          origin: server.url.slice(0, -1),
        },
        body: "{",
      });
      expect(response.status).toBe(500);
      expect(await response.text()).not.toContain(accessToken);
      expect(error.mock.calls.flat().join("\n")).not.toContain(accessToken);
    } finally {
      await server.close();
      error.mockRestore();
    }
  });
});

describe("Share server lifecycle", () => {
  it("closes after the configured idle timeout", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const server = await startShareServer({ idleTimeoutMs: 20 });
    await vi.advanceTimersByTimeAsync(19);
    expect(server.isClosed()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(server.closed).resolves.toBeUndefined();
    expect(server.isClosed()).toBe(true);
  });

  it("stays open when the caller disables idle shutdown", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const server = await startShareServer({ idleTimeoutMs: null });
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(server.isClosed()).toBe(false);
    await server.close();
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648, Number.MAX_SAFE_INTEGER])(
    "rejects invalid idle timeout %s",
    async (idleTimeoutMs) => {
      await expect(startShareServer({ idleTimeoutMs })).rejects.toThrow(/idleTimeoutMs/);
    },
  );

  it("resets the configured idle timeout after a request", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const server = await startShareServer({ idleTimeoutMs: 100 });
    try {
      await vi.advanceTimersByTimeAsync(60);
      const response = await fetch(server.url);
      expect(response.status).toBe(200);
      await response.text();

      await vi.advanceTimersByTimeAsync(60);
      expect(server.isClosed()).toBe(false);
      await vi.advanceTimersByTimeAsync(40);
      await expect(server.closed).resolves.toBeUndefined();
    } finally {
      await server.close();
    }
  });

  it("marks closing immediately and returns one close promise", async () => {
    const server = await startShareServer({ idleTimeoutMs: null });
    const firstClose = server.close();

    expect(server.isClosed()).toBe(true);
    expect(server.close()).toBe(firstClose);
    await firstClose;
  });

  it("allows concurrent close calls and releases the listener before resolving", async () => {
    const server = await startShareServer({ idleTimeoutMs: null });
    const port = Number(new URL(server.url).port);

    await Promise.all([server.close(), server.close()]);
    await expect(server.closed).resolves.toBeUndefined();

    const rebound = await startShareServer({ port, idleTimeoutMs: null });
    try {
      expect(Number(new URL(rebound.url).port)).toBe(port);
    } finally {
      await rebound.close();
    }
  });

  it("keeps entryUrl equal to url before access control is enabled", async () => {
    const server = await startShareServer({ idleTimeoutMs: null });
    try {
      expect(server.entryUrl).toBe(server.url);
    } finally {
      await server.close();
    }
  });

  it("flushes the close response before shutting down", async () => {
    const server = await startShareServer({ idleTimeoutMs: null });
    const response = await fetch(new URL("/api/close", server.url), { method: "POST" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    await expect(server.closed).resolves.toBeUndefined();
  });

  it("force-closes a hanging request after the bounded drain period", async () => {
    const home = await tempHome();
    let markRequestEntered!: () => void;
    const requestEntered = new Promise<void>((resolve) => {
      markRequestEntered = resolve;
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const server = await startShareServer({
      idleTimeoutMs: null,
      configHome: home,
      systemLocaleDetector: async () => {
        markRequestEntered();
        return new Promise<never>(() => {});
      },
    });
    const socket = createConnection({ host: "127.0.0.1", port: Number(new URL(server.url).port) });
    socket.on("error", () => {});
    try {
      await once(socket, "connect");
      const body = JSON.stringify({ language: "auto" });
      socket.write(
        "POST /api/config HTTP/1.1\r\n" +
          "Host: 127.0.0.1\r\n" +
          "Content-Type: application/json\r\n" +
          `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n` +
          body,
      );
      await requestEntered;

      const closing = server.close();
      expect(server.isClosed()).toBe(true);
      let settled = false;
      void server.closed.then(() => {
        settled = true;
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(5_000);
      await closing;
      expect(socket.destroyed).toBe(true);
    } finally {
      socket.destroy();
      await server.close();
    }
  });
});

describe("renderPage 平台适配：复制到剪贴板只有 macOS 支持", () => {
  it("mac 上「复制长图」是主按钮，且不带 mac-only 提示", () => {
    const page = renderPage(undefined, "summary", true);
    expect(page).toMatch(/<button class="primary" data-a="clipboard" data-f="png"[^>]*>复制长图<\/button>/);
    expect(page).toContain('<button data-a="download" data-f="png">下载 PNG</button>');
    expect(page).toContain("点「复制长图」→ Cmd-V 粘贴");
  });

  it("非 mac 上「下载 PNG」变主按钮，剪贴板按钮降级并带 mac-only 提示，引导文案不再提 Cmd-V", () => {
    const page = renderPage(undefined, "summary", false);
    expect(page).toContain('<button class="primary" data-a="download" data-f="png">下载 PNG</button>');
    expect(page).toMatch(/<button data-a="clipboard" data-f="png" title="[^"]*macOS[^"]*"[^>]*>复制长图<\/button>/);
    expect(page).toMatch(/<button data-a="clipboard" data-f="md" title="[^"]*macOS[^"]*"[^>]*>复制 Markdown<\/button>/);
    expect(page).not.toContain("Cmd-V");
    expect(page).toContain("点「下载 PNG」保存图片");
  });
});
