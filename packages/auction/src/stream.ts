import type { IncomingBid } from "./types.js";

// The bid stream is the ingest log for an auction room. The gateway appends
// bids (XADD); the single sequencer consumer reads them in append order. Stream
// order — not wall-clock — is the authoritative FIFO sequence, so two bids that
// race at the socket are still totally ordered by the time they reach resolveBid.
//
// This interface is what the worker depends on. apps/api supplies a Redis-stream
// implementation; tests supply an in-memory one. Same ordering guarantee either way.

export interface StreamEntry {
  id: string; // monotonic, lexicographically sortable within a room
  bid: IncomingBid;
}

export interface BidStream {
  /** Append a bid to a room's stream; returns the assigned entry id. */
  add(roomId: string, bid: IncomingBid): Promise<string>;
  /**
   * Read entries appended after `afterId`, blocking up to `blockMs` for at least
   * one. Returns [] on timeout. Pass "0" to read a room from the beginning
   * (replay). Entries come back in append order.
   */
  read(roomId: string, afterId: string, blockMs: number): Promise<StreamEntry[]>;
}

/** Deterministic in-memory stream for tests. Ids are zero-padded append indices. */
export class InMemoryBidStream implements BidStream {
  private rooms = new Map<string, StreamEntry[]>();

  async add(roomId: string, bid: IncomingBid): Promise<string> {
    const entries = this.rooms.get(roomId) ?? [];
    const id = String(entries.length + 1).padStart(12, "0");
    entries.push({ id, bid });
    this.rooms.set(roomId, entries);
    return id;
  }

  async read(roomId: string, afterId: string): Promise<StreamEntry[]> {
    const entries = this.rooms.get(roomId) ?? [];
    return entries.filter((e) => e.id > afterId);
  }
}
