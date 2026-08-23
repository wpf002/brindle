import type Redis from "ioredis";
import { randomUUID } from "node:crypto";

// Single-holder lock so scheduled work runs exactly once across a multi-instance
// deploy. `SET key token NX PX ttl` is atomic, and release compares the token
// before deleting so a slow holder whose lease already expired can't delete the
// lock a different instance now owns.
export async function withLock<T>(
  redis: Redis,
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T | null> {
  const token = randomUUID();
  const acquired = await redis.set(key, token, "PX", ttlMs, "NX");
  if (acquired !== "OK") return null; // someone else holds it; skip this tick

  try {
    return await fn();
  } finally {
    // Compare-and-delete, so we only ever release our own lease.
    await redis.eval(
      `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
      1,
      key,
      token,
    );
  }
}
