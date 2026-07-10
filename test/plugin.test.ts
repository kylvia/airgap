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
