// EPD = Expected Progeny Difference. Each trait predicts how a bull's calves will
// differ from a breed baseline. "Better" isn't always "higher": low birth weight
// is good (calving ease), high weaning weight is good. Direction is per-trait, so
// best-in-class and percentile bars must be computed against it — that's what the
// comparison layer leans on.

export type TraitDirection = "higher" | "lower";

export interface TraitDef {
  key: string;
  label: string;
  /** Which direction of value is more desirable. */
  direction: TraitDirection;
  /** Display grouping (calving, growth, maternal, carcass). */
  group: string;
  unit?: string;
}

export type EpdSource = "AAA" | "AHA" | "ASA" | "OTHER"; // Angus / Hereford / Simmental

export interface EpdValue {
  value: number;
  /** BIF accuracy 0–1; higher = more reliable. */
  accuracy?: number;
  /** Breed percentile RANK: 1 = top 1% of the breed, 99 = bottom. */
  percentile?: number;
}

export type EpdSet = Record<string, EpdValue>;

// American Angus Association production + $Value indexes — the most common set a
// genetics seller will publish. Other associations can supply their own TraitDef[].
export const ANGUS_TRAITS: TraitDef[] = [
  { key: "CED", label: "Calving Ease Direct", direction: "higher", group: "calving" },
  { key: "BW", label: "Birth Weight", direction: "lower", group: "calving", unit: "lb" },
  { key: "WW", label: "Weaning Weight", direction: "higher", group: "growth", unit: "lb" },
  { key: "YW", label: "Yearling Weight", direction: "higher", group: "growth", unit: "lb" },
  { key: "Milk", label: "Maternal Milk", direction: "higher", group: "maternal", unit: "lb" },
  { key: "Marb", label: "Marbling", direction: "higher", group: "carcass" },
  { key: "REA", label: "Ribeye Area", direction: "higher", group: "carcass", unit: "sq in" },
  { key: "Fat", label: "Fat Thickness", direction: "lower", group: "carcass", unit: "in" },
  { key: "$M", label: "Maternal Weaned Calf Value", direction: "higher", group: "index", unit: "$" },
  { key: "$B", label: "Beef Value", direction: "higher", group: "index", unit: "$" },
];

export const TRAITS_BY_SOURCE: Record<EpdSource, TraitDef[]> = {
  AAA: ANGUS_TRAITS,
  AHA: ANGUS_TRAITS, // placeholder until Hereford-specific defs are added
  ASA: ANGUS_TRAITS,
  OTHER: ANGUS_TRAITS,
};
