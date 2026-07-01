import { describe, it, expect } from "vitest";
import { estimateContract, settleContractAtDelivery, type ForwardContractTerms } from "./contract.js";

const terms: ForwardContractTerms = {
  basePriceCentsPerCwt: 18_500n, // $185.00/cwt
  baseWeightLbs: 850,
  slideCentsPerLb: 10, // 10c/cwt off per lb over base
  shrinkPct: 2,
  head: 60,
  buyerPremiumBps: 0,
  techFeeCents: 25_000n, // $250 flat tech fee
  deliveryWindow: { start: "2026-10-01", end: "2026-10-15" },
};

describe("estimateContract — value at base weight", () => {
  it("prices at base with pencil shrink applied", () => {
    const s = estimateContract(terms);
    // pay weight = 850 * 0.98 = 833 lb, under base -> no slide
    expect(s.payWeightPerHeadLbs).toBeCloseTo(833);
    expect(s.adjustedPriceCentsPerCwt).toBe(18_500n);
    // 8.33 cwt * $185 * 60 head = $92,463.00
    expect(s.subtotalCents).toBe(9_246_300n);
    expect(s.buyerPayableCents).toBe(9_246_300n);
    expect(s.platformTechFeeCents).toBe(25_000n);
  });
});

describe("settleContractAtDelivery — slide on heavy cattle", () => {
  it("slides the price down when pay weight exceeds base", () => {
    // scale 900 lb -> pay 882 lb, 32 lb over base -> 320c/cwt off = $3.20/cwt
    const s = settleContractAtDelivery(terms, 900);
    expect(s.payWeightPerHeadLbs).toBeCloseTo(882);
    expect(s.adjustedPriceCentsPerCwt).toBe(18_500n - 320n); // $181.80/cwt
  });

  it("applies no slide when cattle come in at or under base", () => {
    const s = settleContractAtDelivery(terms, 850); // pay 833, under base
    expect(s.adjustedPriceCentsPerCwt).toBe(18_500n);
  });

  it("never lets the slide drive the price below zero", () => {
    const extreme = { ...terms, slideCentsPerLb: 100_000 };
    const s = settleContractAtDelivery(extreme, 1200);
    expect(s.adjustedPriceCentsPerCwt).toBe(0n);
    expect(s.subtotalCents).toBe(0n);
  });

  it("adds buyer premium on top of seller proceeds", () => {
    const withPrem = { ...terms, buyerPremiumBps: 200 }; // 2%
    const s = settleContractAtDelivery(withPrem, 850);
    expect(s.buyerPremiumCents).toBe(184_926n); // 2% of $92,463.00
    expect(s.buyerPayableCents).toBe(s.subtotalCents + s.buyerPremiumCents);
  });
});
