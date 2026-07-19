import { Command, CommanderError } from "commander";
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

  it("does not run the action hook for help", async () => {
    const check = vi.fn(async (_options: UpdateCheckOptions) => undefined);
    const program = quietProgram();
    program.command("probe").action(() => undefined);
    registerUpdateCheckHook(program, {
      currentVersion: "0.2.0",
      i18n: createI18n("en"),
      config: {},
      argv: ["probe", "--help"],
      check,
    });

    await expect(program.parseAsync(["node", "airgap", "probe", "--help"]))
      .rejects.toBeInstanceOf(CommanderError);
    expect(check).not.toHaveBeenCalled();
  });
});
