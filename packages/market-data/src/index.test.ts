import { describe, it, expect } from "vitest";
import {
  findComparables,
  estimateFromComparables,
  basisCentsPerCwt,
  normalizeAmsRow,
  type ComparableSale,
} from "./index.js";

const comps: ComparableSale[] = [
  { reportDate: "2026-06-25", region: "Northern Plains", category: "STEERS Medium/Large 1", weightBandLbs: [500, 600], weightedAvgCentsPerCwt: 28_500, headCount: 120, source: "AMS-1" },
  { reportDate: "2026-06-24", region: "Northern Plains", category: "STEERS Medium/Large 1", weightBandLbs: [500, 600], weightedAvgCentsPerCwt: 29_000, headCount: 80, source: "AMS-2" },
  { reportDate: "2026-06-20", region: "Southern Plains", category: "STEERS Medium/Large 1", weightBandLbs: [500, 600], weightedAvgCentsPerCwt: 27_000, headCount: 60, source: "AMS-3" },
  { reportDate: "2026-05-01", region: "Northern Plains", category: "STEERS Medium/Large 1", weightBandLbs: [500, 600], weightedAvgCentsPerCwt: 25_000, headCount: 200, source: "AMS-old" },
  { reportDate: "2026-06-25", region: "Northern Plains", category: "HEIFERS Medium/Large 1", weightBandLbs: [500, 600], weightedAvgCentsPerCwt: 26_000, headCount: 90, source: "AMS-h" },
];

describe("findComparables", () => {
  it("matches class + weight band and head-weights the average", () => {
    const r = findComparables(comps, { category: "STEERS Medium/Large 1", weightLbs: 550, asOf: "2026-06-30" });
    // in-window (<=30d): AMS-1,2,3 (not AMS-old at ~60d, not HEIFERS)
    expect(r.matches.map((m) => m.source).sort()).toEqual(["AMS-1", "AMS-2", "AMS-3"]);
    // weighted: (28500*120 + 29000*80 + 27000*60)/260 = 28307.7 -> 28308
    expect(r.weightedAvgCentsPerCwt).toBe(28_308);
    expect(r.lowCentsPerCwt).toBe(27_000);
    expect(r.highCentsPerCwt).toBe(29_000);
    expect(r.totalHead).toBe(260);
  });

  it("filters by region when provided", () => {
    const r = findComparables(comps, { category: "STEERS Medium/Large 1", weightLbs: 550, region: "Southern Plains", asOf: "2026-06-30" });
    expect(r.matches.map((m) => m.source)).toEqual(["AMS-3"]);
    expect(r.weightedAvgCentsPerCwt).toBe(27_000);
  });

  it("excludes weights outside every band", () => {
    const r = findComparables(comps, { category: "STEERS Medium/Large 1", weightLbs: 750, asOf: "2026-06-30" });
    expect(r.matches).toHaveLength(0);
    expect(r.weightedAvgCentsPerCwt).toBeNull();
  });

  it("respects the recency window", () => {
    const r = findComparables(comps, { category: "STEERS Medium/Large 1", weightLbs: 550, asOf: "2026-06-30", windowDays: 90 });
    expect(r.matches.map((m) => m.source)).toContain("AMS-old"); // now inside 90d
  });

  it("never includes reports after asOf", () => {
    const r = findComparables(comps, { category: "STEERS Medium/Large 1", weightLbs: 550, asOf: "2026-06-22" });
    expect(r.matches.map((m) => m.source).sort()).toEqual(["AMS-3"]); // only the 06-20 report
  });
});

describe("estimateFromComparables", () => {
  it("values a lot at the comparable average via cwt math", () => {
    const r = findComparables(comps, { category: "STEERS Medium/Large 1", weightLbs: 550, region: "Southern Plains", asOf: "2026-06-30" });
    // $270.00/cwt, 550 lb, 50 head -> 5.5 cwt * $270 * 50 = $74,250.00
    expect(estimateFromComparables(r, 550, 50)).toBe(7_425_000n);
  });

  it("returns null when there are no comps", () => {
    const empty = findComparables(comps, { category: "BULLS", weightLbs: 2000, asOf: "2026-06-30" });
    expect(estimateFromComparables(empty, 2000, 1)).toBeNull();
  });
});

describe("basisCentsPerCwt", () => {
  it("is cash minus board", () => {
    expect(basisCentsPerCwt(28_500, 30_000)).toBe(-1_500);
  });
});

describe("normalizeAmsRow", () => {
  it("maps an AMS row to a comparable in integer cents", () => {
    const c = normalizeAmsRow({
      report_date: "2026-06-25", region: "Northern Plains", class: "STEERS", grade: "Medium/Large 1",
      wt_range_low: 500, wt_range_high: 600, avg_price: "285.00", head: 120, slug_id: "AMS-1",
    });
    expect(c.category).toBe("STEERS Medium/Large 1");
    expect(c.weightedAvgCentsPerCwt).toBe(28_500);
    expect(c.weightBandLbs).toEqual([500, 600]);
  });
});
