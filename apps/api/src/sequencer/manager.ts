import Redis from "ioredis";
import {
  SequencerWorker,
  type Broadcaster,
  type LotStateStore,
  type SequencerEvent,
} from "@brindle/auction";
import { RedisBidStream } from "./redisStream.js";
import { stringify, parse } from "./json.js";

const eventsChannel = (roomId: string) => `auction:${roomId}:events`;
const cursorKey = (roomId: string) => `auction:${roomId}:cursor`;

// Fan accepted/rejected results out to every gateway subscribed to the room.
export class RedisBroadcaster implements Broadcaster {
  constructor(private readonly pub: Redis) {}
  async publish(roomId: string, event: SequencerEvent): Promise<void> {
    await this.pub.publish(eventsChannel(roomId), stringify(event));
  }
}

interface RoomLoop {
  running: boolean;
  streamConn: Redis;
}

// Owns the lifecycle of the per-room sequencer workers. Exactly one drain loop
// runs per room; its cursor is persisted in Redis so a restart resumes where it
// left off (and idempotent persistence covers the crash-before-cursor-write gap).
export class SequencerManager {
  private readonly pub: Redis;
  private readonly ctrl: Redis; // cursor get/set; non-blocking
  private readonly broadcaster: RedisBroadcaster;
  private readonly loops = new Map<string, RoomLoop>();

  constructor(
    private readonly redisUrl: string,
    private readonly store: LotStateStore,
    private readonly blockMs = 5000,
  ) {
    this.pub = new Redis(redisUrl);
    this.ctrl = new Redis(redisUrl);
    this.broadcaster = new RedisBroadcaster(this.pub);
  }

  /** Idempotently start the drain loop for a room. */
  ensure(roomId: string): void {
    if (this.loops.has(roomId)) return;

    const streamConn = new Redis(this.redisUrl); // dedicated: XREAD BLOCK holds it
    const loop: RoomLoop = { running: true, streamConn };
    this.loops.set(roomId, loop);

    const worker = new SequencerWorker({
      stream: new RedisBidStream(streamConn),
      store: this.store,
      broadcaster: this.broadcaster,
      blockMs: this.blockMs,
    });

    void this.drainForever(roomId, worker, loop);
  }

  private async drainForever(
    roomId: string,
    worker: SequencerWorker,
    loop: RoomLoop,
  ): Promise<void> {
    let cursor = (await this.ctrl.get(cursorKey(roomId))) ?? "0";
    while (loop.running) {
      try {
        const next = await worker.drain(roomId, cursor);
        if (next !== cursor) {
          cursor = next;
          await this.ctrl.set(cursorKey(roomId), cursor);
        }
      } catch (err) {
        if (!loop.running) break;
        // Transient Redis/DB hiccup — back off briefly and resume from the same
        // cursor. Idempotent persistence makes re-draining safe.
        await new Promise((r) => setTimeout(r, 250));
        void err;
      }
    }
  }

  /** Append a bid to a room's ingest stream from the gateway. */
  async submit(roomId: string, bid: Parameters<RedisBidStream["add"]>[1]): Promise<string> {
    this.ensure(roomId);
    return new RedisBidStream(this.pub).add(roomId, bid);
  }

  /** Subscribe a gateway socket to a room's events; returns an unsubscribe fn. */
  async subscribe(
    roomId: string,
    onEvent: (event: SequencerEvent) => void,
  ): Promise<() => Promise<void>> {
    const sub = new Redis(this.redisUrl);
    const channel = eventsChannel(roomId);
    sub.on("message", (ch, msg) => {
      if (ch === channel) onEvent(parse<SequencerEvent>(msg));
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
      loop.streamConn.disconnect();
    }
    this.loops.clear();
    this.pub.disconnect();
    this.ctrl.disconnect();
  }
}
