import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));

async function readRepoFile(relativePath: string): Promise<string> {
  return readFile(path.join(root, relativePath), "utf8");
}

describe("shared airgap plugin package", () => {
  it("keeps one marketplace entry pointing at plugins/airgap", async () => {
    const marketplace = JSON.parse(await readRepoFile(".claude-plugin/marketplace.json")) as {
      description: string;
      plugins: Array<{ name: string; source: string; version: string }>;
    };
    expect(marketplace.description).toBe(
      "airgap — scan, redact, carry, and share local AI coding sessions. No cloud, no accounts.",
    );
    expect(marketplace.plugins).toHaveLength(1);
    expect(marketplace.plugins[0]).toMatchObject({
      name: "airgap",
      source: "./plugins/airgap",
      version: "0.1.0",
    });

    const claudeManifest = JSON.parse(
      await readRepoFile("plugins/airgap/.claude-plugin/plugin.json"),
    ) as { name: string; version: string };
    expect(claudeManifest).toMatchObject({ name: "airgap", version: "0.1.0" });
  });

  it("keeps the existing share runtime loopback-only and temporary", async () => {
    const server = await readRepoFile("src/server/share-server.ts");
    const command = await readRepoFile("src/commands/share.ts");
    expect(server).toContain("const IDLE_TIMEOUT_MS = 10 * 60 * 1000");
    expect(server).toContain('server.listen(0, "127.0.0.1")');
    expect(server).toContain('server.listen(preferred ?? 0, "127.0.0.1"');
    expect(server).toContain('err.code === "EADDRINUSE"');
    expect(server).toContain('p === "/api/close"');
    expect(command).toContain("if (opts.open !== false) openBrowser(server.url)");
  });
});

describe("Claude quick launch", () => {
  it("exposes /airgap:share as a direct background launch", async () => {
    const command = await readRepoFile("plugins/airgap/commands/share.md");
    expect(command).toContain("disable-model-invocation: true");
    expect(command).toContain("allowed-tools: Bash(airgap share), Bash(npx airgap share)");
    expect(command).not.toContain("airgap*");
    expect(command).toContain("background execution");
    expect(command).toContain("http://localhost:<port>/");
    expect(command).toContain("Do not claim success");
    expect(command).toContain("run `airgap share` in a terminal");
    expect(command).not.toContain("Option 1 (default)");
  });

  it("keeps /airgap:airgap-share as a working compatibility alias", async () => {
    const legacy = await readRepoFile("plugins/airgap/commands/airgap-share.md");
    expect(legacy).toContain("allowed-tools: Bash(airgap share), Bash(npx airgap share)");
    expect(legacy).not.toContain("airgap*");
    expect(legacy).toContain("compatibility alias");
    expect(legacy).toContain("/airgap:share");
    expect(legacy).toContain("http://localhost:<port>/");
  });
});

describe("Codex quick launch", () => {
  it("packages exactly one airgap-share skill", async () => {
    const manifest = JSON.parse(
      await readRepoFile("plugins/airgap/.codex-plugin/plugin.json"),
    ) as {
      name: string;
      version: string;
      skills: string;
      apps?: unknown;
      mcpServers?: unknown;
      interface: { defaultPrompt: string[] };
    };
    expect(manifest).toMatchObject({
      name: "airgap",
      version: "0.1.0",
      skills: "./skills/",
    });
    expect(manifest.apps).toBeUndefined();
    expect(manifest.mcpServers).toBeUndefined();
    expect(manifest.interface.defaultPrompt[0]).toContain("airgap share");
  });

  it("keeps the Codex skill narrow, local, and on demand", async () => {
    const skill = await readRepoFile("plugins/airgap/skills/airgap-share/SKILL.md");
    const metadata = await readRepoFile(
      "plugins/airgap/skills/airgap-share/agents/openai.yaml",
    );
    expect(skill).toMatch(/^---\nname: airgap-share\ndescription:/);
    expect(skill).toContain("airgap share");
    expect(skill).toContain("background or long-running process support");
    expect(skill).toContain("http://localhost:<port>/");
    expect(skill).toContain("Never create a daemon");
    expect(skill).toContain("Never modify shell startup files");
    expect(skill).toContain("run `airgap share` in a terminal");
    expect(metadata).toContain('display_name: "airgap Share"');
    expect(metadata).toContain("$airgap-share");
  });
});
