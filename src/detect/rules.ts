import type { Rule } from "../types.js";

/**
 * Detection rules, per CONTRACTS.md "检测规则" table.
 *
 * Conventions:
 * - Every pattern carries the /g flag and is only consumed via String.prototype.matchAll
 *   (which clones the regex, so the shared objects stay stateless).
 * - For context-style rules (aws-secret-key, bearer-token, generic-assignment) the
 *   secret value is capture group 1; matchers use `m[1] ?? m[0]` as the secret so that
 *   redaction replaces only the credential, not the surrounding context.
 * - `prefilter` is a literal, case-sensitive substring guaranteed to appear in every
 *   match of that rule; rules whose matches have no such invariant substring
 *   (case-insensitive or alternation-prefixed rules) leave it undefined.
 * - env-dump is structural (>=3 env-looking lines inside one string value); its pattern
 *   documents the per-line shape, but the scanner implements the counting specially.
 */
export const RULES: Rule[] = [
  {
    id: "anthropic-key",
    name: "Anthropic API key",
    severity: "critical",
    prefilter: "sk-ant-",
    pattern: /sk-ant-[A-Za-z0-9_-]{20,}/g,
  },
  {
    id: "openai-key",
    name: "OpenAI API key",
    severity: "critical",
    prefilter: "sk-",
    pattern: /sk-proj-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]*T3BlbkFJ[A-Za-z0-9_-]{5,}/g,
  },
  {
    // no prefilter: "ghp_…" and "github_pat_…" share no invariant substring
    id: "github-token",
    name: "GitHub token",
    severity: "critical",
    pattern: /gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,}/g,
  },
  {
    id: "aws-access-key",
    name: "AWS access key ID",
    severity: "critical",
    pattern: /(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}/g,
  },
  {
    id: "aws-secret-key",
    name: "AWS secret access key",
    severity: "high",
    pattern: /aws.{0,20}secret.{0,20}[:=]\s*['"]?([A-Za-z0-9/+=]{40})/gi,
  },
  {
    id: "google-api-key",
    name: "Google API key",
    severity: "critical",
    prefilter: "AIza",
    pattern: /AIza[0-9A-Za-z_-]{35}/g,
  },
  {
    id: "slack-token",
    name: "Slack token",
    severity: "critical",
    prefilter: "xox",
    pattern: /xox[baprs]-[0-9A-Za-z-]{10,}/g,
  },
  {
    id: "stripe-key",
    name: "Stripe live key",
    severity: "critical",
    prefilter: "_live_",
    pattern: /(?:sk|rk)_live_[0-9a-zA-Z]{24,}/g,
  },
  {
    id: "npm-token",
    name: "npm token",
    severity: "high",
    prefilter: "npm_",
    pattern: /npm_[A-Za-z0-9]{36}/g,
  },
  {
    id: "telegram-bot",
    name: "Telegram bot token",
    severity: "high",
    prefilter: ":AA",
    pattern: /[0-9]{8,10}:AA[A-Za-z0-9_-]{33}/g,
  },
  {
    id: "private-key",
    name: "Private key material",
    severity: "critical",
    prefilter: "PRIVATE KEY",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY/g,
  },
  {
    id: "jwt",
    name: "JSON Web Token",
    severity: "medium",
    prefilter: "eyJ",
    pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  },
  {
    id: "url-credentials",
    name: "Credentials embedded in URL",
    severity: "high",
    prefilter: "://",
    pattern: /[a-z][a-z0-9+.-]*:\/\/[^/\s:@'"]{3,}:[^/\s:@'"]{3,}@/g,
  },
  {
    id: "bearer-token",
    name: "Bearer token",
    severity: "medium",
    pattern: /bearer\s+([A-Za-z0-9._~+/-]{25,})/gi,
  },
  {
    id: "generic-assignment",
    name: "Hardcoded credential assignment",
    severity: "medium",
    pattern: /(?:api[_-]?key|secret|token|passwd|password)['"]?\s*[=:]\s*['"]?([A-Za-z0-9_./+=-]{16,})/gi,
  },
  {
    id: "env-dump",
    name: "Environment variable dump",
    severity: "high",
    pattern: /^[A-Z][A-Z0-9_]{2,}=\S+/gm,
  },
];

/**
 * Line-level quick screen: a raw jsonl line that fails this test cannot contain a match
 * for any rule, so it can be skipped before JSON.parse.
 *
 * Built from the per-rule prefilter substrings merged into one alternation. Rules that
 * have no single case-sensitive invariant substring (aws keys, bearer, generic
 * assignment, env-dump) contribute a hand-spelled case-class marker instead, so the
 * combined regex stays a strict superset of every rule's match set without needing the
 * /i flag (which would wreck selectivity of the case-sensitive markers).
 */
const PREFILTER_PARTS: string[] = [
  "sk-", // anthropic-key + both openai-key branches
  "gh[pousr]_", // github-token classic
  "github_pat_", // github-token fine-grained
  "AKIA", "ASIA", "ABIA", "ACCA", // aws-access-key
  "[aA][wW][sS]", // aws-secret-key (case-insensitive context)
  "AIza", // google-api-key
  "xox[baprs]-", // slack-token
  "[sr]k_live_", // stripe-key
  "npm_", // npm-token
  ":AA", // telegram-bot
  "-----BEGIN", // private-key
  "eyJ", // jwt
  "://", // url-credentials
  "[bB][eE][aA][rR][eE][rR]", // bearer-token (case-insensitive)
  "[aA][pP][iI][_-]?[kK][eE][yY]", // generic-assignment: api key markers
  "[sS][eE][cC][rR][eE][tT]", // generic-assignment: secret
  "[tT][oO][kK][eE][nN]", // generic-assignment: token
  "[pP][aA][sS][sS][wW](?:[oO][rR])?[dD]", // generic-assignment: passwd/password
  "[A-Z][A-Z0-9_]{2,}=\\S", // env-dump
];

export const PREFILTER: RegExp = new RegExp(PREFILTER_PARTS.join("|"));
