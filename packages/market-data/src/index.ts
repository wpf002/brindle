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

// ──────────────────────────────────────────────────────────────
// USDA AMS Livestock Mandatory Price Reporting (LMPR) DataMart — the ONE
// AMS cattle API that's genuinely free and keyless (mpr.datamart.ams.usda.gov).
// It's packer-reported fed/slaughter cattle, not sale-barn feeder-cattle-by-
// weight-class data (that lives behind the separate, key-gated MyMarketNews
// API) — but its "Detail" report rows carry real weight bands and a real
// weighted-average price, so they normalize cleanly into the same
// ComparableSale shape. Region here is a market/office location, not a state
// livestock-auction region, and category reflects a slaughter cattle class —
// callers should treat DataMart comps as fed-cattle market context, not a
// substitute for feeder-calf sale-barn comparables.
export interface DataMartDetailRow {
  report_date: string; // "MM/DD/YYYY"
  class_description: string;
  selling_basis_description: string;
  market_location_state: string | null;
  weight_range_low: string | null; // comma-grouped, e.g. "1,064"
  weight_range_high: string | null;
  weighted_avg_price: string | null; // dollars, e.g. "355.27"
  head_count: string | null;
  slug_id: string;
}

function usDateToIso(mmddyyyy: string): string {
  const [m, d, y] = mmddyyyy.split("/");
  return `${y}-${m?.padStart(2, "0")}-${d?.padStart(2, "0")}`;
}

function parseGroupedNumber(v: string | null): number | null {
  if (v == null) return null;
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Normalize one DataMart detail row; null if the row has no reported price. */
export function normalizeDataMartRow(row: DataMartDetailRow): ComparableSale | null {
  const avgPrice = parseGroupedNumber(row.weighted_avg_price);
  const low = parseGroupedNumber(row.weight_range_low);
  const high = parseGroupedNumber(row.weight_range_high);
  const head = parseGroupedNumber(row.head_count);
  if (avgPrice == null || low == null || high == null || head == null) return null;

  return {
    reportDate: usDateToIso(row.report_date),
    region: row.market_location_state ?? "US",
    category: `${row.class_description} — ${row.selling_basis_description}`,
    weightBandLbs: [low, high],
    weightedAvgCentsPerCwt: Math.round(avgPrice * 100),
    headCount: head,
    source: `DATAMART-${row.slug_id}`,
  };
}

// Automated Market Report generation from ingested USDA rows.
export {
  buildMarketPost, weightedAverageCents, formatCwt, formatClassName, formatReportDate,
  MARKET_DESK_AUTHOR, MARKET_DESK_TITLE, basisOf,
  type ReportRow, type MarketPostDraft, type BuildInput, type PriceBasis,
} from "./report.js";
