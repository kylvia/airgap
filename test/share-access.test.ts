import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
  createShareAccessToken,
  isAllowedOrigin,
  isValidShareAccessToken,
  readCookie,
  shareCookieName,
  tokensEqual,
} from "../src/server/share-access.js";

describe("desktop Share access helpers", () => {
  it("creates a canonical 32-byte base64url capability", () => {
    const first = createShareAccessToken();
    const second = createShareAccessToken();

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(first, "base64url")).toHaveLength(32);
    expect(second).not.toBe(first);
  });

  it.each([
    "",
    "a".repeat(42),
    "a".repeat(44),
    `${"a".repeat(42)}=`,
    `${"a".repeat(42)}+`,
    `${"a".repeat(42)}/`,
    "_".repeat(43),
  ])("rejects a malformed or non-canonical capability: %s", (token) => {
    expect(isValidShareAccessToken(token)).toBe(false);
  });

  it("accepts only the exact canonical capability", () => {
    const token = createShareAccessToken();

    expect(isValidShareAccessToken(token)).toBe(true);
    expect(tokensEqual(token, token)).toBe(true);
    expect(tokensEqual(undefined, token)).toBe(false);
    expect(tokensEqual(`${token.slice(0, -1)}x`, token)).toBe(false);
    expect(tokensEqual(`${token}=`, token)).toBe(false);
  });

  it("isolates the cookie name by the actual listener port", () => {
    expect(shareCookieName(49152)).toBe("airgap_share_49152");
    expect(shareCookieName(49153)).toBe("airgap_share_49153");
  });

  it("reads one exact cookie without URL-decoding its value", () => {
    expect(readCookie("theme=dark; airgap_share_49152=abc_-%41; x=y", "airgap_share_49152")).toBe(
      "abc_-%41",
    );
    expect(readCookie("airgap_share_491520=wrong", "airgap_share_49152")).toBeUndefined();
  });

  it.each([
    undefined,
    "",
    "airgap_share_49152",
    "airgap_share_49152=",
    "airgap_share_49152=one; airgap_share_49152=one",
    "airgap_share_49152=one; airgap_share_49152=two",
    "airgap_share_49152; airgap_share_49152=one",
    "airgap_share_49152 =one",
    "airgap_share_49152= one",
    "airgap_share_49152=one ",
  ])("fails closed for missing, malformed, empty, or duplicate cookies: %s", (header) => {
    expect(readCookie(header, "airgap_share_49152")).toBeUndefined();
  });

  it("allows only the exact loopback Origin", () => {
    const expected = "http://127.0.0.1:49152";

    expect(isAllowedOrigin(expected, expected)).toBe(true);
    expect(isAllowedOrigin(undefined, expected)).toBe(false);
    expect(isAllowedOrigin("null", expected)).toBe(false);
    expect(isAllowedOrigin("http://localhost:49152", expected)).toBe(false);
    expect(isAllowedOrigin("http://127.0.0.1:49153", expected)).toBe(false);
    expect(isAllowedOrigin("http://127.0.0.1:49152/", expected)).toBe(false);
  });
});
