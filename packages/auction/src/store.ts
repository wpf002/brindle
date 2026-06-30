import type { Cents } from "@brindle/core";
import type { IncomingBid, LotState } from "./types.js";

// Durable home for lot state and the immutable bid log. The worker is the ONLY
// writer (single-writer invariant); other services read. `persistAccepted` must
// be atomic — the accepted bid row and the new lot state commit together, or
// neither does — so a crash can never leave a price without its bid or vice versa.

export interface AcceptedBid {
  bid: IncomingBid;
  streamId: string; // ties the durable bid row back to its stream entry
  seq: bigint; // sequencer-assigned, monotonic per lot
  priceCents: Cents; // standing price after this bid
  leadChanged: boolean;
}

export interface LotStateStore {
  /**
   * Current authoritative state for a lot, seeded from lot config if no bids
   * have landed yet. Returns null if the lot is unknown or not biddable.
   */
  load(lotId: string): Promise<LotState | null>;
  /** Atomically append the accepted bid and persist the resulting lot state. */
  persistAccepted(state: LotState, accepted: AcceptedBid): Promise<void>;
}

/** In-memory store for tests: seed it with starting lot states, inspect after. */
export class InMemoryLotStateStore implements LotStateStore {
  readonly states = new Map<string, LotState>();
  readonly log: AcceptedBid[] = [];

  constructor(seed: LotState[] = []) {
    for (const s of seed) this.states.set(s.lotId, { ...s });
  }

  async load(lotId: string): Promise<LotState | null> {
    const s = this.states.get(lotId);
    return s ? { ...s } : null;
  }

  async persistAccepted(state: LotState, accepted: AcceptedBid): Promise<void> {
    this.states.set(state.lotId, { ...state });
    this.log.push(accepted);
  }
}
