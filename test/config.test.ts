import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_SESSION_LIST_LIMIT, loadConfig, sessionListLimit } from "../src/config.js";

let tmpHome: string | null = null;

async function homeWith(config: string | null): Promise<string> {
  tmpHome = await mkdtemp(path.join(os.tmpdir(), "airgap-config-"));
  if (config !== null) {
    await mkdir(path.join(tmpHome, ".airgap"), { recursive: true });
    await writeFile(path.join(tmpHome, ".airgap", "config.json"), config, "utf8");
  }
  return tmpHome;
}

afterEach(async () => {
  if (tmpHome) await rm(tmpHome, { recursive: true, force: true });
  tmpHome = null;
});

describe("loadConfig (~/.airgap/config.json)", () => {
  it("文件缺失 → 空配置 + 默认条数", async () => {
    const cfg = await loadConfig(await homeWith(null));
    expect(cfg).toEqual({});
    expect(sessionListLimit(cfg)).toBe(DEFAULT_SESSION_LIST_LIMIT);
  });

  it("JSON 损坏 → 静默回退空配置，绝不抛", async () => {
    const cfg = await loadConfig(await homeWith("{ not json"));
    expect(cfg).toEqual({});
  });

  it("合法 share.sessionListLimit 生效（10/20/50 常用档）", async () => {
    const cfg = await loadConfig(await homeWith('{"share":{"sessionListLimit":20}}'));
    expect(sessionListLimit(cfg)).toBe(20);
  });

  it("非法类型回退默认；越界整数 clamp 到 [1,200]", async () => {
    expect(sessionListLimit(await loadConfig(await homeWith('{"share":{"sessionListLimit":"20"}}')))).toBe(
      DEFAULT_SESSION_LIST_LIMIT,
    );
    expect(sessionListLimit(await loadConfig(await homeWith('{"share":{"sessionListLimit":10.5}}')))).toBe(
      DEFAULT_SESSION_LIST_LIMIT,
    );
    expect(sessionListLimit(await loadConfig(await homeWith('{"share":{"sessionListLimit":500}}')))).toBe(200);
    expect(sessionListLimit(await loadConfig(await homeWith('{"share":{"sessionListLimit":0}}')))).toBe(1);
  });

  it("未知键忽略，不污染已知配置", async () => {
    const cfg = await loadConfig(await homeWith('{"share":{"sessionListLimit":10,"bogus":1},"future":{}}'));
    expect(cfg).toEqual({ share: { sessionListLimit: 10 } });
  });
});
