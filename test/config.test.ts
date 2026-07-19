import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SESSION_LIST_LIMIT,
  loadConfig,
  sessionListLimit,
  shareToolDisplay,
  updateConfig,
  updateShareConfig,
} from "../src/config.js";
import { DEFAULT_TOOL_DISPLAY } from "../src/types.js";
import { resolveLocale } from "../src/i18n/index.js";

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

  it("保留顶层 language 原值，让统一 locale 解析器处理回落", async () => {
    expect(await loadConfig(await homeWith('{"language":"zh-CN"}'))).toEqual({ language: "zh-CN" });
    const unsupported = await loadConfig(await homeWith('{"language":"fr"}'));
    expect(unsupported).toEqual({ language: "fr" });
    expect(resolveLocale({ config: unsupported.language, system: "zh-CN" })).toBe("en");
  });
});

describe("updateShareConfig (share UI 设置面板的持久化)", () => {
  it("目录/文件不存在时创建并写入，返回生效值", async () => {
    const home = await homeWith(null);
    expect((await updateShareConfig({ sessionListLimit: 20 }, home)).sessionListLimit).toBe(20);
    expect(sessionListLimit(await loadConfig(home))).toBe(20);
  });

  it("只动 patch 里的键，文件里的未知键原样保留", async () => {
    const home = await homeWith('{"future":{"x":1},"share":{"sessionListLimit":50,"other":"keep"}}');
    await updateShareConfig({ sessionListLimit: 10 }, home);
    const raw = JSON.parse(
      await readFile(path.join(home, ".airgap", "config.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(raw["future"]).toEqual({ x: 1 });
    expect(raw["share"]).toEqual({ sessionListLimit: 10, other: "keep" });
  });

  it("config.json 存在但损坏 → 拒绝覆盖并抛错，原文件内容不动", async () => {
    const home = await homeWith("{ broken");
    await expect(updateShareConfig({ sessionListLimit: 10 }, home)).rejects.toThrow(/无法解析/);
    expect(await readFile(path.join(home, ".airgap", "config.json"), "utf8")).toBe("{ broken");
  });

  it("非整数 limit / 非法 toolDisplay 抛错；越界整数 clamp 后写入", async () => {
    const home = await homeWith(null);
    await expect(updateShareConfig({ sessionListLimit: 10.5 }, home)).rejects.toThrow(/整数/);
    await expect(updateShareConfig({ toolDisplay: "bogus" as never }, home)).rejects.toThrow(/toolDisplay/);
    expect((await updateShareConfig({ sessionListLimit: 500 }, home)).sessionListLimit).toBe(200);
  });

  it("toolDisplay 单写不动已有 limit；双键同写都落盘", async () => {
    const home = await homeWith('{"share":{"sessionListLimit":10}}');
    expect(await updateShareConfig({ toolDisplay: "none" }, home)).toEqual({ sessionListLimit: 10, toolDisplay: "none" });
    expect(await updateShareConfig({ sessionListLimit: 50, toolDisplay: "full" }, home)).toEqual({
      sessionListLimit: 50,
      toolDisplay: "full",
    });
    const cfg = await loadConfig(home);
    expect(sessionListLimit(cfg)).toBe(50);
    expect(shareToolDisplay(cfg)).toBe("full");
  });
});

describe("updateConfig (语言与 Share 设置的原子持久化)", () => {
  it("写入显式语言并在 auto 时只删除 language", async () => {
    const home = await homeWith('{"future":{"keep":true},"share":{"toolDisplay":"full"}}');
    expect(await updateConfig({ language: "zh-CN" }, home)).toMatchObject({ language: "zh-CN" });
    expect(await loadConfig(home)).toEqual({ language: "zh-CN", share: { toolDisplay: "full" } });

    await updateConfig({ language: "auto" }, home);
    const raw = JSON.parse(
      await readFile(path.join(home, ".airgap", "config.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(raw).toEqual({ future: { keep: true }, share: { toolDisplay: "full" } });
  });

  it("一次写入语言、列表条数和工具展示级别", async () => {
    const home = await homeWith(null);
    await expect(
      updateConfig({ language: "en", sessionListLimit: 50, toolDisplay: "none" }, home),
    ).resolves.toEqual({ language: "en", sessionListLimit: 50, toolDisplay: "none" });
    await expect(loadConfig(home)).resolves.toEqual({
      language: "en",
      share: { sessionListLimit: 50, toolDisplay: "none" },
    });
  });

  it("拒绝非法语言和损坏配置且不覆盖原文件", async () => {
    const home = await homeWith("{ broken");
    await expect(updateConfig({ language: "fr" as never }, home)).rejects.toThrow(/language/);
    await expect(updateConfig({ language: "en" }, home)).rejects.toThrow(/无法解析/);
    await expect(readFile(path.join(home, ".airgap", "config.json"), "utf8")).resolves.toBe("{ broken");
  });

  it("串行合并并发的语言、列表和工具设置，不丢未知键或损坏 JSON", async () => {
    const home = await homeWith(
      '{"future":{"keep":true},"share":{"sessionListLimit":10,"toolDisplay":"summary","other":"keep"}}',
    );
    await Promise.all(
      Array.from({ length: 30 }, (_, index) => {
        if (index % 3 === 0) return updateConfig({ language: "zh-CN" }, home);
        if (index % 3 === 1) return updateConfig({ sessionListLimit: 50 }, home);
        return updateConfig({ toolDisplay: "full" }, home);
      }),
    );

    const raw = JSON.parse(
      await readFile(path.join(home, ".airgap", "config.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(raw).toEqual({
      language: "zh-CN",
      future: { keep: true },
      share: { sessionListLimit: 50, toolDisplay: "full", other: "keep" },
    });
  });
});

describe("share.toolDisplay 加载", () => {
  it("合法值生效，非法值静默回退默认", async () => {
    expect(shareToolDisplay(await loadConfig(await homeWith('{"share":{"toolDisplay":"full"}}')))).toBe("full");
    expect(shareToolDisplay(await loadConfig(await homeWith('{"share":{"toolDisplay":"bogus"}}')))).toBe(
      DEFAULT_TOOL_DISPLAY,
    );
    expect(shareToolDisplay(await loadConfig(await homeWith(null)))).toBe(DEFAULT_TOOL_DISPLAY);
  });
});
