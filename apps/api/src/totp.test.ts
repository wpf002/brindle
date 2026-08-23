import { describe, it, expect } from "vitest";
import {
  currentTotpCode, verifyTotp, generateTotpSecret, totpUri, generateRecoveryCode,
} from "./totp.js";

// Base32 of the ASCII secret "12345678901234567890" used by RFC 6238's
// Appendix B test vectors.
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("TOTP against RFC 6238 test vectors", () => {
  // The RFC publishes 8-digit codes; a 6-digit code is the last 6 digits,
  // since truncation is `binary % 10^digits`.
  const vectors: [number, string][] = [
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
    [20000000000, "353130"],
  ];

  for (const [unixSeconds, expected] of vectors) {
    it(`matches the published code at t=${unixSeconds}`, () => {
      expect(currentTotpCode(RFC_SECRET, unixSeconds * 1000)).toBe(expected);
    });
  }
});

describe("verifyTotp", () => {
  const at = 1111111109 * 1000;

  it("accepts the current code", () => {
    expect(verifyTotp(RFC_SECRET, "081804", at)).toBe(true);
  });

  it("tolerates one step of clock drift in each direction", () => {
    const prev = currentTotpCode(RFC_SECRET, at - 30_000);
    const next = currentTotpCode(RFC_SECRET, at + 30_000);
    expect(verifyTotp(RFC_SECRET, prev, at)).toBe(true);
    expect(verifyTotp(RFC_SECRET, next, at)).toBe(true);
  });

  it("rejects a code two steps away", () => {
    const stale = currentTotpCode(RFC_SECRET, at - 90_000);
    expect(verifyTotp(RFC_SECRET, stale, at)).toBe(false);
  });

  it("rejects the wrong code and malformed input", () => {
    expect(verifyTotp(RFC_SECRET, "000000", at)).toBe(false);
    expect(verifyTotp(RFC_SECRET, "12345", at)).toBe(false); // too short
    expect(verifyTotp(RFC_SECRET, "abcdef", at)).toBe(false); // not digits
    expect(verifyTotp(RFC_SECRET, "", at)).toBe(false);
  });

  it("ignores whitespace users paste in from an authenticator", () => {
    expect(verifyTotp(RFC_SECRET, " 081 804 ", at)).toBe(true);
  });
});

describe("secret and recovery-code generation", () => {
  it("generates a valid base32 secret that round-trips", () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    const code = currentTotpCode(secret);
    expect(verifyTotp(secret, code)).toBe(true);
  });

  it("generates distinct secrets", () => {
    expect(generateTotpSecret()).not.toBe(generateTotpSecret());
  });

  it("builds an otpauth URI an authenticator app can read", () => {
    const uri = totpUri("ABC234", "rancher@example.com");
    expect(uri).toContain("otpauth://totp/");
    expect(uri).toContain("secret=ABC234");
    expect(uri).toContain("issuer=Brindle");
  });

  it("generates grouped recovery codes without ambiguous characters", () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^[2-9BCDFGHJKMNPQRSTVWXYZ]{4}(-[2-9BCDFGHJKMNPQRSTVWXYZ]{4}){3}$/);
    expect(code).not.toMatch(/[01OIAEU]/); // no ambiguous chars, no vowels
  });
});
