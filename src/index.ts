import { Command } from "commander";
import { createRequire } from "node:module";
import { registerScan } from "./commands/scan.js";
import { registerPack } from "./commands/pack.js";
import { registerOpen } from "./commands/open.js";
import { registerShow } from "./commands/show.js";
import { registerShare } from "./commands/share.js";
import { registerDoctor } from "./commands/doctor.js";
import { extractLangArg } from "./cli.js";
import { loadConfig } from "./config.js";
import { createI18n } from "./i18n/index.js";
import { resolveLanguage } from "./i18n/system.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

async function main(): Promise<void> {
  const config = await loadConfig();
  const language = await resolveLanguage({
    cli: extractLangArg(process.argv.slice(2)),
    env: process.env["AIRGAP_LANG"],
    config: config.language,
  });
  const i18n = createI18n(language.locale);
  const program = new Command();

  program
    .name("airgap")
    .description(i18n.t("program.description"))
    .version(pkg.version)
    .option("--lang <locale>", i18n.t("program.langOption"));

  registerScan(program);
  registerPack(program);
  registerOpen(program);
  registerShow(program);
  registerShare(program, i18n, language);
  registerDoctor(program, language, i18n);

  await program.parseAsync(process.argv);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(2);
});
