import type { Cents } from "@brindle/core";
import { resolveBid } from "./sequencer.js";
import type { BidStream } from "./stream.js";
import type { LotStateStore } from "./store.js";
import type { IncomingBid, LotState, RejectReason, UserId } from "./types.js";

// The durable sequencer. Exactly one worker runs per auction room, draining that
// room's stream in append order and feeding each bid to the pure resolver. Because
// a room has a single consumer and the worker holds the only mutable copy of each
// lot's state (cached below), bid resolution is single-threaded and race-free even
// when bids arrive concurrently at many gateway sockets.
//
// Per accepted bid: resolve -> persist (atomic bid+state) -> broadcast. State is
// never broadcast before it is durable, so a crash can't leave clients ahead of
// the database.

export type SequencerEvent =
  | {
      ok: true;
      lotId: string;
      streamId: string;
      seq: bigint;
      bidderId: UserId;
      priceCents: Cents;
      highBidderId: UserId;
      leadChanged: boolean;
      reserveMet: boolean;
      extended: boolean;
      endsAt: number;
    }
  | {
      ok: false;
      lotId: string;
      streamId: string;
      bidderId: UserId;
      reason: RejectReason | "UNKNOWN_LOT";
    };

export interface Broadcaster {
  publish(roomId: string, event: SequencerEvent): Promise<void>;
}

export interface SequencerWorkerOptions {
  stream: BidStream;
  store: LotStateStore;
  broadcaster: Broadcaster;
  /** How long a read blocks waiting for new entries before looping. */
  blockMs?: number;
}

export class SequencerWorker {
  private readonly stream: BidStream;
  private readonly store: LotStateStore;
  private readonly broadcaster: Broadcaster;
  private readonly blockMs: number;

  // In-memory authoritative copy of each touched lot's state. The worker is the
  // sole writer, so this cache never races the database.
  private readonly states = new Map<string, LotState>();
  private running = false;

  constructor(opts: SequencerWorkerOptions) {
    this.stream = opts.stream;
    this.store = opts.store;
    this.broadcaster = opts.broadcaster;
    this.blockMs = opts.blockMs ?? 5000;
  }

  /**
   * Drain every entry currently available after `cursor`, processing each in
   * order, and return the new cursor. Used directly by tests; the run loop calls
   * it repeatedly. Processing one entry never overlaps another.
   */
  async drain(roomId: string, cursor: string): Promise<string> {
    const entries = await this.stream.read(roomId, cursor, this.blockMs);
    let next = cursor;
    for (const entry of entries) {
      await this.process(roomId, entry.id, entry.bid);
      next = entry.id;
    }
    return next;
  }

  /** Run until stop(), resuming from `startCursor` ("0" replays the whole room). */
  async run(roomId: string, startCursor = "0"): Promise<void> {
    this.running = true;
    let cursor = startCursor;
    while (this.running) {
      cursor = await this.drain(roomId, cursor);
    }
  }

  stop(): void {
    this.running = false;
  }

  private async lotState(lotId: string): Promise<LotState | null> {
    const cached = this.states.get(lotId);
    if (cached) return cached;
    const loaded = await this.store.load(lotId);
    if (loaded) this.states.set(lotId, loaded);
    return loaded;
  }

  private async process(
    roomId: string,
    streamId: string,
    bid: IncomingBid,
  ): Promise<void> {
    const state = await this.lotState(bid.lotId);
    if (!state) {
      await this.broadcaster.publish(roomId, {
        ok: false,
        lotId: bid.lotId,
        streamId,
        bidderId: bid.bidderId,
        reason: "UNKNOWN_LOT",
      });
      return;
    }

    const result = resolveBid(state, bid);

    if (!result.ok) {
      await this.broadcaster.publish(roomId, {
        ok: false,
        lotId: bid.lotId,
        streamId,
        bidderId: bid.bidderId,
        reason: result.reason,
      });
      return;
    }

    // Commit before broadcasting: durability precedes visibility.
    await this.store.persistAccepted(result.state, {
      bid,
      streamId,
      seq: result.seq,
      priceCents: result.priceCents,
      leadChanged: result.leadChanged,
    });
    this.states.set(bid.lotId, result.state);

    await this.broadcaster.publish(roomId, {
      ok: true,
      lotId: bid.lotId,
      streamId,
      seq: result.seq,
      bidderId: bid.bidderId,
      priceCents: result.priceCents,
      highBidderId: result.highBidderId,
      leadChanged: result.leadChanged,
      reserveMet: result.reserveMet,
      extended: result.extended,
      endsAt: result.state.endsAt,
    });
  }
}
