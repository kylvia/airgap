import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createI18n } from "../src/i18n/index.js";
import {
  checkForUpdate,
  isNewerStableVersion,
  shouldCheckForUpdate,
  type UpdateCheckOptions,
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

const NOW = Date.parse("2026-07-19T12:00:00.000Z");
const homes: string[] = [];

async function tempHome(): Promise<string> {
  const home = await mkdtemp(path.join(os.tmpdir(), "airgap-update-check-"));
  homes.push(home);
  return home;
}

function baseOptions(home: string): UpdateCheckOptions {
  return {
    currentVersion: "0.2.0",
    i18n: createI18n("en"),
    argv: ["scan"],
    env: {},
    configEnabled: undefined,
    home,
    stdoutIsTTY: true,
    stderrIsTTY: true,
    now: () => NOW,
    requestLatest: async () => ({ version: "0.3.0" }),
    writeStderr: () => undefined,
  };
}

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

describe("checkForUpdate", () => {
  it("notifies once, writes a minimal cache, and skips while fresh", async () => {
    const home = await tempHome();
    let requests = 0;
    let stderr = "";
    const options: UpdateCheckOptions = {
      ...baseOptions(home),
      requestLatest: async () => {
        requests += 1;
        return { version: "0.3.0", ignored: "metadata" };
      },
      writeStderr: (message) => {
        stderr += message;
      },
    };

    await expect(checkForUpdate(options)).resolves.toBeUndefined();
    await expect(checkForUpdate(options)).resolves.toBeUndefined();

    expect(requests).toBe(1);
    expect(stderr).toContain("Airgap 0.3.0 is available (current 0.2.0)");
    expect(stderr.match(/Airgap 0\.3\.0/g)).toHaveLength(1);
    await expect(
      readFile(path.join(home, ".airgap", "update-check.json"), "utf8").then(JSON.parse),
    ).resolves.toEqual({
      checkedAt: "2026-07-19T12:00:00.000Z",
      latestVersion: "0.3.0",
    });
  });

  it.each(["1.0.0", "0.3.0", "0.2.1"])(
    "notifies for a newer stable release %s",
    async (latestVersion) => {
      const home = await tempHome();
      let stderr = "";
      await checkForUpdate({
        ...baseOptions(home),
        requestLatest: async () => ({ version: latestVersion }),
        writeStderr: (message) => {
          stderr += message;
        },
      });
      expect(stderr).toContain(`Airgap ${latestVersion} is available`);
    },
  );

  it.each(["0.2.0", "0.1.9", "0.3.0-beta.1", "latest"])(
    "does not notify for an equal, older, or unsupported release %s",
    async (latestVersion) => {
      const home = await tempHome();
      let stderr = "";
      await checkForUpdate({
        ...baseOptions(home),
        requestLatest: async () => ({ version: latestVersion }),
        writeStderr: (message) => {
          stderr += message;
        },
      });
      expect(stderr).toBe("");
    },
  );

  it("records failed attempts and does not retry during the fresh window", async () => {
    const home = await tempHome();
    let requests = 0;
    const options: UpdateCheckOptions = {
      ...baseOptions(home),
      requestLatest: async () => {
        requests += 1;
        throw new Error("offline");
      },
    };

    await expect(checkForUpdate(options)).resolves.toBeUndefined();
    await expect(checkForUpdate(options)).resolves.toBeUndefined();

    expect(requests).toBe(1);
    await expect(
      readFile(path.join(home, ".airgap", "update-check.json"), "utf8").then(JSON.parse),
    ).resolves.toEqual({ checkedAt: "2026-07-19T12:00:00.000Z" });
  });

  it("times out a hung request without failing the command", async () => {
    const home = await tempHome();
    await expect(
      checkForUpdate({
        ...baseOptions(home),
        timeoutMs: 5,
        requestLatest: async () => new Promise<never>(() => undefined),
      }),
    ).resolves.toBeUndefined();
    await expect(readFile(path.join(home, ".airgap", "update-check.json"), "utf8")).resolves.toContain(
      "2026-07-19T12:00:00.000Z",
    );
  });

  it("treats malformed, expired, and future-dated caches as stale", async () => {
    const home = await tempHome();
    const dir = path.join(home, ".airgap");
    const file = path.join(dir, "update-check.json");
    await mkdir(dir, { recursive: true });
    await writeFile(file, "{ broken", "utf8");
    let requests = 0;
    const options: UpdateCheckOptions = {
      ...baseOptions(home),
      requestLatest: async () => {
        requests += 1;
        return { version: "0.2.0" };
      },
    };

    await checkForUpdate(options);
    await writeFile(file, '{"checkedAt":"2026-07-18T11:59:59.999Z"}', "utf8");
    await checkForUpdate(options);
    await writeFile(file, '{"checkedAt":"2026-07-20T12:00:00.000Z"}', "utf8");
    await checkForUpdate(options);

    expect(requests).toBe(3);
  });

  it("ignores invalid payloads plus cache and stderr write failures", async () => {
    const invalidHome = await tempHome();
    let stderr = "";
    await expect(
      checkForUpdate({
        ...baseOptions(invalidHome),
        requestLatest: async () => ({ version: "next" }),
        writeStderr: (message) => {
          stderr += message;
        },
      }),
    ).resolves.toBeUndefined();
    expect(stderr).toBe("");

    const unwritableHome = await tempHome();
    await writeFile(path.join(unwritableHome, ".airgap"), "not a directory", "utf8");
    await expect(checkForUpdate(baseOptions(unwritableHome))).resolves.toBeUndefined();

    const stderrFailureHome = await tempHome();
    await expect(
      checkForUpdate({
        ...baseOptions(stderrFailureHome),
        writeStderr: () => {
          throw new Error("stderr closed");
        },
      }),
    ).resolves.toBeUndefined();
  });

  it("uses unique temporary files so concurrent writes leave valid JSON", async () => {
    const home = await tempHome();
    await Promise.all(
      Array.from({ length: 20 }, () =>
        checkForUpdate({
          ...baseOptions(home),
          requestLatest: async () => ({ version: "0.3.0" }),
        }),
      ),
    );

    await expect(
      readFile(path.join(home, ".airgap", "update-check.json"), "utf8").then(JSON.parse),
    ).resolves.toMatchObject({
      checkedAt: "2026-07-19T12:00:00.000Z",
      latestVersion: "0.3.0",
    });
  });

  it("writes the notice in the resolved locale", async () => {
    const home = await tempHome();
    let stderr = "";
    await checkForUpdate({
      ...baseOptions(home),
      i18n: createI18n("zh-CN"),
      writeStderr: (message) => {
        stderr += message;
      },
    });
    expect(stderr).toContain("Airgap 0.3.0 已发布（当前 0.2.0）");
  });
});
