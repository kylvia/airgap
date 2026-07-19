import { describe, expect, it } from "vitest";
import {
  detectSystemLocale,
  parseAppleLanguages,
  resolveLanguage,
} from "../src/i18n/system.js";

describe("parseAppleLanguages", () => {
  it("returns the first preferred macOS UI language", () => {
    expect(parseAppleLanguages('(\n    "zh-Hans-CN",\n    "en-US"\n)')).toBe("zh-Hans-CN");
  });

  it("rejects empty or malformed defaults output", () => {
    expect(parseAppleLanguages("")).toBeUndefined();
    expect(parseAppleLanguages("(zh-Hans-CN, en-US)")).toBeUndefined();
    expect(parseAppleLanguages("unexpected output")).toBeUndefined();
    expect(parseAppleLanguages('warning: "domain unavailable"')).toBeUndefined();
  });
});

describe("detectSystemLocale", () => {
  it("uses the first macOS AppleLanguages preference", async () => {
    await expect(
      detectSystemLocale({
        platform: "darwin",
        env: {},
        intlLocale: "en-US",
        readMacLanguages: async () => '("zh-Hans-CN", "en-US")',
      }),
    ).resolves.toEqual({ locale: "zh-Hans-CN", source: "macOS AppleLanguages" });
  });

  it("prefers Windows Intl over locale environment variables", async () => {
    await expect(
      detectSystemLocale({
        platform: "win32",
        env: { LANG: "en_US.UTF-8" },
        intlLocale: "zh-CN",
      }),
    ).resolves.toEqual({ locale: "zh-CN", source: "Windows Intl" });
  });

  it("uses LC_MESSAGES before LANG on Linux", async () => {
    await expect(
      detectSystemLocale({
        platform: "linux",
        env: { LC_MESSAGES: "zh_CN.UTF-8", LANG: "en_US.UTF-8" },
        intlLocale: "en-US",
      }),
    ).resolves.toEqual({ locale: "zh_CN.UTF-8", source: "LC_MESSAGES" });
  });

  it("falls back to locale environment variables when macOS defaults fails", async () => {
    await expect(
      detectSystemLocale({
        platform: "darwin",
        env: { LC_ALL: "zh_CN.UTF-8", LANG: "en_US.UTF-8" },
        intlLocale: "en-US",
        readMacLanguages: async () => {
          throw new Error("defaults unavailable");
        },
      }),
    ).resolves.toEqual({ locale: "zh_CN.UTF-8", source: "LC_ALL" });
  });

  it("falls back when macOS defaults returns quoted but malformed output", async () => {
    await expect(
      detectSystemLocale({
        platform: "darwin",
        env: { LANG: "zh_CN.UTF-8" },
        intlLocale: "en-US",
        readMacLanguages: async () => 'warning: "domain unavailable"',
      }),
    ).resolves.toEqual({ locale: "zh_CN.UTF-8", source: "LANG" });
  });

  it("falls back to Intl when no platform preference is available", async () => {
    await expect(
      detectSystemLocale({ platform: "linux", env: {}, intlLocale: "en-GB" }),
    ).resolves.toEqual({ locale: "en-GB", source: "Intl" });
  });
});

describe("resolveLanguage", () => {
  it("does not probe the operating system when an explicit language is present", async () => {
    let detectorCalls = 0;

    await expect(
      resolveLanguage({ cli: "en", env: "zh-CN", config: "zh-CN" }, async () => {
        detectorCalls += 1;
        return { locale: "zh-Hans-CN", source: "macOS AppleLanguages" };
      }),
    ).resolves.toEqual({ locale: "en", source: "--lang", detectedLocale: "en" });
    expect(detectorCalls).toBe(0);
  });

  it("probes the operating system when no explicit language is present", async () => {
    await expect(
      resolveLanguage({}, async () => ({
        locale: "zh-Hans-CN",
        source: "macOS AppleLanguages",
      })),
    ).resolves.toEqual({
      locale: "zh-CN",
      source: "macOS AppleLanguages",
      detectedLocale: "zh-Hans-CN",
    });
  });
});
