import { describe, expect, it } from "vitest";
import { createI18n, normalizeLocale, resolveLocale } from "../src/i18n/index.js";

describe("normalizeLocale", () => {
  it("normalizes supported English and Simplified Chinese locale forms", () => {
    expect(normalizeLocale("en_US.UTF-8")).toBe("en");
    expect(normalizeLocale("en-GB")).toBe("en");
    expect(normalizeLocale("zh_CN.UTF-8")).toBe("zh-CN");
    expect(normalizeLocale("zh-Hans-SG")).toBe("zh-CN");
  });

  it("does not mislabel Traditional Chinese or POSIX locales as Simplified Chinese", () => {
    expect(normalizeLocale("zh-TW")).toBeUndefined();
    expect(normalizeLocale("zh_Hant_HK")).toBeUndefined();
    expect(normalizeLocale("C")).toBeUndefined();
    expect(normalizeLocale("POSIX")).toBeUndefined();
  });
});

describe("resolveLocale", () => {
  it("uses cli, env, config, system, then English fallback precedence", () => {
    expect(resolveLocale({ cli: "zh-CN", env: "en", config: "en", system: "en-US" })).toBe("zh-CN");
    expect(resolveLocale({ env: "zh_CN.UTF-8", config: "en", system: "en-US" })).toBe("zh-CN");
    expect(resolveLocale({ config: "zh-CN", system: "en-US" })).toBe("zh-CN");
    expect(resolveLocale({ system: "zh-Hans" })).toBe("zh-CN");
    expect(resolveLocale({ system: "fr-FR" })).toBe("en");
  });

  it("falls back to English when an explicit higher-priority value is unsupported", () => {
    expect(resolveLocale({ cli: "fr", config: "zh-CN" })).toBe("en");
    expect(resolveLocale({ env: "de", config: "zh-CN" })).toBe("en");
  });
});

describe("createI18n", () => {
  it("has matching catalogs and interpolates parameters", () => {
    const en = createI18n("en");
    const zh = createI18n("zh-CN");
    expect(en.keys()).toEqual(zh.keys());
    expect(en.t("share.turnCount", { count: 3 })).toBe("3 turns");
    expect(zh.t("share.turnCount", { count: 3 })).toBe("共 3 轮");
  });
});
