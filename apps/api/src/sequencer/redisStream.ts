import type Redis from "ioredis";
import type { BidStream, IncomingBid, StreamEntry } from "@brindle/auction";
import { stringify, parse } from "./json.js";

// Redis-stream implementation of the auction ingest log. XADD appends in a total
// order; XREAD BLOCK lets the single consumer tail new entries efficiently. The
// stream id Redis assigns IS the sequencer's FIFO order — race-resolved once, here.
export class RedisBidStream implements BidStream {
  constructor(private readonly redis: Redis) {}

  private key(roomId: string): string {
    return `auction:${roomId}:bids`;
  }

  async add(roomId: string, bid: IncomingBid): Promise<string> {
    const id = await this.redis.xadd(this.key(roomId), "*", "bid", stringify(bid));
    return id ?? "";
  }

  async read(roomId: string, afterId: string, blockMs: number): Promise<StreamEntry[]> {
    // afterId "0" reads from the start (replay); any other id reads strictly after it.
    const res = (await this.redis.xread(
      "BLOCK",
      blockMs,
      "STREAMS",
      this.key(roomId),
      afterId,
    )) as [string, [string, string[]][]][] | null;

    if (!res || res.length === 0) return [];
    const [, entries] = res[0]!;
    return entries.map(([id, fields]) => {
      // fields are flat [name, value, ...]; we only ever write the "bid" field.
      const idx = fields.indexOf("bid");
      const raw = idx >= 0 ? fields[idx + 1]! : "{}";
      return { id, bid: parse<IncomingBid>(raw) };
    });
  }
}
