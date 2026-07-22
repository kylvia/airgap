import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import {
  claudeProjectsDir,
  codexSessionsDir,
  discoverSessions,
  discoverSessionsDetailed,
  mungeCwd,
  readSessionCwdForDiscovery,
} from "../src/discovery.js";

const HOME = fileURLToPath(new URL("./fixtures/home", import.meta.url));

describe("path helpers", () => {
  it("mungeCwd replaces every non-alphanumeric char with - (claude 2.1.198 bundle rule)", () => {
    expect(mungeCwd("/Users/tester/my.app")).toBe("-Users-tester-my-app");
    expect(mungeCwd("/tmp")).toBe("-tmp");
    expect(mungeCwd("/Users/tester/alpha")).toBe("-Users-tester-alpha");
    expect(mungeCwd("/Users/tester/my_app")).toBe("-Users-tester-my-app");
    expect(mungeCwd("/Users/tester/a b+c")).toBe("-Users-tester-a-b-c");
  });

  it("store dirs live under the given home", () => {
    expect(claudeProjectsDir("/home/x")).toBe(join("/home/x", ".claude", "projects"));
    expect(codexSessionsDir("/home/x")).toBe(join("/home/x", ".codex", "sessions"));
  });
});

describe("discoverSessions", () => {
  it("finds sessions from both sources", async () => {
    const all = await discoverSessions({ home: HOME });
    expect(all).toHaveLength(4);
    expect(all.filter((s) => s.source === "claude")).toHaveLength(3);
    const codex = all.filter((s) => s.source === "codex");
    expect(codex).toHaveLength(1);
    expect(codex[0]!.id).toBe("019aaaaa-bbbb-4ccc-8ddd-eeeeffff0001");
    expect(codex[0]!.cwd).toBe("/Users/tester/alpha");
    expect(codex[0]!.project).toBe("/Users/tester/alpha");
    expect(codex[0]!.sidecars).toEqual({ subagents: [], toolResults: [] });
    for (const s of all) {
      expect(s.sizeBytes).toBeGreaterThan(0);
      expect(s.mtimeMs).toBeGreaterThan(0);
      expect(s.file.startsWith(HOME)).toBe(true);
    }
  });

  it("collects claude sidecars (subagents incl. meta.json, tool-results txt)", async () => {
    const all = await discoverSessions({ home: HOME, sources: ["claude"] });
    const a = all.find((s) => s.id === "11111111-1111-4111-8111-111111111111")!;
    expect(a.cwd).toBe("/Users/tester/alpha");
    expect(a.project).toBe("/Users/tester/alpha");
    expect(a.sidecars.subagents).toHaveLength(2);
    expect(a.sidecars.subagents.some((p) => p.endsWith("agent-aaa111.jsonl"))).toBe(true);
    expect(a.sidecars.subagents.some((p) => p.endsWith("agent-aaa111.meta.json"))).toBe(true);
    expect(a.sidecars.toolResults).toHaveLength(1);
    expect(a.sidecars.toolResults[0]!.endsWith(join("tool-results", "toolu_01AAA.txt"))).toBe(true);
  });

  it("reads cwd past a leading summary record", async () => {
    const all = await discoverSessions({ home: HOME, sources: ["claude"] });
    const b = all.find((s) => s.id === "22222222-2222-4222-8222-222222222222")!;
    expect(b.cwd).toBe("/Users/tester/alpha");
    expect(b.sidecars.subagents).toHaveLength(0);
    expect(b.sidecars.toolResults).toHaveLength(0);
  });

  it("filters by source", async () => {
    expect(await discoverSessions({ home: HOME, sources: ["claude"] })).toHaveLength(3);
    expect(await discoverSessions({ home: HOME, sources: ["codex"] })).toHaveLength(1);
  });

  it("filters by project substring", async () => {
    const beta = await discoverSessions({ home: HOME, project: "beta" });
    expect(beta).toHaveLength(1);
    expect(beta[0]!.id).toBe("33333333-3333-4333-8333-333333333333");
    expect(beta[0]!.project).toBe("/Users/tester/beta");
    expect(await discoverSessions({ home: HOME, project: "no-such-project" })).toHaveLength(0);
  });

  it("sorts newest first", async () => {
    const all = await discoverSessions({ home: HOME });
    for (let i = 1; i < all.length; i++) {
      expect(all[i - 1]!.mtimeMs).toBeGreaterThanOrEqual(all[i]!.mtimeMs);
    }
  });

  it("tolerates a home without any session stores", async () => {
    expect(await discoverSessions({ home: join(HOME, "definitely-missing") })).toEqual([]);
  });

  it("reports typed provider and path issues without changing the legacy result", async () => {
    const claudePath = claudeProjectsDir(HOME);
    const readDirectory = async (dir: string): Promise<Dirent[]> => {
      if (dir === claudePath) {
        throw Object.assign(new Error("permission denied"), { code: "EACCES" });
      }
      return readdir(dir, { withFileTypes: true });
    };

    const detailed = await discoverSessionsDetailed({ home: HOME }, { readDirectory });
    expect(detailed.sessions).toHaveLength(1);
    expect(detailed.issues).toEqual([
      { source: "claude", provider: "Claude Code", path: claudePath, code: "EACCES" },
    ]);
    await expect(discoverSessions({ home: HOME })).resolves.toHaveLength(4);
  });

  it("treats missing stores as empty rather than diagnostic failures", async () => {
    const detailed = await discoverSessionsDetailed({ home: join(HOME, "definitely-missing") });
    expect(detailed).toEqual({ sessions: [], issues: [] });
  });

  it.each(["ENOENT", "ENOTDIR"])("treats %s directory failures as an empty store", async (code) => {
    const detailed = await discoverSessionsDetailed({ home: HOME, sources: ["claude"] }, {
      readDirectory: async (): Promise<Dirent[]> => {
        throw Object.assign(new Error("store unavailable"), { code });
      },
    });

    expect(detailed).toEqual({ sessions: [], issues: [] });
  });

  it.each(["EIO", "EMFILE"])("propagates unexpected %s directory failures", async (code) => {
    const failure = Object.assign(new Error("unexpected filesystem failure"), { code });

    await expect(discoverSessionsDetailed({ home: HOME, sources: ["claude"] }, {
      readDirectory: async (): Promise<Dirent[]> => {
        throw failure;
      },
    })).rejects.toBe(failure);
  });

  it.each([
    { source: "claude" as const, code: "EIO" },
    { source: "codex" as const, code: "EMFILE" },
  ])("propagates unexpected $code stat failures for $source sessions", async ({ source, code }) => {
    const baseline = await discoverSessions({ home: HOME, sources: [source] });
    const blockedFile = baseline[0]!.file;
    const failure = Object.assign(new Error("unexpected stat failure"), { code });

    await expect(discoverSessionsDetailed({ home: HOME, sources: [source] }, {
      statPath: async (target) => {
        if (target === blockedFile) throw failure;
        return stat(target);
      },
    })).rejects.toBe(failure);
  });

  it("records stat permission failures and continues discovering the other provider", async () => {
    const baseline = await discoverSessions({ home: HOME, sources: ["claude"] });
    const blockedFile = baseline[0]!.file;
    const detailed = await discoverSessionsDetailed({ home: HOME }, {
      statPath: async (target) => {
        if (target === blockedFile) throw Object.assign(new Error("permission denied"), { code: "EPERM" });
        return stat(target);
      },
    });

    expect(detailed.sessions.some((session) => session.file === blockedFile)).toBe(false);
    expect(detailed.sessions.some((session) => session.source === "codex")).toBe(true);
    expect(detailed.issues).toContainEqual({
      source: "claude",
      provider: "Claude Code",
      path: join(claudeProjectsDir(HOME), blockedFile.slice(claudeProjectsDir(HOME).length + 1).split("/")[0]!),
      code: "EPERM",
    });
    expect(detailed.issues[0]!.path).not.toContain(basename(blockedFile));
    expect(detailed.issues[0]!.path).not.toContain(basename(blockedFile, ".jsonl"));
  });

  it("records JSONL read permission failures and continues discovering the other provider", async () => {
    const baseline = await discoverSessions({ home: HOME, sources: ["claude"] });
    const blockedFile = baseline[0]!.file;
    const detailed = await discoverSessionsDetailed({ home: HOME }, {
      readSessionCwd: async (target, maxLines) => {
        if (target === blockedFile) throw Object.assign(new Error("permission denied"), { code: "EACCES" });
        return readSessionCwdForDiscovery(target, maxLines);
      },
    });

    expect(detailed.sessions.some((session) => session.file === blockedFile)).toBe(false);
    expect(detailed.sessions.some((session) => session.source === "codex")).toBe(true);
    expect(detailed.issues).toContainEqual({
      source: "claude",
      provider: "Claude Code",
      path: join(claudeProjectsDir(HOME), blockedFile.slice(claudeProjectsDir(HOME).length + 1).split("/")[0]!),
      code: "EACCES",
    });
    expect(detailed.issues[0]!.path).not.toContain(basename(blockedFile));
  });

  it("never exposes Codex transcript filenames or session UUIDs in access diagnostics", async () => {
    const baseline = await discoverSessions({ home: HOME, sources: ["codex"] });
    const blockedFile = baseline[0]!.file;
    const detailed = await discoverSessionsDetailed({ home: HOME, sources: ["codex"] }, {
      statPath: async (target) => {
        if (target === blockedFile) throw Object.assign(new Error("permission denied"), { code: "EACCES" });
        return stat(target);
      },
    });

    expect(detailed.sessions).toEqual([]);
    expect(detailed.issues).toEqual([{
      source: "codex",
      provider: "Codex",
      path: codexSessionsDir(HOME),
      code: "EACCES",
    }]);
    expect(detailed.issues[0]!.path).not.toContain(basename(blockedFile));
    expect(detailed.issues[0]!.path).not.toContain(baseline[0]!.id);
  });
});
