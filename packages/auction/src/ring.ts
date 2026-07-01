import type { Cents } from "@brindle/core";
import type { UserId } from "./types.js";

// The live-ring model, layered on the same single-sequencer discipline as the
// timed engine. An auctioneer drives an "ask" (the price they're calling for);
// bidders — online, floor, or phone — take the ask to become the standing high
// bid. Every mutation is one pure, atomic transition fed by the room's sequencer,
// so the ring is as race-free as the timed path.

export type RingBidKind = "ONLINE" | "FLOOR" | "PHONE";

export interface RingLotState {
  lotId: string;
  highBidderId: UserId | null;
  highBidCents: Cents; // standing (last accepted) price
  askCents: Cents; // price the auctioneer is currently calling for
  minIncrementCents: Cents;
  seq: bigint;
  status: "OPEN" | "SOLD" | "PASSED";
}

export type RingAction =
  // Auctioneer-only:
  | { type: "SET_ASK"; askCents: Cents }
  | { type: "HAMMER" }
  | { type: "PASS" }
  // Bidder / clerk:
  | { type: "TAKE_ASK"; bidderId: UserId; kind: RingBidKind };

export type RingReject =
  | "LOT_NOT_OPEN"
  | "NOT_AUCTIONEER"
  | "ASK_NOT_ABOVE_STANDING"
  | "ALREADY_HIGH_BIDDER"
  | "NO_STANDING_BID";

export type RingResult =
  | {
      ok: true;
      state: RingLotState;
      seq: bigint;
      event:
        | { kind: "ASK_SET"; askCents: Cents }
        | { kind: "TAKEN"; bidderId: UserId; priceCents: Cents; bidKind: RingBidKind; nextAskCents: Cents }
        | { kind: "SOLD"; bidderId: UserId | null; priceCents: Cents }
        | { kind: "PASSED" };
    }
  | { ok: false; reason: RingReject };

/**
 * Pure, atomic resolution of one ring action. `isAuctioneer` gates the control
 * actions (set ask / hammer / pass); take-the-ask is open to bidders and the
 * clerk (who enters floor and phone bids on the ring's behalf).
 */
export function resolveRingAction(
  state: RingLotState,
  action: RingAction,
  isAuctioneer: boolean,
): RingResult {
  if (state.status !== "OPEN") return { ok: false, reason: "LOT_NOT_OPEN" };

  switch (action.type) {
    case "SET_ASK": {
      if (!isAuctioneer) return { ok: false, reason: "NOT_AUCTIONEER" };
      if (action.askCents <= state.highBidCents) {
        return { ok: false, reason: "ASK_NOT_ABOVE_STANDING" };
      }
      const next = { ...state, askCents: action.askCents, seq: state.seq + 1n };
      return { ok: true, state: next, seq: next.seq, event: { kind: "ASK_SET", askCents: action.askCents } };
    }

    case "TAKE_ASK": {
      // Taking the ask when you already hold it would be bidding against yourself.
      if (state.highBidderId === action.bidderId) {
        return { ok: false, reason: "ALREADY_HIGH_BIDDER" };
      }
      const priceCents = state.askCents;
      const nextAskCents = priceCents + state.minIncrementCents;
      const next: RingLotState = {
        ...state,
        highBidderId: action.bidderId,
        highBidCents: priceCents,
        askCents: nextAskCents, // auctioneer's next call auto-advances
        seq: state.seq + 1n,
      };
      return {
        ok: true,
        state: next,
        seq: next.seq,
        event: { kind: "TAKEN", bidderId: action.bidderId, priceCents, bidKind: action.kind, nextAskCents },
      };
    }

    case "HAMMER": {
      if (!isAuctioneer) return { ok: false, reason: "NOT_AUCTIONEER" };
      if (state.highBidderId === null) return { ok: false, reason: "NO_STANDING_BID" };
      const next = { ...state, status: "SOLD" as const, seq: state.seq + 1n };
      return {
        ok: true,
        state: next,
        seq: next.seq,
        event: { kind: "SOLD", bidderId: state.highBidderId, priceCents: state.highBidCents },
      };
    }

    case "PASS": {
      if (!isAuctioneer) return { ok: false, reason: "NOT_AUCTIONEER" };
      const next = { ...state, status: "PASSED" as const, seq: state.seq + 1n };
      return { ok: true, state: next, seq: next.seq, event: { kind: "PASSED" } };
    }
  }
}
