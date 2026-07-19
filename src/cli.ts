export function extractLangArg(argv: string[]): string | undefined {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--lang") return argv[i + 1];
    if (arg?.startsWith("--lang=")) return arg.slice("--lang=".length);
  }
  return undefined;
}
