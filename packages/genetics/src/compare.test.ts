import { describe, it, expect } from "vitest";
import { compareBulls, summarizeWins, barFromPercentile, type BullEpdInput } from "./compare.js";
import { parseEpdSet } from "./ingest.js";
import { ANGUS_TRAITS, type TraitDef } from "./traits.js";

const BW: TraitDef = { key: "BW", label: "Birth Weight", direction: "lower", group: "calving" };
const WW: TraitDef = { key: "WW", label: "Weaning Weight", direction: "higher", group: "growth" };

describe("barFromPercentile — breed rank to desirability", () => {
  it("maps top percentile to a near-full bar and bottom to near-empty", () => {
    expect(barFromPercentile(1)).toBe(99);
    expect(barFromPercentile(50)).toBe(50);
    expect(barFromPercentile(99)).toBe(1);
  });
});

describe("compareBulls — direction-aware best-in-trait", () => {
  const bulls = [
    { id: "a", name: "Bull A", epd: { BW: { value: 1.2 }, WW: { value: 70 } } },
    { id: "b", name: "Bull B", epd: { BW: { value: 3.5 }, WW: { value: 85 } } },
  ];

  it("picks the LOWER value as best for birth weight", () => {
    const [bw] = compareBulls(bulls, [BW]);
    expect(bw!.cells.find((c) => c.bullId === "a")!.isBest).toBe(true); // 1.2 < 3.5
    expect(bw!.cells.find((c) => c.bullId === "b")!.isBest).toBe(false);
  });

  it("picks the HIGHER value as best for weaning weight", () => {
    const [ww] = compareBulls(bulls, [WW]);
    expect(ww!.cells.find((c) => c.bullId === "b")!.isBest).toBe(true); // 85 > 70
  });

  it("fills the bar toward the desirable end of the compared range", () => {
    const [bw] = compareBulls(bulls, [BW]);
    // lower is better: the 1.2 bull gets the full bar, the 3.5 bull empty
    expect(bw!.cells.find((c) => c.bullId === "a")!.barPct).toBe(100);
    expect(bw!.cells.find((c) => c.bullId === "b")!.barPct).toBe(0);
  });

  it("prefers published percentiles over set-relative normalization", () => {
    const withPct = [
      { id: "a", name: "A", epd: { WW: { value: 70, percentile: 10 } } },
      { id: "b", name: "B", epd: { WW: { value: 85, percentile: 2 } } },
    ];
    const [ww] = compareBulls(withPct, [WW]);
    expect(ww!.cells.find((c) => c.bullId === "a")!.barPct).toBe(barFromPercentile(10));
    expect(ww!.cells.find((c) => c.bullId === "b")!.barPct).toBe(barFromPercentile(2));
  });

  it("handles a missing trait as a null cell that can't win", () => {
    const sparse: BullEpdInput[] = [
      { id: "a", name: "A", epd: { WW: { value: 70 } } },
      { id: "b", name: "B", epd: {} }, // no WW
    ];
    const [ww] = compareBulls(sparse, [WW]);
    const cellB = ww!.cells.find((c) => c.bullId === "b")!;
    expect(cellB.value).toBeNull();
    expect(cellB.isBest).toBe(false);
    expect(cellB.barPct).toBe(0);
    expect(ww!.cells.find((c) => c.bullId === "a")!.isBest).toBe(true);
  });

  it("marks ties as joint best", () => {
    const tied = [
      { id: "a", name: "A", epd: { WW: { value: 80 } } },
      { id: "b", name: "B", epd: { WW: { value: 80 } } },
    ];
    const [ww] = compareBulls(tied, [WW]);
    expect(ww!.cells.every((c) => c.isBest)).toBe(true);
    expect(ww!.cells.every((c) => c.barPct === 100)).toBe(true);
  });
});

describe("summarizeWins", () => {
  it("tallies best-in-trait counts per bull", () => {
    const bulls = [
      { id: "a", name: "A", epd: { BW: { value: 1.0 }, WW: { value: 60 } } },
      { id: "b", name: "B", epd: { BW: { value: 2.0 }, WW: { value: 90 } } },
    ];
    const wins = summarizeWins(compareBulls(bulls, [BW, WW]));
    expect(wins).toEqual({ a: 1, b: 1 }); // a wins BW (lower), b wins WW (higher)
  });
});

describe("parseEpdSet — seller ingest", () => {
  it("accepts bare numbers and the full shape, dropping unknown traits", () => {
    const { epd, warnings } = parseEpdSet(
      { BW: 1.5, WW: { value: "85", acc: 0.4, pct: 10 }, BOGUS: 5 },
      ANGUS_TRAITS,
    );
    expect(epd.BW).toEqual({ value: 1.5 });
    expect(epd.WW).toEqual({ value: 85, accuracy: 0.4, percentile: 10 });
    expect(epd.BOGUS).toBeUndefined();
    expect(warnings).toContain('Unknown trait "BOGUS" ignored');
  });

  it("rejects a non-object payload", () => {
    const { epd, warnings } = parseEpdSet("nope", ANGUS_TRAITS);
    expect(Object.keys(epd)).toHaveLength(0);
    expect(warnings).toHaveLength(1);
  });
});
