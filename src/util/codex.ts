/** Shared codex scaffold detection, used by both render/turns.ts and slice.ts. */

/**
 * Prefixes of synthetic scaffold messages injected as role=user by codex
 * (environment context, user instructions, AGENTS.md, etc.). These carry no
 * real user turn and must not count as turn boundaries.
 */
export const CODEX_SCAFFOLD_PREFIXES = [
  "<user_instructions>",
  "<environment_context>",
  "<permissions instructions>",
  "<ide_context>",
  "# AGENTS.md instructions",
];

/** True when the given user text is a codex scaffold response_item, not a real prompt. */
export function isCodexScaffold(text: string): boolean {
  const head = text.trimStart();
  return CODEX_SCAFFOLD_PREFIXES.some((p) => head.startsWith(p));
}
