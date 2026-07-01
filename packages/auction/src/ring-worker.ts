import { resolveRingAction } from "./ring.js";
import type { RingAction, RingLotState, RingResult } from "./ring.js";
import type { UserId } from "./types.js";

// Durable live-ring sequencer. Same single-writer discipline as the bid worker:
// one consumer per room drains an ordered action stream, applies each action to
// the pure ring resolver, persists, then broadcasts. Auctioneer authority
// (`isAuctioneer`) is stamped by the gateway from the session, never the client.

export interface RingActionEnvelope {
  lotId: string;
  action: RingAction;
  isAuctioneer: boolean;
  actorId: UserId;
}

export interface RingActionEntry {
  id: string;
  envelope: RingActionEnvelope;
}

export interface RingActionStream {
  add(roomId: string, envelope: RingActionEnvelope): Promise<string>;
  read(roomId: string, afterId: string, blockMs: number): Promise<RingActionEntry[]>;
}

export interface RingPersist {
  streamId: string;
  actorId: UserId;
  result: Extract<RingResult, { ok: true }>;
}

export interface RingStateStore {
  load(lotId: string): Promise<RingLotState | null>;
  persist(state: RingLotState, persist: RingPersist): Promise<void>;
}

export type RingBroadcastEvent =
  | ({ ok: true; lotId: string; streamId: string; seq: bigint } & Extract<RingResult, { ok: true }>["event"])
  | { ok: false; lotId: string; streamId: string; actorId: UserId; reason: string };

export interface RingBroadcaster {
  publish(roomId: string, event: RingBroadcastEvent): Promise<void>;
}

export interface RingWorkerOptions {
  stream: RingActionStream;
  store: RingStateStore;
  broadcaster: RingBroadcaster;
  blockMs?: number;
}

export class RingWorker {
  private readonly stream: RingActionStream;
  private readonly store: RingStateStore;
  private readonly broadcaster: RingBroadcaster;
  private readonly blockMs: number;
  private readonly states = new Map<string, RingLotState>();
  private running = false;

  constructor(opts: RingWorkerOptions) {
    this.stream = opts.stream;
    this.store = opts.store;
    this.broadcaster = opts.broadcaster;
    this.blockMs = opts.blockMs ?? 5000;
  }

  async drain(roomId: string, cursor: string): Promise<string> {
    const entries = await this.stream.read(roomId, cursor, this.blockMs);
    let next = cursor;
    for (const entry of entries) {
      await this.process(roomId, entry);
      next = entry.id;
    }
    return next;
  }

  async run(roomId: string, startCursor = "0"): Promise<void> {
    this.running = true;
    let cursor = startCursor;
    while (this.running) cursor = await this.drain(roomId, cursor);
  }

  stop(): void {
    this.running = false;
  }

  private async lotState(lotId: string): Promise<RingLotState | null> {
    const cached = this.states.get(lotId);
    if (cached) return cached;
    const loaded = await this.store.load(lotId);
    if (loaded) this.states.set(lotId, loaded);
    return loaded;
  }

  private async process(roomId: string, entry: RingActionEntry): Promise<void> {
    const { lotId, action, isAuctioneer, actorId } = entry.envelope;
    const state = await this.lotState(lotId);
    if (!state) {
      await this.broadcaster.publish(roomId, {
        ok: false, lotId, streamId: entry.id, actorId, reason: "UNKNOWN_LOT",
      });
      return;
    }

    const result = resolveRingAction(state, action, isAuctioneer);
    if (!result.ok) {
      await this.broadcaster.publish(roomId, {
        ok: false, lotId, streamId: entry.id, actorId, reason: result.reason,
      });
      return;
    }

    await this.store.persist(result.state, { streamId: entry.id, actorId, result });
    this.states.set(lotId, result.state);
    await this.broadcaster.publish(roomId, {
      ok: true, lotId, streamId: entry.id, seq: result.seq, ...result.event,
    });
  }
}

// In-memory impls for tests.
export class InMemoryRingStream implements RingActionStream {
  private rooms = new Map<string, RingActionEntry[]>();
  async add(roomId: string, envelope: RingActionEnvelope): Promise<string> {
    const entries = this.rooms.get(roomId) ?? [];
    const id = String(entries.length + 1).padStart(12, "0");
    entries.push({ id, envelope });
    this.rooms.set(roomId, entries);
    return id;
  }
  async read(roomId: string, afterId: string): Promise<RingActionEntry[]> {
    return (this.rooms.get(roomId) ?? []).filter((e) => e.id > afterId);
  }
}

export class InMemoryRingStore implements RingStateStore {
  readonly states = new Map<string, RingLotState>();
  readonly persisted: RingPersist[] = [];
  constructor(seed: RingLotState[] = []) {
    for (const s of seed) this.states.set(s.lotId, { ...s });
  }
  async load(lotId: string): Promise<RingLotState | null> {
    const s = this.states.get(lotId);
    return s ? { ...s } : null;
  }
  async persist(state: RingLotState, persist: RingPersist): Promise<void> {
    this.states.set(state.lotId, { ...state });
    this.persisted.push(persist);
  }
}
