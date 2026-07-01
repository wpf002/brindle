import Redis from "ioredis";
import {
  RingWorker,
  type RingActionEnvelope,
  type RingBroadcaster,
  type RingBroadcastEvent,
  type RingStateStore,
} from "@brindle/auction";
import { RedisRingStream } from "./redisStream.js";
import { stringify, parse } from "../sequencer/json.js";

const eventsChannel = (roomId: string) => `ring:${roomId}:events`;
const cursorKey = (roomId: string) => `ring:${roomId}:cursor`;

class RedisRingBroadcaster implements RingBroadcaster {
  constructor(private readonly pub: Redis) {}
  async publish(roomId: string, event: RingBroadcastEvent): Promise<void> {
    await this.pub.publish(eventsChannel(roomId), stringify(event));
  }
}

// One live-ring worker per room, cursor persisted for restart resume. Mirrors the
// bid SequencerManager — same single-consumer discipline, different resolver.
export class RingManager {
  private readonly pub: Redis;
  private readonly ctrl: Redis;
  private readonly broadcaster: RedisRingBroadcaster;
  private readonly loops = new Map<string, { running: boolean; conn: Redis }>();

  constructor(
    private readonly redisUrl: string,
    private readonly store: RingStateStore,
    private readonly blockMs = 5000,
  ) {
    this.pub = new Redis(redisUrl);
    this.ctrl = new Redis(redisUrl);
    this.broadcaster = new RedisRingBroadcaster(this.pub);
  }

  ensure(roomId: string): void {
    if (this.loops.has(roomId)) return;
    const conn = new Redis(this.redisUrl);
    const loop = { running: true, conn };
    this.loops.set(roomId, loop);
    const worker = new RingWorker({
      stream: new RedisRingStream(conn),
      store: this.store,
      broadcaster: this.broadcaster,
      blockMs: this.blockMs,
    });
    void (async () => {
      let cursor = (await this.ctrl.get(cursorKey(roomId))) ?? "0";
      while (loop.running) {
        try {
          const next = await worker.drain(roomId, cursor);
          if (next !== cursor) {
            cursor = next;
            await this.ctrl.set(cursorKey(roomId), cursor);
          }
        } catch {
          if (!loop.running) break;
          await new Promise((r) => setTimeout(r, 250));
        }
      }
    })();
  }

  async submit(roomId: string, envelope: RingActionEnvelope): Promise<string> {
    this.ensure(roomId);
    return new RedisRingStream(this.pub).add(roomId, envelope);
  }

  async subscribe(roomId: string, onEvent: (e: RingBroadcastEvent) => void): Promise<() => Promise<void>> {
    const sub = new Redis(this.redisUrl);
    const channel = eventsChannel(roomId);
    sub.on("message", (ch, msg) => {
      if (ch === channel) onEvent(parse<RingBroadcastEvent>(msg));
    });
    await sub.subscribe(channel);
    return async () => {
      await sub.unsubscribe(channel);
      sub.disconnect();
    };
  }

  async shutdown(): Promise<void> {
    for (const loop of this.loops.values()) {
      loop.running = false;
      loop.conn.disconnect();
    }
    this.loops.clear();
    this.pub.disconnect();
    this.ctrl.disconnect();
  }
}
