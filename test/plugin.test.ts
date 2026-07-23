import { readFile, readdir } from "node:fs/promises";
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
    ) as { name: string; version: string; homepage?: unknown; repository?: unknown };
    expect(claudeManifest).toMatchObject({ name: "airgap", version: "0.1.0" });
    expect(claudeManifest.homepage).toBeUndefined();
    expect(claudeManifest.repository).toBeUndefined();
  });

  it("isolates Claude hooks from Codex automatic discovery", async () => {
    await expect(readRepoFile("plugins/airgap/hooks/hooks.json")).rejects.toMatchObject({
      code: "ENOENT",
    });

    const claudeManifest = JSON.parse(
      await readRepoFile("plugins/airgap/.claude-plugin/plugin.json"),
    ) as { hooks: string };
    expect(claudeManifest.hooks).toBe("./claude-hooks/hooks.json");

    const hookConfig = JSON.parse(
      await readRepoFile("plugins/airgap/claude-hooks/hooks.json"),
    ) as { hooks: { PreCompact: unknown[] } };
    expect(hookConfig.hooks.PreCompact).toHaveLength(2);
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

  it("keeps the share-command regression harness compatible with Node 22", async () => {
    const harness = await readRepoFile("test/share-command.test.ts");
    expect(harness).not.toContain("--import");
    expect(harness).not.toContain("--input-type");
    expect(harness).toContain("tsx/cli");
  });
});

describe("Claude quick launch", () => {
  it("exposes /airgap:share as a direct background launch", async () => {
    const command = await readRepoFile("plugins/airgap/commands/share.md");
    expect(command).toContain("disable-model-invocation: true");
    expect(command.match(/^allowed-tools:.*$/m)?.[0]).toBe(
      "allowed-tools: Bash(airgap share)",
    );
    expect(command).not.toContain("npx airgap share");
    expect(command).not.toContain("airgap*");
    expect(command).toContain("background execution");
    expect(command).toContain("http://127.0.0.1:<port>/");
    expect(command).toContain("Do not claim success");
    expect(command).toContain("run `airgap share` in a terminal");
    expect(command).not.toContain("Option 1 (default)");
  });

  it("keeps command names disjoint from shared skills while preserving the legacy alias", async () => {
    const [commandEntries, skillEntries, sharedSkill, pluginReadme] = await Promise.all([
      readdir(path.join(root, "plugins/airgap/commands"), { withFileTypes: true }),
      readdir(path.join(root, "plugins/airgap/skills"), { withFileTypes: true }),
      readRepoFile("plugins/airgap/skills/airgap-share/SKILL.md"),
      readRepoFile("plugins/airgap/README.md"),
    ]);
    const commands = commandEntries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => path.parse(entry.name).name)
      .sort();
    const skills = skillEntries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect(commands).toContain("share");
    expect(skills).toContain("airgap-share");
    expect(commands.filter((command) => skills.includes(command))).toEqual([]);

    const frontmatter = sharedSkill.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
    expect(frontmatter.match(/^allowed-tools:.*$/m)?.[0]).toBe(
      "allowed-tools: Bash(airgap share)",
    );
    expect(frontmatter).not.toContain("disable-model-invocation: true");
    expect(sharedSkill).not.toContain("npx airgap share");
    expect(sharedSkill).toContain(
      "In Claude Code, `/airgap:share` is the preferred command.",
    );
    expect(sharedSkill).toContain(
      "If invoked through the legacy `/airgap:airgap-share` alias, complete the launch first, then mention the shorter command.",
    );
    expect(pluginReadme).toContain(
      "Legacy alias provided by the shared `airgap-share` skill",
    );
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
      author: { name: string; url?: unknown };
      homepage?: unknown;
      mcpServers?: unknown;
      repository?: unknown;
      interface: { defaultPrompt: string[]; websiteURL?: unknown };
    };
    expect(manifest).toMatchObject({
      name: "airgap",
      version: "0.1.0",
      skills: "./skills/",
    });
    expect(manifest.apps).toBeUndefined();
    expect(manifest.author.url).toBeUndefined();
    expect(manifest.homepage).toBeUndefined();
    expect(manifest.mcpServers).toBeUndefined();
    expect(manifest.repository).toBeUndefined();
    expect(manifest.interface.websiteURL).toBeUndefined();
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
    expect(skill).toContain("http://127.0.0.1:<port>/");
    expect(skill).toContain("Never create a daemon");
    expect(skill).toContain("Never modify shell startup files");
    expect(skill).toContain("run `airgap share` in a terminal");
    expect(skill).not.toContain("npx airgap share");
    expect(skill).toContain("from a trusted local checkout");
    expect(skill).toContain("npm run build && npm link");
    expect(skill).toContain("then retry `airgap share`");
    expect(metadata).toContain('display_name: "airgap Share"');
    expect(metadata).toContain("$airgap-share");
  });

  it("discovers only airgap-share with narrow bilingual triggers", async () => {
    const skills = await readdir(path.join(root, "plugins/airgap/skills"));
    expect(skills.sort()).toEqual(["airgap-share"]);

    const skill = await readRepoFile("plugins/airgap/skills/airgap-share/SKILL.md");
    const description = skill.match(/^description: (.+)$/m)?.[1] ?? "";
    expect(description).toMatch(
      /^Open airgap's local picker for the current Claude or Codex coding conversation when/,
    );
    expect(description).toContain("share this coding session");
    expect(description).toContain("分享这段会话");
    expect(description).toContain("Do not use for generic file, link, or social sharing");
  });
});

describe("quick-launch documentation", () => {
  function sectionBetween(document: string, startHeading: string, endHeading: string): string {
    const start = document.indexOf(startHeading);
    const end = document.indexOf(endHeading, start + startHeading.length);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    return document.slice(start, end);
  }

  it("documents local conversation, terminal, alias, and launcher entry points", async () => {
    const [english, chinese, pluginReadme] = await Promise.all([
      readRepoFile("README.md"),
      readRepoFile("README.zh-CN.md"),
      readRepoFile("plugins/airgap/README.md"),
    ]);
    const englishShare = sectionBetween(
      english,
      "## Open the local picker — `share`",
      "## Turn a few turns into a shareable image — `show`",
    );
    const chineseShare = sectionBetween(
      chinese,
      "## 打开本地选择器 —— `share`",
      "## 把几轮对话出成图 —— show",
    );

    for (const readme of [englishShare, chineseShare, pluginReadme]) {
      expect(readme).toContain("airgap share");
      expect(readme).toContain("/airgap:share");
      expect(readme).toContain("$airgap-share");
      expect(readme).toContain("alias ags='airgap share'");
      expect(readme).toContain("loopback");
    }
    expect(englishShare).toContain("npx airgap share");
    expect(chineseShare).toContain("npx airgap share");
    expect(englishShare).not.toContain("npm run build && npm link");
    expect(chineseShare).not.toContain("npm run build && npm link");
    expect(pluginReadme).toContain("npm run build && npm link");
    expect(englishShare).toContain("Done");
    expect(chineseShare).toContain("完成关闭");
    expect(pluginReadme).toMatch(/Done[\s\S]*完成关闭/);
    expect(englishShare).toMatch(/Raycast[\s\S]*Alfred[\s\S]*macOS Shortcuts/);
    expect(englishShare).toContain("ten minutes of inactivity");
    expect(englishShare).toContain("airgap itself does not stay resident");
    expect(chineseShare).toMatch(/Raycast[\s\S]*Alfred[\s\S]*macOS 快捷指令/);
    expect(chineseShare).toContain("空闲 10 分钟");
    expect(chineseShare).toContain("airgap 自身不常驻");
    expect(pluginReadme).toMatch(/Raycast[\s\S]*Alfred[\s\S]*macOS Shortcuts/);
    expect(pluginReadme).toContain("ten minutes of inactivity");
    expect(pluginReadme).toContain("airgap itself does not stay resident");
  });

  it("documents local plugin installation and preserves rescue and uninstall guidance", async () => {
    const pluginReadme = await readRepoFile("plugins/airgap/README.md");

    expect(pluginReadme).toContain("/plugin marketplace add /absolute/path/to/airgap");
    expect(pluginReadme).toContain("/plugin install airgap@airgap-marketplace");
    expect(pluginReadme).toContain("/reload-plugins");
    expect(pluginReadme).toContain(
      "codex plugin marketplace add /absolute/path/to/airgap",
    );
    expect(pluginReadme).toContain("codex plugin add airgap@airgap-marketplace");
    expect(pluginReadme).toContain("new task");
    expect(pluginReadme).toContain("restart Codex");
    for (const command of [
      "/airgap:share",
      "/airgap:airgap-share",
      "/airgap:airgap-scan",
      "/airgap:airgap-pack",
      "/airgap:airgap-rescue",
    ]) {
      expect(pluginReadme).toContain(`| \`${command}\` |`);
    }
    expect(pluginReadme).toContain("PreCompact rescue hook");
    expect(pluginReadme).toContain("## Uninstall");
    expect(pluginReadme).not.toContain("airgap-cli/airgap");
    expect(pluginReadme).not.toContain("npx airgap share");
  });
});
