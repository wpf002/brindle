import type { EpdSet, TraitDef } from "./traits.js";

export interface BullEpdInput {
  id: string;
  name: string;
  epd: EpdSet;
}

export interface ComparisonCell {
  bullId: string;
  value: number | null;
  accuracy: number | null;
  percentile: number | null;
  /** Best value among the compared bulls for this trait, honoring its direction. */
  isBest: boolean;
  /** 0–100 bar fill; higher always means more desirable, regardless of direction. */
  barPct: number;
}

export interface TraitComparison {
  trait: TraitDef;
  cells: ComparisonCell[];
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Breed percentile rank (1 = top 1%) → desirability bar. A top-percentile bull
 * shows a nearly full bar whatever the trait's natural units are.
 */
export function barFromPercentile(percentile: number): number {
  return clamp(100 - percentile, 0, 100);
}

/**
 * Side-by-side EPD comparison. For each trait, ranks the bulls by the trait's
 * own "better" direction (low birth weight beats high; high marbling beats low),
 * flags the best, and produces a normalized bar so a buyer can scan a row and see
 * the leader instantly. Bars prefer published breed percentiles; absent those,
 * values are normalized across just the compared set.
 */
export function compareBulls(bulls: BullEpdInput[], traits: TraitDef[]): TraitComparison[] {
  return traits.map((trait) => {
    const present = bulls
      .map((b) => b.epd[trait.key]?.value)
      .filter((v): v is number => typeof v === "number");
    const min = present.length ? Math.min(...present) : 0;
    const max = present.length ? Math.max(...present) : 0;
    const best = trait.direction === "higher" ? max : min;

    const cells: ComparisonCell[] = bulls.map((b) => {
      const e = b.epd[trait.key];
      const value = e?.value ?? null;
      const percentile = e?.percentile ?? null;
      const isBest = value !== null && present.length > 0 && value === best;

      let barPct = 0;
      if (value !== null) {
        if (percentile !== null) {
          barPct = barFromPercentile(percentile);
        } else if (max === min) {
          barPct = 100; // all compared bulls equal (or a lone bull) → all full
        } else {
          barPct =
            trait.direction === "higher"
              ? ((value - min) / (max - min)) * 100
              : ((max - value) / (max - min)) * 100;
        }
      }

      return {
        bullId: b.id,
        value,
        accuracy: e?.accuracy ?? null,
        percentile,
        isBest,
        barPct: round1(barPct),
      };
    });

    return { trait, cells };
  });
}

/** Tally best-in-trait wins per bull — a quick "who leads overall" headline. */
export function summarizeWins(comparison: TraitComparison[]): Record<string, number> {
  const wins: Record<string, number> = {};
  for (const { cells } of comparison) {
    for (const cell of cells) {
      wins[cell.bullId] = (wins[cell.bullId] ?? 0) + (cell.isBest ? 1 : 0);
    }
  }
  return wins;
}
