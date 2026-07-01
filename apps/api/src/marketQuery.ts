import { prisma } from "@brindle/db";
import { findComparables, estimateFromComparables, type ComparableSale } from "@brindle/market-data";

export interface ComparablesParams {
  category: string;
  weightLbs: number;
  region?: string;
  asOf?: string;
  head?: number;
}

// Shared comparables query used by both the internal bid-box route and the public
// (API-key) buyer-intelligence surface — one implementation, two front doors.
export async function queryComparables(params: ComparablesParams) {
  const rows = await prisma.marketReport.findMany({
    where: {
      category: params.category,
      wtLowLbs: { lte: params.weightLbs },
      wtHighLbs: { gte: params.weightLbs },
      ...(params.region ? { region: params.region } : {}),
    },
    orderBy: { reportDate: "desc" },
    take: 500,
  });

  const comps: ComparableSale[] = rows.map((r) => ({
    reportDate: r.reportDate.toISOString().slice(0, 10),
    region: r.region,
    category: r.category,
    weightBandLbs: [r.wtLowLbs, r.wtHighLbs],
    weightedAvgCentsPerCwt: r.avgCentsPerCwt,
    headCount: r.headCount,
    source: r.source,
  }));

  const result = findComparables(comps, {
    category: params.category,
    weightLbs: params.weightLbs,
    region: params.region,
    asOf: params.asOf,
  });
  const estimateCents =
    params.head != null ? estimateFromComparables(result, params.weightLbs, params.head) : null;

  return {
    weightedAvgCentsPerCwt: result.weightedAvgCentsPerCwt,
    lowCentsPerCwt: result.lowCentsPerCwt,
    highCentsPerCwt: result.highCentsPerCwt,
    totalHead: result.totalHead,
    matchCount: result.matches.length,
    estimateCents: estimateCents != null ? estimateCents.toString() : null,
    latestReportDate: result.matches[0]?.reportDate ?? null,
  };
}
