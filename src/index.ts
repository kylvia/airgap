import { Command } from "commander";
import { createRequire } from "node:module";
import { registerScan } from "./commands/scan.js";
import { registerPack } from "./commands/pack.js";
import { registerOpen } from "./commands/open.js";
import { registerShow } from "./commands/show.js";
import { registerDoctor } from "./commands/doctor.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

const program = new Command();

program
  .name("airgap")
  .description("Scan, redact, and carry your local AI coding sessions. No cloud, no accounts.")
  .version(pkg.version);

registerScan(program);
registerPack(program);
registerOpen(program);
registerShow(program);
registerDoctor(program);

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(2);
});
