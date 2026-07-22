import { randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_BYTES = 32;
const TOKEN_LENGTH = 43;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function createShareAccessToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function isValidShareAccessToken(token: string): boolean {
  if (token.length !== TOKEN_LENGTH || !TOKEN_PATTERN.test(token)) return false;
  const decoded = Buffer.from(token, "base64url");
  return decoded.length === TOKEN_BYTES && decoded.toString("base64url") === token;
}

export function shareCookieName(port: number): string {
  return `airgap_share_${port}`;
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;

  let occurrences = 0;
  let value: string | undefined;
  for (const segment of header.split(";")) {
    const pair = segment.replace(/^[\t ]+/, "");
    const separator = pair.indexOf("=");
    if (separator === -1) {
      if (pair === name) occurrences += 1;
      continue;
    }
    if (pair.slice(0, separator) !== name) continue;
    occurrences += 1;
    value = pair.slice(separator + 1);
  }

  return occurrences === 1 && value !== undefined && value !== "" && !/\s/.test(value)
    ? value
    : undefined;
}

export function tokensEqual(actual: string | undefined, expected: string): boolean {
  if (actual === undefined || !isValidShareAccessToken(actual) || !isValidShareAccessToken(expected)) {
    return false;
  }

  const actualBytes = Buffer.from(actual, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export function isAllowedOrigin(origin: string | undefined, expectedOrigin: string): boolean {
  return origin === expectedOrigin;
}
