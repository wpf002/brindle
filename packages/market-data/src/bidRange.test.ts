import { describe, it, expect } from "vitest";
import { estimateBidRange, rangeToLotTotal, type HammerComp } from "./bidRange.js";
import type { ComparableSale } from "./index.js";

const ASOF = "2026-08-25";

function usda(over: Partial<ComparableSale> = {}): ComparableSale {
  return {
    reportDate: "2026-08-24",
    region: "KS",
    category: "FEEDER STEERS",
    weightBandLbs: [550, 600],
    weightedAvgCentsPerCwt: 22_000,
    headCount: 200,
    source: "DATAMART-2466",
    ...over,
  };
}

function hammer(over: Partial<HammerComp> = {}): HammerComp {
  return {
    soldOn: "2026-08-24", category: "STEERS", avgWeightLbs: 575,
    centsPerCwt: 22_500, headCount: 100, ...over,
  };
}

describe("estimateBidRange", () => {
  // Refusing is a real answer. An estimate built on two prints will be acted
  // on as if it were solid.
  it("declines rather than guessing from too thin a basis", () => {
    expect(estimateBidRange({
      category: "STEERS", avgWeightLbs: 575, asOf: ASOF,
      usda: [usda(), usda()], hammers: [],
    })).toBeNull();
  });

  it("declines when every comparable is stale", () => {
    expect(estimateBidRange({
      category: "STEERS", avgWeightLbs: 575, asOf: ASOF,
      usda: [1, 2, 3, 4].map(() => usda({ reportDate: "2026-06-01" })), hammers: [],
    })).toBeNull();
  });

  it("ignores comparables dated after the day being priced", () => {
    expect(estimateBidRange({
      category: "STEERS", avgWeightLbs: 575, asOf: ASOF,
      usda: [1, 2, 3, 4].map(() => usda({ reportDate: "2026-09-10" })), hammers: [],
    })).toBeNull();
  });

  it("produces an ordered range from a usable basis", () => {
    const r = estimateBidRange({
      category: "STEERS", avgWeightLbs: 575, asOf: ASOF,
      usda: [21_000, 21_500, 22_000, 22_500, 23_000].map((v) =>
        usda({ weightedAvgCentsPerCwt: v })),
      hammers: [],
    })!;
    expect(r.lowCentsPerCwt).toBeLessThanOrEqual(r.midCentsPerCwt);
    expect(r.midCentsPerCwt).toBeLessThanOrEqual(r.highCentsPerCwt);
    expect(r.usdaComps).toBe(5);
  });

  // Public aggregates describe the market; they don't describe this lot.
  it("stays low-confidence on public data alone until there is enough of it", () => {
    const r = estimateBidRange({
      category: "STEERS", avgWeightLbs: 575, asOf: ASOF,
      usda: [1, 2, 3].map(() => usda()), hammers: [],
    })!;
    expect(r.confidence).toBe("low");
    expect(r.basis).toContain("No comparable sale has closed on Brindle yet");
  });

  it("earns confidence from Brindle's own hammer prices", () => {
    const r = estimateBidRange({
      category: "STEERS", avgWeightLbs: 575, asOf: ASOF,
      usda: [usda()],
      hammers: [1, 2, 3, 4, 5].map(() => hammer()),
    })!;
    expect(r.confidence).toBe("good");
    expect(r.brindleComps).toBe(5);
    expect(r.basis).toContain("5 comparable sales on Brindle");
  });

  it("weights a Brindle hammer above a USDA print", () => {
    const withHammer = estimateBidRange({
      category: "STEERS", avgWeightLbs: 575, asOf: ASOF,
      usda: [1, 2, 3].map(() => usda({ weightedAvgCentsPerCwt: 20_000 })),
      hammers: [hammer({ centsPerCwt: 24_000, headCount: 200 })],
    })!;
    const withoutHammer = estimateBidRange({
      category: "STEERS", avgWeightLbs: 575, asOf: ASOF,
      usda: [1, 2, 3].map(() => usda({ weightedAvgCentsPerCwt: 20_000 })),
      hammers: [],
    })!;
    expect(withHammer.highCentsPerCwt).toBeGreaterThan(withoutHammer.highCentsPerCwt);
  });

  it("lets a bigger draft count for more, but not without limit", () => {
    const r = estimateBidRange({
      category: "STEERS", avgWeightLbs: 575, asOf: ASOF,
      usda: [
        usda({ weightedAvgCentsPerCwt: 30_000, headCount: 10_000 }),
        usda({ weightedAvgCentsPerCwt: 20_000, headCount: 100 }),
        usda({ weightedAvgCentsPerCwt: 20_000, headCount: 100 }),
        usda({ weightedAvgCentsPerCwt: 20_000, headCount: 100 }),
      ],
      hammers: [],
    })!;
    // The 10,000-head print pulls the top up but does not become the median.
    expect(r.midCentsPerCwt).toBeLessThan(30_000);
  });

  it("prefers recent prints over older ones inside the window", () => {
    const r = estimateBidRange({
      category: "STEERS", avgWeightLbs: 575, asOf: ASOF,
      usda: [
        usda({ reportDate: "2026-08-25", weightedAvgCentsPerCwt: 24_000 }),
        usda({ reportDate: "2026-08-25", weightedAvgCentsPerCwt: 24_000 }),
        usda({ reportDate: "2026-08-06", weightedAvgCentsPerCwt: 18_000 }),
        usda({ reportDate: "2026-08-06", weightedAvgCentsPerCwt: 18_000 }),
      ],
      hammers: [],
    })!;
    expect(r.midCentsPerCwt).toBeGreaterThan(21_000);
  });

  it("reports counts so a caller can show its work", () => {
    const r = estimateBidRange({
      category: "STEERS", avgWeightLbs: 575, asOf: ASOF,
      usda: [usda(), usda()], hammers: [hammer(), hammer()],
    })!;
    expect(r.usdaComps).toBe(2);
    expect(r.brindleComps).toBe(2);
  });
});

describe("rangeToLotTotal", () => {
  it("scales a per-cwt price to the whole load", () => {
    // 300 head x 575 lb = 1,725 cwt at $220.00 = $379,500
    expect(rangeToLotTotal(22_000, 300, 575)).toBe(37_950_000);
  });
});
