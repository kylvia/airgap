import { describe, expect, it } from "vitest";
import { runDoctor } from "../src/commands/doctor.js";
import { createI18n, type LocaleSelection } from "../src/i18n/index.js";

describe("runDoctor", () => {
  it("prints localized language decision diagnostics", async () => {
    const output: string[] = [];
    const language: LocaleSelection = {
      locale: "zh-CN",
      source: "macOS AppleLanguages",
      detectedLocale: "zh-Hans-CN",
    };

    await runDoctor(language, createI18n("en"), {
      probe: async (command) => `${command} test-version`,
      log: (line) => output.push(line),
    });

    expect(output).toContain("  language source: macOS AppleLanguages");
    expect(output).toContain("  detected locale: zh-Hans-CN");
    expect(output).toContain("  resolved locale: zh-CN");
  });
});
