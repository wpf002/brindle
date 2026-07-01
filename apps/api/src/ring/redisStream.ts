import type Redis from "ioredis";
import type { RingActionStream, RingActionEnvelope, RingActionEntry } from "@brindle/auction";
import { stringify, parse } from "../sequencer/json.js";

// Redis-stream ingest for live-ring actions (set ask / take / hammer / pass).
export class RedisRingStream implements RingActionStream {
  constructor(private readonly redis: Redis) {}
  private key(roomId: string): string {
    return `ring:${roomId}:actions`;
  }
  async add(roomId: string, envelope: RingActionEnvelope): Promise<string> {
    const id = await this.redis.xadd(this.key(roomId), "*", "a", stringify(envelope));
    return id ?? "";
  }
  async read(roomId: string, afterId: string, blockMs: number): Promise<RingActionEntry[]> {
    const res = (await this.redis.xread(
      "BLOCK", blockMs, "STREAMS", this.key(roomId), afterId,
    )) as [string, [string, string[]][]][] | null;
    if (!res || res.length === 0) return [];
    const [, entries] = res[0]!;
    return entries.map(([id, fields]) => {
      const idx = fields.indexOf("a");
      return { id, envelope: parse<RingActionEnvelope>(idx >= 0 ? fields[idx + 1]! : "{}") };
    });
  }
}
