import type { ComparableSale } from "./index.js";

// Lot-level bid-range estimation.
//
// Nothing on the market does this — the research found macro forecasters
// (CattleFax) and photo-based weight/value apps, but no per-lot "what should
// this specific load bring at this specific sale" estimate. The public USDA AMS
// feed is a legitimate foundation for it, and the estimate gets genuinely
// defensible once it can lean on hammer prices from lots actually sold here.
//
// The hard part is not the arithmetic — it is knowing when to refuse. An
// estimate that quietly extrapolates from the wrong class of cattle is worse
// than no estimate, because a buyer will act on it. Everything below is built
// so the caller can tell how much to trust the number, and so a thin or
// mismatched basis returns null rather than a confident-looking guess.

/** A hammer price from a lot sold on Brindle. The proprietary half of the basis. */
export interface HammerComp {
  soldOn: string;        // ISO date
  category: string;      // Brindle LotCategory
  avgWeightLbs: number;
  centsPerCwt: number;
  headCount: number;
}

export type Confidence = "low" | "moderate" | "good";

export interface BidRange {
  lowCentsPerCwt: number;
  midCentsPerCwt: number;
  highCentsPerCwt: number;
  confidence: Confidence;
  /** Plain-language account of what the number rests on, for display. */
  basis: string;
  /** How many observations went in, split by where they came from. */
  usdaComps: number;
  brindleComps: number;
}

/**
 * How far a report date can be from today and still inform a price.
 *
 * Cattle markets move week to week; a month-old print is context, not a
 * comparable. Anything past this is dropped rather than down-weighted, because
 * a stale number pulled toward the mean is still a stale number.
 */
const MAX_AGE_DAYS = 21;

/** Below this many observations there is no distribution worth quoting. */
const MIN_COMPS = 3;

function ageDays(iso: string, asOf: string): number {
  const a = Date.parse(`${iso}T00:00:00Z`);
  const b = Date.parse(`${asOf}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.POSITIVE_INFINITY;
  return Math.round((b - a) / 86_400_000);
}

/**
 * Weight of an observation: recent counts more, and so does a bigger draft.
 *
 * Head count matters — a 12-head consignment and a 600-head draft are not
 * equally informative about where the market is — but it is dampened
 * logarithmically. A square root was not enough: one 10,000-head print
 * outweighed three independent prints combined and simply became the median,
 * which is the opposite of what a median is for. On a log scale a draft a
 * hundred times larger counts roughly twice as much, so scale earns influence
 * without any single observation deciding the answer.
 */
function weightOf(comp: { headCount: number }, days: number): number {
  const recency = Math.max(0, 1 - days / MAX_AGE_DAYS);
  const size = 1 + Math.log10(Math.max(1, comp.headCount));
  return recency * size;
}

function weightedQuantile(
  points: { value: number; weight: number }[],
  q: number,
): number {
  const sorted = [...points].sort((a, b) => a.value - b.value);
  const total = sorted.reduce((n, p) => n + p.weight, 0);
  if (total <= 0) return sorted[Math.floor(sorted.length / 2)]!.value;

  let seen = 0;
  for (const p of sorted) {
    seen += p.weight;
    if (seen >= total * q) return p.value;
  }
  return sorted[sorted.length - 1]!.value;
}

export interface EstimateInput {
  /** The lot being priced. */
  category: string;
  avgWeightLbs: number;
  /** Date to price as of, ISO. Comparables older than three weeks are dropped. */
  asOf: string;
  /**
   * USDA rows already narrowed to a comparable class and weight band by the
   * caller — this module does not know how AMS names things.
   */
  usda: ComparableSale[];
  /** Hammer prices from comparable lots sold on Brindle. */
  hammers: HammerComp[];
}

/**
 * Estimate what a lot should bring, per hundredweight.
 *
 * Returns null when the basis is too thin to say anything useful. That is a
 * real and frequent answer: the public AMS feed we ingest is packer-reported
 * fed cattle, and it has little to say about a 550 lb feeder calf. Callers
 * should present the absence as "not enough comparable sales", never as zero.
 */
export function estimateBidRange(input: EstimateInput): BidRange | null {
  const points: { value: number; weight: number }[] = [];
  let usdaComps = 0;
  let brindleComps = 0;

  for (const c of input.usda) {
    const days = ageDays(c.reportDate, input.asOf);
    if (days < 0 || days > MAX_AGE_DAYS) continue;
    points.push({ value: c.weightedAvgCentsPerCwt, weight: weightOf(c, days) });
    usdaComps += 1;
  }

  for (const h of input.hammers) {
    const days = ageDays(h.soldOn, input.asOf);
    if (days < 0 || days > MAX_AGE_DAYS) continue;
    // Weighted double: a real hammer on this platform, for this class, is the
    // most direct evidence available and is what makes the estimate defensible
    // rather than a restatement of public data anyone can pull.
    points.push({ value: h.centsPerCwt, weight: weightOf(h, days) * 2 });
    brindleComps += 1;
  }

  if (points.length < MIN_COMPS) return null;

  const low = weightedQuantile(points, 0.25);
  const mid = weightedQuantile(points, 0.5);
  const high = weightedQuantile(points, 0.75);

  // Brindle's own hammers are what earn confidence; public aggregates alone
  // describe the market, not this lot.
  const confidence: Confidence =
    brindleComps >= 5 ? "good" : brindleComps >= 1 || usdaComps >= 8 ? "moderate" : "low";

  const basis =
    brindleComps > 0
      ? `${brindleComps} comparable ${brindleComps === 1 ? "sale" : "sales"} on Brindle` +
        (usdaComps > 0 ? ` and ${usdaComps} USDA-reported ${usdaComps === 1 ? "print" : "prints"}` : "") +
        ` in the last ${MAX_AGE_DAYS} days.`
      : `${usdaComps} USDA-reported ${usdaComps === 1 ? "print" : "prints"} in the last ` +
        `${MAX_AGE_DAYS} days. No comparable sale has closed on Brindle yet, so this ` +
        `reflects the wider market rather than this class at this barn.`;

  return {
    lowCentsPerCwt: Math.round(low),
    midCentsPerCwt: Math.round(mid),
    highCentsPerCwt: Math.round(high),
    confidence,
    basis,
    usdaComps,
    brindleComps,
  };
}

/** Total dollars a range implies for a whole lot, for display next to the per-cwt figure. */
export function rangeToLotTotal(
  centsPerCwt: number,
  headCount: number,
  avgWeightLbs: number,
): number {
  return Math.round((centsPerCwt * headCount * avgWeightLbs) / 100);
}
