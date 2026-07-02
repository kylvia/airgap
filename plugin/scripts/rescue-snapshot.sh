#!/usr/bin/env bash
#
# rescue-snapshot.sh — airgap PreCompact rescue hook.
#
# Claude Code fires PreCompact just before it compacts (summarizes + truncates)
# the running conversation. Compaction is lossy: detail you might still want is
# gone afterward. This hook copies the *full* current transcript into a local
# ring buffer so you can always recover the pre-compaction session and, if you
# want, carry it elsewhere with `airgap open`/`pack`.
#
# It reads the hook event JSON from stdin. Verified against the Claude Code
# hooks reference: PreCompact stdin carries `session_id`, `transcript_path`,
# `cwd`, and `hook_event_name`, plus a `trigger` of "manual" | "auto".
#   https://code.claude.com/docs/en/hooks
#
# Snapshots land in ~/.airgap/rescue/ and the buffer keeps the newest 20.
#
# Design rules for a compaction hook:
#   - Never block compaction: always exit 0, even on error. A rescue that jams
#     the user's session is worse than a missed snapshot.
#   - Be fast and dependency-light: pure bash + coreutils, no node, no network.
#   - Do not modify the live session file; only copy it.

set -u

RESCUE_DIR="${AIRGAP_RESCUE_DIR:-$HOME/.airgap/rescue}"
KEEP="${AIRGAP_RESCUE_KEEP:-20}"

# Slurp the hook event JSON from stdin (may be empty if invoked manually).
INPUT="$(cat 2>/dev/null || true)"

# Minimal JSON field extractor: pulls "key":"value" for a flat string field.
# Avoids a jq dependency. Good enough for the small, well-formed hook payload.
json_str() {
  # $1 = field name
  printf '%s' "$INPUT" \
    | tr -d '\n' \
    | grep -oE "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" \
    | head -n1 \
    | sed -E "s/^\"$1\"[[:space:]]*:[[:space:]]*\"//; s/\"$//"
}

TRANSCRIPT="$(json_str transcript_path)"
SESSION_ID="$(json_str session_id)"
TRIGGER="$(json_str trigger)"
[ -n "$TRIGGER" ] || TRIGGER="unknown"

# Fall back to a short session tag if the id is absent.
[ -n "$SESSION_ID" ] || SESSION_ID="nosid"
SID_TAG="$(printf '%s' "$SESSION_ID" | tr -c 'A-Za-z0-9_.-' '-' | cut -c1-40)"

# Nothing to rescue if we cannot find the transcript.
if [ -z "$TRANSCRIPT" ] || [ ! -f "$TRANSCRIPT" ]; then
  echo "airgap rescue: no readable transcript_path in PreCompact payload; skipping." >&2
  exit 0
fi

mkdir -p "$RESCUE_DIR" 2>/dev/null || { echo "airgap rescue: cannot create $RESCUE_DIR" >&2; exit 0; }
chmod 700 "$RESCUE_DIR" 2>/dev/null || true

# Sortable, unique filename: <UTC-timestamp>__<trigger>__<sid>.jsonl
TS="$(date -u +%Y%m%dT%H%M%SZ 2>/dev/null || date +%s)"
DEST="$RESCUE_DIR/${TS}__${TRIGGER}__${SID_TAG}.jsonl"

if cp "$TRANSCRIPT" "$DEST" 2>/dev/null; then
  chmod 600 "$DEST" 2>/dev/null || true
  echo "airgap rescue: snapshot saved $DEST (before $TRIGGER compaction)."
else
  echo "airgap rescue: failed to copy transcript; skipping." >&2
  exit 0
fi

# Ring buffer: keep only the newest $KEEP snapshots, delete the rest.
# List by name (timestamp-prefixed = chronological), drop the newest KEEP,
# remove whatever remains.
if [ "$KEEP" -gt 0 ] 2>/dev/null; then
  # shellcheck disable=SC2012
  ls -1 "$RESCUE_DIR"/*.jsonl 2>/dev/null \
    | sort -r \
    | tail -n +"$((KEEP + 1))" \
    | while IFS= read -r old; do
        [ -n "$old" ] && rm -f "$old" 2>/dev/null || true
      done
fi

exit 0
