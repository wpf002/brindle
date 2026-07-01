import { describe, it, expect } from "vitest";
import { resolveRingAction, type RingLotState } from "./ring.js";

function ring(overrides: Partial<RingLotState> = {}): RingLotState {
  return {
    lotId: "lot-1",
    highBidderId: null,
    highBidCents: 100_000n, // opening $1,000
    askCents: 110_000n, // auctioneer asking $1,100
    minIncrementCents: 10_000n, // $100 raises
    seq: 0n,
    status: "OPEN",
    ...overrides,
  };
}

describe("SET_ASK (auctioneer control)", () => {
  it("sets the ask above the standing price", () => {
    const r = resolveRingAction(ring(), { type: "SET_ASK", askCents: 120_000n }, true);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.askCents).toBe(120_000n);
    expect(r.event).toEqual({ kind: "ASK_SET", askCents: 120_000n });
  });

  it("rejects a non-auctioneer", () => {
    const r = resolveRingAction(ring(), { type: "SET_ASK", askCents: 120_000n }, false);
    expect(r).toEqual({ ok: false, reason: "NOT_AUCTIONEER" });
  });

  it("rejects an ask at or below the standing price", () => {
    const r = resolveRingAction(ring({ highBidCents: 120_000n }), { type: "SET_ASK", askCents: 120_000n }, true);
    expect(r).toEqual({ ok: false, reason: "ASK_NOT_ABOVE_STANDING" });
  });
});

describe("TAKE_ASK (online / floor / phone)", () => {
  it("makes the taker the high bidder at the ask and advances the next ask", () => {
    const r = resolveRingAction(ring(), { type: "TAKE_ASK", bidderId: "buyer-A", kind: "ONLINE" }, false);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.highBidderId).toBe("buyer-A");
    expect(r.state.highBidCents).toBe(110_000n);
    expect(r.state.askCents).toBe(120_000n); // advanced by one increment
    expect(r.event).toMatchObject({ kind: "TAKEN", priceCents: 110_000n, nextAskCents: 120_000n });
  });

  it("records the bid channel (floor / phone entered by the clerk)", () => {
    const r = resolveRingAction(ring(), { type: "TAKE_ASK", bidderId: "floor-7", kind: "FLOOR" }, false);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event).toMatchObject({ kind: "TAKEN", bidKind: "FLOOR" });
  });

  it("won't let the standing high bidder take their own ask", () => {
    const r = resolveRingAction(
      ring({ highBidderId: "buyer-A", highBidCents: 110_000n, askCents: 120_000n }),
      { type: "TAKE_ASK", bidderId: "buyer-A", kind: "ONLINE" },
      false,
    );
    expect(r).toEqual({ ok: false, reason: "ALREADY_HIGH_BIDDER" });
  });

  it("lets a competing bidder take the advanced ask (a bidding war)", () => {
    let s = ring();
    const a = resolveRingAction(s, { type: "TAKE_ASK", bidderId: "A", kind: "ONLINE" }, false);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    s = a.state; // A at 110k, ask 120k
    const b = resolveRingAction(s, { type: "TAKE_ASK", bidderId: "B", kind: "FLOOR" }, false);
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    expect(b.state.highBidderId).toBe("B");
    expect(b.state.highBidCents).toBe(120_000n);
    expect(b.state.askCents).toBe(130_000n);
  });
});

describe("HAMMER / PASS", () => {
  it("hammers the lot sold to the standing high bidder", () => {
    const s = ring({ highBidderId: "buyer-B", highBidCents: 130_000n });
    const r = resolveRingAction(s, { type: "HAMMER" }, true);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.status).toBe("SOLD");
    expect(r.event).toEqual({ kind: "SOLD", bidderId: "buyer-B", priceCents: 130_000n });
  });

  it("won't hammer with no bid on the board", () => {
    const r = resolveRingAction(ring(), { type: "HAMMER" }, true);
    expect(r).toEqual({ ok: false, reason: "NO_STANDING_BID" });
  });

  it("passes an unsold lot", () => {
    const r = resolveRingAction(ring(), { type: "PASS" }, true);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.status).toBe("PASSED");
  });

  it("rejects any action on a closed lot", () => {
    const r = resolveRingAction(ring({ status: "SOLD" }), { type: "TAKE_ASK", bidderId: "C", kind: "ONLINE" }, false);
    expect(r).toEqual({ ok: false, reason: "LOT_NOT_OPEN" });
  });
});

describe("sequence numbers", () => {
  it("increments on every accepted action", () => {
    const r = resolveRingAction(ring({ seq: 5n }), { type: "SET_ASK", askCents: 120_000n }, true);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.seq).toBe(6n);
  });
});
