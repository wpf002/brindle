import { totalFromCwt, type Cents } from "@brindle/core";

// USDA AMS video/internet auction reports -> comparable-sale context shown inline
// at the bid box. Same ingestion-plus-valuation pattern as Furlong, pointed at a
// bigger, more liquid market. Comps are reference data (informational), so prices
// ride as integer cents-per-cwt numbers; transaction money stays bigint elsewhere.

export interface ComparableSale {
  reportDate: string; // ISO "YYYY-MM-DD"
  region: string;
  category: string; // e.g. "STEERS Medium/Large 1"
  weightBandLbs: [number, number];
  weightedAvgCentsPerCwt: number;
  headCount: number;
  source: string; // AMS report id
}

export interface ComparablesQuery {
  category: string;
  weightLbs: number;
  region?: string;
  asOf?: string; // ISO date; defaults to the latest report present
  windowDays?: number; // recency window, default 30
}

export interface ComparablesResult {
  matches: ComparableSale[];
  weightedAvgCentsPerCwt: number | null;
  lowCentsPerCwt: number | null;
  highCentsPerCwt: number | null;
  totalHead: number;
}

const dayMs = 86_400_000;

function withinWindow(reportDate: string, asOf: string, windowDays: number): boolean {
  if (reportDate > asOf) return false; // no future reports
  const diff = (Date.parse(asOf) - Date.parse(reportDate)) / dayMs;
  return diff >= 0 && diff <= windowDays;
}

/**
 * Find the AMS comps that bracket a lot: same class, a weight band containing the
 * lot's weight, optional region, within a recency window. Returns the head-weighted
 * average and the low/high range — "comparable lots sold at $X/cwt last week."
 */
export function findComparables(all: ComparableSale[], q: ComparablesQuery): ComparablesResult {
  const windowDays = q.windowDays ?? 30;
  const asOf = q.asOf ?? all.reduce((m, c) => (c.reportDate > m ? c.reportDate : m), "0000-00-00");

  const matches = all.filter(
    (c) =>
      c.category === q.category &&
      q.weightLbs >= c.weightBandLbs[0] &&
      q.weightLbs <= c.weightBandLbs[1] &&
      (!q.region || c.region === q.region) &&
      withinWindow(c.reportDate, asOf, windowDays),
  );

  if (matches.length === 0) {
    return { matches, weightedAvgCentsPerCwt: null, lowCentsPerCwt: null, highCentsPerCwt: null, totalHead: 0 };
  }

  let weightedSum = 0;
  let totalHead = 0;
  let low = Infinity;
  let high = -Infinity;
  for (const c of matches) {
    weightedSum += c.weightedAvgCentsPerCwt * c.headCount;
    totalHead += c.headCount;
    low = Math.min(low, c.weightedAvgCentsPerCwt);
    high = Math.max(high, c.weightedAvgCentsPerCwt);
  }

  return {
    matches: matches.sort((a, b) => (a.reportDate < b.reportDate ? 1 : -1)),
    weightedAvgCentsPerCwt: totalHead > 0 ? Math.round(weightedSum / totalHead) : null,
    lowCentsPerCwt: low,
    highCentsPerCwt: high,
    totalHead,
  };
}

/** Estimated lot value at the comparable average, using centralized cattle math. */
export function estimateFromComparables(
  result: ComparablesResult,
  avgWeightLbs: number,
  head: number,
): Cents | null {
  if (result.weightedAvgCentsPerCwt === null) return null;
  return totalFromCwt(BigInt(result.weightedAvgCentsPerCwt), avgWeightLbs, head);
}

/** Cash-to-futures basis for forward-contract context (cash minus board). */
export function basisCentsPerCwt(cashCentsPerCwt: number, futuresCentsPerCwt: number): number {
  return cashCentsPerCwt - futuresCentsPerCwt;
}

// Raw AMS report row (a subset of the AMS API shape) -> normalized ComparableSale.
export interface AmsRow {
  report_date: string;
  region: string;
  class: string;
  grade?: string;
  wt_range_low: number | string;
  wt_range_high: number | string;
  avg_price: number | string; // $/cwt in the AMS feed
  head: number | string;
  slug_id: string;
}

export function normalizeAmsRow(row: AmsRow): ComparableSale {
  const dollarsToCents = (v: number | string) => Math.round(Number(v) * 100);
  return {
    reportDate: row.report_date,
    region: row.region,
    category: row.grade ? `${row.class} ${row.grade}` : row.class,
    weightBandLbs: [Number(row.wt_range_low), Number(row.wt_range_high)],
    weightedAvgCentsPerCwt: dollarsToCents(row.avg_price),
    headCount: Number(row.head),
    source: row.slug_id,
  };
}

// Phase 3: back this with the AMS ingest table; interface stays stable.
export interface MarketDataSource {
  comparables(q: ComparablesQuery): Promise<ComparableSale[]>;
}
