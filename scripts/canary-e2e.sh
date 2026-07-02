#!/usr/bin/env bash
#
# canary-e2e.sh — airgap pipeline smoke test against the *latest* claude-code.
#
# What this proves (without spending money or logging into claude):
#   1. We can synthesize a minimal claude session jsonl (with a planted secret)
#      in a throwaway HOME's ~/.claude/projects/<munged-cwd>/.
#   2. `airgap pack --yes` slices + redacts it into a .ccpack.
#   3. Unzipping the pack contains NO plaintext of the planted secret.
#   4. The manifest.json has the structure airgap's `open` relies on
#      (specVersion, source.tool=claude, claude-jsonl-tree dialect, redaction
#      annotations, entries with sha256, slice report).
#   5. `airgap open --print-only` can re-open the pack and re-extract it.
#
# It also records the resolved @anthropic-ai/claude-code version so the canary
# workflow can surface *format drift*: if a new claude version ships and this
# script goes red, the on-disk session format may have changed in a way that
# breaks airgap's slice/open loader — a human must re-check compatibility.
#
# This script drives airgap's OWN pipeline only. It never runs `claude --resume`.
#
# Usage:
#   scripts/canary-e2e.sh                # build from src, then run
#   AIRGAP_ENTRY=/path/to/index.js scripts/canary-e2e.sh   # test a prebuilt CLI
#
# Exit non-zero on any failed assertion.

set -euo pipefail

# ── locate repo + airgap entrypoint ─────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

log()  { printf '\033[1m[canary]\033[0m %s\n' "$*"; }
fail() { printf '\033[31m[canary] FAIL:\033[0m %s\n' "$*" >&2; exit 1; }
ok()   { printf '\033[32m[canary] ok:\033[0m %s\n' "$*"; }

# Build once unless the caller points us at an existing bundle.
AIRGAP_ENTRY="${AIRGAP_ENTRY:-}"
if [ -z "$AIRGAP_ENTRY" ]; then
  log "building airgap (npm run build)…"
  ( cd "$REPO_ROOT" && npm run build >/dev/null )
  AIRGAP_ENTRY="$REPO_ROOT/dist/index.js"
fi
[ -f "$AIRGAP_ENTRY" ] || fail "airgap entry not found: $AIRGAP_ENTRY"
log "airgap entry: $AIRGAP_ENTRY"

airgap() { node "$AIRGAP_ENTRY" "$@"; }

# ── record the installed claude-code version (drift signal) ─────────────────
# Best-effort: the canary workflow installs @anthropic-ai/claude-code@latest
# before calling us, but we do not require claude to be present to pass — we
# only exercise airgap's own pipeline. If claude is on PATH, log its version.
CLAUDE_VERSION="(not installed)"
if command -v claude >/dev/null 2>&1; then
  CLAUDE_VERSION="$(claude --version 2>/dev/null | head -n1 || true)"
fi
log "claude-code version under test: ${CLAUDE_VERSION:-unknown}"

# ── build a throwaway HOME with a synthetic claude session ──────────────────
WORK="$(mktemp -d 2>/dev/null || mktemp -d -t airgap-canary)"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

export HOME="$WORK/home"                 # airgap resolves ~/.claude via $HOME
mkdir -p "$HOME"

# The planted secret is a *fake* anthropic key shaped to trip the anthropic-key
# rule (sk-ant- + >=20 chars). It is not a real credential.
SECRET="sk-ant-api03-CANARYcanaryCANARYcanary01234567890abcdefFAKE"

# Original session cwd. munge = every non-alphanumeric char -> '-'
PROJ_CWD="/home/runner/work/airgap-canary/demo"
MUNGED="$(printf '%s' "$PROJ_CWD" | sed 's/[^a-zA-Z0-9]/-/g')"
SID="c0ffee00-cafe-4bad-8dad-0000cana2y00"
PROJ_DIR="$HOME/.claude/projects/$MUNGED"
mkdir -p "$PROJ_DIR"
SESSION_FILE="$PROJ_DIR/$SID.jsonl"

# Minimal but structurally faithful claude tree: one user turn carrying the
# secret, one assistant reply. version field feeds manifest.source.toolVersion.
{
  printf '{"type":"user","uuid":"u1","parentUuid":null,"sessionId":"%s","timestamp":"2026-07-01T10:00:01.000Z","cwd":"%s","version":"canary-synth","gitBranch":"main","message":{"role":"user","content":"deploy helper needs my anthropic key: %s"}}\n' "$SID" "$PROJ_CWD" "$SECRET"
  printf '{"type":"assistant","uuid":"a1","parentUuid":"u1","sessionId":"%s","timestamp":"2026-07-01T10:00:05.000Z","version":"canary-synth","message":{"id":"msg_01","role":"assistant","content":[{"type":"text","text":"Got it, key stored."}]}}\n' "$SID"
} > "$SESSION_FILE"

log "synthesized session: $SESSION_FILE"
grep -q "$SECRET" "$SESSION_FILE" || fail "planted secret missing from synthetic session (test setup broken)"
ok "synthetic claude session contains the planted secret (pre-condition)"

# ── stage 1: pack (slice + redact) ──────────────────────────────────────────
PACK="$WORK/canary.ccpack"
log "airgap pack --session $SID --yes"
airgap pack --session "$SID" --yes --out "$PACK"
[ -f "$PACK" ] || fail "pack did not produce $PACK"
ok "pack produced $PACK"

# ── stage 2: unpack + assert NO plaintext secret survives ───────────────────
UNZ="$WORK/unpacked"
mkdir -p "$UNZ"
if command -v unzip >/dev/null 2>&1; then
  unzip -o -q "$PACK" -d "$UNZ"
else
  # ubuntu-latest ships unzip, but fall back to node's yauzl (a dep) if absent.
  node -e '
    const yauzl = require(process.argv[1] + "/node_modules/yauzl");
    const fs = require("fs"), path = require("path");
    const [,, nm, src, dest] = process.argv;
    yauzl.open(src, { lazyEntries: true }, (err, zip) => {
      if (err) throw err;
      zip.on("entry", (e) => {
        const out = path.join(dest, e.fileName);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        if (/\/$/.test(e.fileName)) return zip.readEntry();
        zip.openReadStream(e, (er, rs) => {
          if (er) throw er;
          rs.pipe(fs.createWriteStream(out)).on("finish", () => zip.readEntry());
        });
      });
      zip.on("end", () => {});
      zip.readEntry();
    });
  ' "$REPO_ROOT" "" "$PACK" "$UNZ"
fi

[ -f "$UNZ/manifest.json" ]   || fail "unpacked pack has no manifest.json"
[ -f "$UNZ/transcript.jsonl" ] || fail "unpacked pack has no transcript.jsonl"
ok "pack unpacked (manifest.json + transcript.jsonl present)"

# THE core airgap guarantee: the plaintext secret must not survive the pack.
if grep -rqF "$SECRET" "$UNZ"; then
  grep -rnF "$SECRET" "$UNZ" >&2 || true
  fail "PLAINTEXT SECRET LEAKED into the pack — redaction regression"
fi
ok "no plaintext secret in the packed bytes (redaction held)"

# ── stage 3: assert manifest structure that `open` depends on ───────────────
log "asserting manifest.json structure…"
node -e '
  const fs = require("fs");
  const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const must = (cond, msg) => { if (!cond) { console.error("manifest assertion failed: " + msg); process.exit(1); } };

  must(m.specVersion === 1, "specVersion should be 1, got " + JSON.stringify(m.specVersion));
  must(typeof m.producer === "string" && m.producer.startsWith("airgap/"), "producer should start with airgap/");
  must(m.source && m.source.tool === "claude", "source.tool should be claude");
  must(typeof m.source.dialect === "string" && m.source.dialect.startsWith("claude-jsonl-tree/"),
       "source.dialect should start with claude-jsonl-tree/, got " + JSON.stringify(m.source && m.source.dialect));
  must(typeof m.sessionId === "string" && m.sessionId.length > 0, "sessionId missing");
  must(Array.isArray(m.entries) && m.entries.length >= 1, "entries[] should be non-empty");
  must(m.entries.every(e => typeof e.path === "string" && typeof e.sha256 === "string" && e.sha256.length === 64),
       "every entry needs a path and a 64-char sha256");
  must(m.entries.some(e => e.role === "transcript"), "entries should include a transcript role");
  must(Array.isArray(m.redaction) && m.redaction.length >= 1,
       "redaction[] should record at least the planted anthropic-key");
  must(m.redaction.some(a => a.ruleId === "anthropic-key" && a.count >= 1),
       "redaction should include anthropic-key >= 1");
  must(m.redaction.every(a => typeof a.placeholder === "string" && a.placeholder.length > 0),
       "each redaction annotation needs a placeholder");
  must(m.slice && typeof m.slice.totalRecords === "number" && typeof m.slice.keptRecords === "number",
       "slice report (totalRecords/keptRecords) missing");
  must(m.pathTokens && typeof m.pathTokens === "object", "pathTokens object missing");
  console.log("manifest OK: spec v" + m.specVersion + ", " + m.source.tool + " " +
              (m.source.toolVersion || "?") + ", dialect " + m.source.dialect + ", " +
              m.redaction.length + " redaction class(es), " + m.entries.length + " entr(ies)");
' "$UNZ/manifest.json"
ok "manifest structure matches airgap open contract"

# ── stage 4: open --print-only round-trips the pack ─────────────────────────
log "airgap open --print-only"
OPEN_OUT="$(airgap open "$PACK" --print-only)"
printf '%s\n' "$OPEN_OUT"
printf '%s\n' "$OPEN_OUT" | grep -q "transcript.jsonl" \
  || fail "open --print-only did not report an extracted transcript.jsonl path"
# The receipt should also re-print the redaction annotation from the manifest.
printf '%s\n' "$OPEN_OUT" | grep -q "anthropic-key" \
  || fail "open --print-only receipt did not mention the redacted anthropic-key"
ok "open --print-only re-opened the pack and printed the extracted transcript"

log "ALL CANARY CHECKS PASSED (claude-code: ${CLAUDE_VERSION:-unknown})"
