import { describe, expect, it } from "vitest";
import {
  createI18n,
  languagePreferenceFromSelection,
  normalizeLocale,
  resolveLocale,
  resolveLocaleSelection,
} from "../src/i18n/index.js";

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

describe("resolveLocaleSelection", () => {
  it("reports the winning explicit source and raw locale", () => {
    expect(
      resolveLocaleSelection(
        { cli: "zh-Hans-CN", env: "en", config: "en", system: "en-US" },
        "macOS AppleLanguages",
      ),
    ).toEqual({ locale: "zh-CN", source: "--lang", detectedLocale: "zh-Hans-CN" });
    expect(resolveLocaleSelection({ env: "zh_CN.UTF-8", config: "en" })).toEqual({
      locale: "zh-CN",
      source: "AIRGAP_LANG",
      detectedLocale: "zh_CN.UTF-8",
    });
    expect(resolveLocaleSelection({ config: "en-GB" })).toEqual({
      locale: "en",
      source: "config.language",
      detectedLocale: "en-GB",
    });
  });

  it("reports the supplied system source", () => {
    expect(resolveLocaleSelection({ system: "zh-Hans-CN" }, "macOS AppleLanguages")).toEqual({
      locale: "zh-CN",
      source: "macOS AppleLanguages",
      detectedLocale: "zh-Hans-CN",
    });
  });

  it("reports an English fallback when no locale is available", () => {
    expect(resolveLocaleSelection({})).toEqual({
      locale: "en",
      source: "English fallback",
    });
  });
});

describe("languagePreferenceFromSelection", () => {
  it("maps automatic sources to auto and explicit sources to the resolved locale", () => {
    expect(
      languagePreferenceFromSelection({
        locale: "zh-CN",
        source: "macOS AppleLanguages",
        detectedLocale: "zh-Hans-CN",
      }),
    ).toBe("auto");
    expect(
      languagePreferenceFromSelection({ locale: "en", source: "--lang", detectedLocale: "en" }),
    ).toBe("en");
    expect(
      languagePreferenceFromSelection({
        locale: "zh-CN",
        source: "config.language",
        detectedLocale: "zh-CN",
      }),
    ).toBe("zh-CN");
  });
});

describe("createI18n", () => {
  it("has matching catalogs and interpolates parameters", () => {
    const en = createI18n("en");
    const zh = createI18n("zh-CN");
    expect(en.keys()).toEqual(zh.keys());
    expect(en.t("share.turnCount", { count: 3 })).toBe("3 turns");
    expect(zh.t("share.turnCount", { count: 3 })).toBe("共 3 轮");
    expect(en.t("share.turnCount", { count: 1 })).toBe("1 turn");
    expect(
      zh.t("update.available", { latest: "0.3.0", current: "0.2.0" }),
    ).toContain("Airgap 0.3.0 已发布（当前 0.2.0）");
  });

  it("provides complete nontechnical desktop Share copy in both languages", () => {
    const en = createI18n("en");
    const zh = createI18n("zh-CN");
    const keys = [
      "share.desktop.title",
      "share.desktop.conversationLabel",
      "share.desktop.claudeConversation",
      "share.desktop.codexConversation",
      "share.desktop.recheck",
      "share.desktop.role.me",
      "share.desktop.role.assistant",
      "share.desktop.role.tool",
      "share.desktop.redaction",
      "share.desktop.copyText",
      "share.desktop.saveImage",
      "share.desktop.copyImage",
      "share.desktop.emptyTitle",
      "share.desktop.emptyBody",
      "share.desktop.localOnly",
      "share.desktop.permissionError",
      "share.desktop.startupError",
      "share.desktop.imageFailed",
      "share.desktop.settings",
      "share.desktop.advanced",
      "share.desktop.about",
      "share.desktop.version",
      "share.desktop.downloadPage",
      "share.desktop.conversationPicker",
      "share.desktop.sessionListLabel",
      "share.desktop.toolDisplayLabel",
      "share.desktop.previewLabel",
      "share.desktop.copyTextSuccess",
      "share.desktop.copyTextFailed",
      "share.desktop.copyImageSuccess",
      "share.desktop.copyImageFailed",
      "share.desktop.saveImageSuccess",
      "share.desktop.saveImageFailed",
      "share.desktop.settingsSaveFailed",
    ] as const;

    for (const key of keys) {
      expect(en.t(key)).not.toBe(key);
      expect(zh.t(key)).not.toBe(key);
    }
    expect(en.t("share.desktop.redaction")).toContain("possible secrets");
    expect(zh.t("share.desktop.copyText")).toBe("复制文本");
  });
});
