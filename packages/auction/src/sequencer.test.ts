import { describe, it, expect } from "vitest";
import { resolveBid, reserveMet } from "./sequencer.js";
import type { IncomingBid, LotState } from "./types.js";

const NOW = 1_700_000_000_000; // fixed epoch so soft-close math is deterministic

function lot(overrides: Partial<LotState> = {}): LotState {
  return {
    lotId: "lot-1",
    highBidderId: null,
    highBidCents: 1_000n, // starting price until the first bid lands
    proxyMaxCents: null,
    reserveCents: null,
    minIncrementCents: 100n,
    endsAt: 0, // 0 = no timed close (live ring); set per soft-close test
    softCloseSecs: 0,
    seq: 0n,
    closed: false,
    ...overrides,
  };
}

function bid(overrides: Partial<IncomingBid> = {}): IncomingBid {
  return {
    lotId: "lot-1",
    bidderId: "buyer-A",
    amountCents: 1_000n,
    creditApproved: true,
    sellerId: "seller-Z",
    receivedAt: NOW,
    ...overrides,
  };
}

describe("gatekeeping rejections", () => {
  it("rejects a bid on a closed lot", () => {
    const r = resolveBid(lot({ closed: true }), bid());
    expect(r).toEqual({ ok: false, reason: "LOT_CLOSED" });
  });

  it("rejects a bidder without approved credit", () => {
    const r = resolveBid(lot(), bid({ creditApproved: false }));
    expect(r).toEqual({ ok: false, reason: "NOT_CREDIT_APPROVED" });
  });

  it("rejects a seller bidding on their own lot", () => {
    const r = resolveBid(lot(), bid({ bidderId: "seller-Z" }));
    expect(r).toEqual({ ok: false, reason: "SELF_BID" });
  });
});

describe("first bid", () => {
  it("accepts at the starting price and sets the leader", () => {
    const r = resolveBid(lot(), bid({ amountCents: 1_000n }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.highBidderId).toBe("buyer-A");
    expect(r.priceCents).toBe(1_000n); // settles at the floor, not the ceiling
    expect(r.state.proxyMaxCents).toBe(1_000n);
    expect(r.leadChanged).toBe(true);
    expect(r.seq).toBe(1n);
  });

  it("hides the proxy ceiling — price stays at the floor", () => {
    const r = resolveBid(lot(), bid({ amountCents: 1_000n, proxyMaxCents: 9_000n }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.priceCents).toBe(1_000n);
    expect(r.state.proxyMaxCents).toBe(9_000n);
  });

  it("rejects a first bid below the starting price", () => {
    const r = resolveBid(lot(), bid({ amountCents: 500n }));
    expect(r).toEqual({ ok: false, reason: "BELOW_MIN_INCREMENT" });
  });
});

describe("leader raising their own ceiling", () => {
  const resting = lot({
    highBidderId: "buyer-A",
    highBidCents: 1_000n,
    proxyMaxCents: 3_000n,
  });

  it("raises the hidden ceiling without moving the price", () => {
    const r = resolveBid(resting, bid({ bidderId: "buyer-A", proxyMaxCents: 5_000n }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.priceCents).toBe(1_000n); // unchanged
    expect(r.state.proxyMaxCents).toBe(5_000n);
    expect(r.leadChanged).toBe(false);
  });

  it("rejects lowering or matching the existing ceiling", () => {
    const r = resolveBid(resting, bid({ bidderId: "buyer-A", proxyMaxCents: 3_000n }));
    expect(r).toEqual({ ok: false, reason: "BELOW_MIN_INCREMENT" });
  });
});

describe("a challenger contests the resting proxy", () => {
  // resting leader A holds a hidden ceiling of 5_000, standing price 1_000
  const resting = lot({
    highBidderId: "buyer-A",
    highBidCents: 1_000n,
    proxyMaxCents: 5_000n,
  });

  it("loses to the resting proxy but pushes the price up just over its bid", () => {
    const r = resolveBid(resting, bid({ bidderId: "buyer-B", amountCents: 3_000n }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.highBidderId).toBe("buyer-A"); // resting proxy holds
    expect(r.priceCents).toBe(3_100n); // climbs to challenger + increment
    expect(r.leadChanged).toBe(false);
    expect(r.state.proxyMaxCents).toBe(5_000n); // A's ceiling untouched
  });

  it("takes the lead when it outbids the resting ceiling", () => {
    const r = resolveBid(resting, bid({ bidderId: "buyer-B", amountCents: 6_000n }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.highBidderId).toBe("buyer-B");
    expect(r.priceCents).toBe(5_100n); // settles just over the beaten ceiling
    expect(r.leadChanged).toBe(true);
    expect(r.state.proxyMaxCents).toBe(6_000n);
  });

  it("never settles above the new leader's own ceiling", () => {
    // challenger ceiling sits between resting ceiling and resting+inc
    const r = resolveBid(resting, bid({ bidderId: "buyer-B", amountCents: 5_050n }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.highBidderId).toBe("buyer-B");
    expect(r.priceCents).toBe(5_050n); // capped at challenger ceiling, not 5_100
  });

  it("rejects a challenge below standing price + increment", () => {
    const r = resolveBid(resting, bid({ bidderId: "buyer-B", amountCents: 1_050n }));
    expect(r).toEqual({ ok: false, reason: "BELOW_MIN_INCREMENT" });
  });

  it("breaks ties in favor of the resting bid (FIFO price-time priority)", () => {
    // challenger ceiling EQUALS the resting ceiling -> resting must keep the lead
    const r = resolveBid(resting, bid({ bidderId: "buyer-B", amountCents: 5_000n }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.highBidderId).toBe("buyer-A");
    expect(r.priceCents).toBe(5_000n); // capped at the resting ceiling
    expect(r.leadChanged).toBe(false);
  });
});

describe("reserve", () => {
  it("reports reserve unmet while the price is below it", () => {
    const r = resolveBid(
      lot({ reserveCents: 2_000n }),
      bid({ amountCents: 1_000n }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.reserveMet).toBe(false);
  });

  it("reports reserve met once the price reaches it", () => {
    expect(reserveMet(lot({ highBidCents: 2_000n, reserveCents: 2_000n }))).toBe(true);
  });

  it("treats a null reserve as always met", () => {
    expect(reserveMet(lot({ reserveCents: null }))).toBe(true);
  });
});

describe("anti-snipe soft close", () => {
  it("extends the close when a bid lands inside the window", () => {
    const state = lot({ endsAt: NOW + 5_000, softCloseSecs: 120 });
    const r = resolveBid(state, bid({ receivedAt: NOW }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.extended).toBe(true);
    expect(r.state.endsAt).toBe(NOW + 120_000); // pushed out a full window
  });

  it("does not extend a bid outside the window", () => {
    const state = lot({ endsAt: NOW + 300_000, softCloseSecs: 120 });
    const r = resolveBid(state, bid({ receivedAt: NOW }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.extended).toBe(false);
    expect(r.state.endsAt).toBe(NOW + 300_000); // untouched
  });

  it("never extends when soft close is disabled", () => {
    const state = lot({ endsAt: NOW + 1_000, softCloseSecs: 0 });
    const r = resolveBid(state, bid({ receivedAt: NOW }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.extended).toBe(false);
  });
});

describe("sequence numbers", () => {
  it("increments monotonically on each accepted bid", () => {
    const s0 = lot({ seq: 41n });
    const r = resolveBid(s0, bid());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.seq).toBe(42n);
    expect(r.state.seq).toBe(42n);
  });

  it("does not mutate the input state (atomic new-state return)", () => {
    const s0 = lot();
    const before = { ...s0 };
    resolveBid(s0, bid());
    expect(s0).toEqual(before); // caller's state object is untouched
  });
});
