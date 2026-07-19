import { describe, expect, it } from "vitest";
import {
  isNewerStableVersion,
  shouldCheckForUpdate,
} from "../src/update-check.js";

describe("isNewerStableVersion", () => {
  it("compares major, minor, and patch components numerically", () => {
    expect(isNewerStableVersion("1.0.0", "0.9.9")).toBe(true);
    expect(isNewerStableVersion("0.3.0", "0.2.9")).toBe(true);
    expect(isNewerStableVersion("0.2.10", "0.2.9")).toBe(true);
    expect(isNewerStableVersion("0.2.0", "0.2.0")).toBe(false);
    expect(isNewerStableVersion("0.1.9", "0.2.0")).toBe(false);
  });

  it("ignores malformed, unsafe, and prerelease versions", () => {
    expect(isNewerStableVersion("0.3.0-beta.1", "0.2.0")).toBe(false);
    expect(isNewerStableVersion("latest", "0.2.0")).toBe(false);
    expect(isNewerStableVersion("99999999999999999.0.0", "0.2.0")).toBe(false);
    expect(isNewerStableVersion("0.3.0", "dev")).toBe(false);
  });
});

describe("shouldCheckForUpdate", () => {
  const eligible = {
    argv: ["scan"],
    env: {} as NodeJS.ProcessEnv,
    configEnabled: undefined,
    stdoutIsTTY: true,
    stderrIsTTY: true,
  };

  it("allows a normal interactive command", () => {
    expect(shouldCheckForUpdate(eligible)).toBe(true);
  });

  it.each([
    { ...eligible, argv: [] },
    { ...eligible, argv: ["scan", "--json"] },
    { ...eligible, argv: ["--help"] },
    { ...eligible, argv: ["-h"] },
    { ...eligible, argv: ["--version"] },
    { ...eligible, argv: ["-V"] },
    { ...eligible, env: { CI: "1" } },
    { ...eligible, env: { CI: "false" } },
    { ...eligible, env: { AIRGAP_NO_UPDATE_CHECK: "1" } },
    { ...eligible, configEnabled: false },
    { ...eligible, stdoutIsTTY: false },
    { ...eligible, stderrIsTTY: false },
  ])("skips ineligible invocations: %#", (input) => {
    expect(shouldCheckForUpdate(input)).toBe(false);
  });

  it("does not treat arbitrary opt-out strings as disabled", () => {
    expect(
      shouldCheckForUpdate({
        ...eligible,
        env: { AIRGAP_NO_UPDATE_CHECK: "true" },
      }),
    ).toBe(true);
  });
});
