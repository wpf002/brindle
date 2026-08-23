import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);
const KEY_LEN = 64;

// Password hashing via Node's built-in scrypt — no native dependency (bcrypt/
// argon2 bindings are a real source of pain in sandboxed/CI environments), and
// scrypt is a perfectly sound choice for this. Stored as "saltHex:hashHex".
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, KEY_LEN)) as Buffer;
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const derived = (await scrypt(password, salt, expected.length)) as Buffer;
  // timingSafeEqual throws on length mismatch rather than returning false —
  // guard explicitly so a malformed hash can't crash the request.
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

export function isPasswordStrongEnough(password: string): boolean {
  return password.length >= 8;
}
