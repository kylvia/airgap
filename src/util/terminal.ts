/**
 * Sanitize an untrusted string before printing it to a terminal.
 *
 * A malicious .ccpack can plant ANSI/OSC escape sequences in any manifest
 * string (title, producer, ruleId, placeholder, entry paths, ...). Printed
 * verbatim these can rewrite the screen, forge a "脱敏 ✓" line, hide output,
 * or exfiltrate via OSC 52 clipboard writes. Every manifest-derived string must
 * pass through this function before it reaches the receiver's terminal.
 *
 * Strategy:
 *  1) Strip OSC sequences first (ESC ] ... BEL | ESC \), including unterminated
 *     ones, so their payload can never survive as visible text.
 *  2) Strip all remaining C0/C1 control characters and bare ESC, leaving only
 *     printable content (newlines/tabs included — see note).
 */
export function sanitizeForTerminal(s: string): string {
  return (
    s
      // OSC: ESC ] ... (BEL | ST). Payload chars are anything but BEL/ESC.
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g, "")
      // Remaining C0 (incl. ESC 0x1b, and 0x00-0x1f), DEL, and C1 (0x80-0x9f).
      .replace(/[\x00-\x1f\x7f-\x9f]/g, "")
  );
}
