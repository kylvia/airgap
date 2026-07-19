import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";
import { registerUpdateCheckHook } from "../src/cli.js";
import { createI18n } from "../src/i18n/index.js";
import type { UpdateCheckOptions } from "../src/update-check.js";

function quietProgram(): Command {
  return new Command()
    .name("airgap-test")
    .exitOverride()
    .configureOutput({
      writeOut: () => undefined,
      writeErr: () => undefined,
    });
}

describe("registerUpdateCheckHook", () => {
  it("runs the check before a valid action and forwards resolved inputs", async () => {
    const events: string[] = [];
    let seen: UpdateCheckOptions | undefined;
    const program = quietProgram();
    program.command("probe").action(() => {
      events.push("action");
    });
    registerUpdateCheckHook(program, {
      currentVersion: "0.2.0",
      i18n: createI18n("zh-CN"),
      config: { updateCheck: false },
      argv: ["--lang", "zh-CN", "probe"],
      check: async (options) => {
        seen = options;
        events.push("check");
      },
    });

    await program.parseAsync(["node", "airgap", "probe"]);

    expect(events).toEqual(["check", "action"]);
    expect(seen).toMatchObject({
      currentVersion: "0.2.0",
      configEnabled: false,
      argv: ["--lang", "zh-CN", "probe"],
    });
    expect(seen?.i18n.locale).toBe("zh-CN");
  });

  it.each([
    ["help", ["probe", "--help"]],
    ["version", ["--version"]],
    ["empty invocation", []],
    ["invalid command", ["unknown"]],
  ])("does not run the action hook for %s", async (_label, argv) => {
    const check = vi.fn(async (_options: UpdateCheckOptions) => undefined);
    const program = quietProgram().version("0.2.0");
    program.command("probe").action(() => undefined);
    registerUpdateCheckHook(program, {
      currentVersion: "0.2.0",
      i18n: createI18n("en"),
      config: {},
      argv,
      check,
    });

    await program.parseAsync(["node", "airgap", ...argv]).catch(() => undefined);
    expect(check).not.toHaveBeenCalled();
  });

  it("continues into the business action when the update checker rejects", async () => {
    const events: string[] = [];
    const program = quietProgram();
    program.command("probe").action(() => {
      events.push("action");
    });
    registerUpdateCheckHook(program, {
      currentVersion: "0.2.0",
      i18n: createI18n("en"),
      config: {},
      argv: ["probe"],
      check: async () => {
        events.push("check");
        throw new Error("checker failed");
      },
    });

    await expect(program.parseAsync(["node", "airgap", "probe"])).resolves.toBeDefined();
    expect(events).toEqual(["check", "action"]);
  });
});
