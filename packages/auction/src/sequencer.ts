import type { Cents } from "@brindle/core";
import type { BidResult, IncomingBid, LotState } from "./types.js";

const min = (a: Cents, b: Cents): Cents => (a < b ? a : b);

/**
 * Pure, deterministic bid resolution. Exactly one call site per lot — the
 * per-room sequencer consumer — feeds events in receive order. No I/O here;
 * the worker persists the returned state and broadcasts the price.
 *
 * Locked invariants (ported from Crossbar):
 *   - integer cents only
 *   - FIFO price-time priority (ties go to the resting bid)
 *   - atomic: returns a fully-applied new state, or a rejection
 *
 * Implements eBay-style proxy/max bidding: the standing price rises only as
 * far as needed to settle the contest, while each bidder's ceiling stays hidden.
 */
export function resolveBid(state: LotState, bid: IncomingBid): BidResult {
  if (state.closed) return { ok: false, reason: "LOT_CLOSED" };
  if (!bid.creditApproved) return { ok: false, reason: "NOT_CREDIT_APPROVED" };
  if (bid.bidderId === bid.sellerId) return { ok: false, reason: "SELF_BID" };

  const inc = state.minIncrementCents;
  const ceiling = bid.proxyMaxCents ?? bid.amountCents;

  const next: LotState = { ...state };
  let leadChanged = false;

  if (state.highBidderId === null) {
    // first bid: must meet the starting price (held in highBidCents)
    const floor = state.highBidCents;
    if (ceiling < floor) return { ok: false, reason: "BELOW_MIN_INCREMENT" };
    next.highBidderId = bid.bidderId;
    next.highBidCents = floor;
    next.proxyMaxCents = ceiling;
    leadChanged = true;
  } else if (state.highBidderId === bid.bidderId) {
    // current leader raising their own ceiling — price does not move
    const curMax = state.proxyMaxCents ?? state.highBidCents;
    if (ceiling <= curMax) return { ok: false, reason: "BELOW_MIN_INCREMENT" };
    next.proxyMaxCents = ceiling;
  } else {
    // a different bidder challenges
    const curMax = state.proxyMaxCents ?? state.highBidCents;
    if (ceiling < state.highBidCents + inc) {
      return { ok: false, reason: "BELOW_MIN_INCREMENT" };
    }
    if (ceiling > curMax) {
      // challenger wins; price settles just over the old ceiling, capped at challenger ceiling
      next.highBidderId = bid.bidderId;
      next.highBidCents = min(ceiling, curMax + inc);
      next.proxyMaxCents = ceiling;
      leadChanged = true;
    } else {
      // resting proxy holds (ties included); price climbs to just over the challenger
      next.highBidCents = min(curMax, ceiling + inc);
      // leader + their ceiling unchanged
    }
  }

  next.seq = state.seq + 1n;
  const extended = maybeSoftClose(next, bid.receivedAt);

  return {
    ok: true,
    state: next,
    seq: next.seq,
    highBidderId: next.highBidderId!,
    priceCents: next.highBidCents,
    leadChanged,
    reserveMet: reserveMet(next),
    extended,
  };
}

/**
 * Anti-snipe: a bid inside the final softCloseSecs pushes the lot end out so
 * the close window reopens. Table stakes for this buyer base.
 */
function maybeSoftClose(state: LotState, nowMs: number): boolean {
  if (state.softCloseSecs <= 0 || state.endsAt <= 0) return false;
  const windowMs = state.softCloseSecs * 1000;
  if (state.endsAt - nowMs <= windowMs) {
    state.endsAt = nowMs + windowMs;
    return true;
  }
  return false;
}

export function reserveMet(state: LotState): boolean {
  return state.reserveCents === null || state.highBidCents >= state.reserveCents;
}
