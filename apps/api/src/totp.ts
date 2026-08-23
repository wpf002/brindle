import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// RFC 6238 TOTP, implemented directly rather than pulled in as a dependency —
// it's ~60 lines of standard HMAC and this keeps the auth path free of
// third-party code we'd have to audit.

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const PERIOD_SECS = 30;
const DIGITS = 6;
// Accept the adjacent windows so a user with a slightly-off device clock isn't
// locked out. One step each way = ±30s, the usual tolerance.
const DRIFT_STEPS = 1;

export function generateTotpSecret(): string {
  return toBase32(randomBytes(20)); // 160 bits, per RFC 4226
}

function toBase32(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function fromBase32(s: string): Buffer {
  const clean = s.toUpperCase().replace(/=+$/, "").replace(/\s/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error("INVALID_BASE32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function codeForCounter(secret: string, counter: number): string {
  const key = fromBase32(secret);
  const buf = Buffer.alloc(8);
  // Counter is a 64-bit big-endian int; write as two 32-bit halves since
  // bitwise ops in JS are 32-bit.
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);

  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);

  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

/** The code valid right now — used by tests and by enrollment confirmation. */
export function currentTotpCode(secret: string, atMs: number = Date.now()): string {
  return codeForCounter(secret, Math.floor(atMs / 1000 / PERIOD_SECS));
}

/** Verify a submitted code, tolerating one step of clock drift either way. */
export function verifyTotp(secret: string, submitted: string, atMs: number = Date.now()): boolean {
  const code = submitted.replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return false;

  const counter = Math.floor(atMs / 1000 / PERIOD_SECS);
  for (let drift = -DRIFT_STEPS; drift <= DRIFT_STEPS; drift++) {
    const expected = codeForCounter(secret, counter + drift);
    // Constant-time compare so a valid prefix isn't distinguishable by timing.
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(code))) return true;
  }
  return false;
}

/** otpauth:// URI for authenticator apps (Google Authenticator, 1Password, …). */
export function totpUri(secret: string, account: string, issuer = "Brindle"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(PERIOD_SECS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** A human-transcribable recovery code, shown once at enrollment. */
export function generateRecoveryCode(): string {
  // Crockford-ish: no vowels (no accidental words), no 0/O/1/I ambiguity.
  const alphabet = "23456789BCDFGHJKMNPQRSTVWXYZ";
  const bytes = randomBytes(16);
  let out = "";
  for (let i = 0; i < 16; i++) {
    if (i > 0 && i % 4 === 0) out += "-";
    out += alphabet[bytes[i]! % alphabet.length];
  }
  return out;
}
