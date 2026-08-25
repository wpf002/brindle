import { prisma, LotStatus } from "@brindle/db";
import { estimateBidRange, type BidRange, type ComparableSale, type HammerComp } from "@brindle/market-data";

// Builds the comparable basis for a lot and hands it to the estimator.
//
// The join is the awkward part: Lot.category is our own enum (STEERS, COWS),
// while MarketReport.category is whatever AMS called it that day ("STEER —
// DRESSED DELIVERED"). Nothing links them, so the mapping is explicit and
// deliberately conservative — a class we can't confidently match contributes
// nothing rather than being force-fitted to a nearby one.

/**
 * Substrings that identify an AMS class as belonging to one of our classes.
 *
 * Note what is missing: feeder classes. The public LMPR feed we ingest is
 * packer-reported *fed* cattle — finished animals headed for slaughter. It says
 * very little about a 550 lb feeder calf, and pretending otherwise would put a
 * confident slaughter-weight number on a lot of calves. Feeder auction reports
 * live in the separate MyMarketNews API, which needs a registered key; until
 * that is wired up, feeder lots lean on Brindle's own hammer prices or return
 * nothing at all.
 */
const AMS_MATCH: Record<string, string[]> = {
  STEERS: ["STEER"],
  HEIFERS: ["HEIFER"],
  COWS: ["COW"],
};

function amsClassesFor(category: string): string[] | null {
  return AMS_MATCH[category] ?? null;
}

export interface LotEstimate {
  lotId: string;
  range: BidRange | null;
  /** Why there's no estimate, when there isn't one. */
  reason?: string;
}

export async function estimateForLot(lotId: string): Promise<LotEstimate | null> {
  const lot = await prisma.lot.findUnique({
    where: { id: lotId },
    select: { id: true, category: true, avgWeightLbs: true, priceUnit: true, originState: true },
  });
  if (!lot) return null;

  const weight = lot.avgWeightLbs != null ? Number(lot.avgWeightLbs) : null;
  if (!weight) {
    return { lotId, range: null, reason: "Lot has no weight recorded, so there is nothing to price per hundredweight." };
  }
  if (lot.priceUnit !== "CWT") {
    return { lotId, range: null, reason: "Only lots priced per hundredweight can be estimated from market comparables." };
  }

  const asOf = new Date().toISOString().slice(0, 10);

  // ── public basis ──
  const patterns = amsClassesFor(lot.category);
  let usda: ComparableSale[] = [];
  if (patterns) {
    const rows = await prisma.marketReport.findMany({
      where: {
        OR: patterns.map((p) => ({ category: { contains: p } })),
        wtLowLbs: { lte: Math.round(weight) },
        wtHighLbs: { gte: Math.round(weight) },
      },
      orderBy: { reportDate: "desc" },
      take: 300,
    });
    usda = rows.map((r) => ({
      reportDate: r.reportDate.toISOString().slice(0, 10),
      region: r.region,
      category: r.category,
      weightBandLbs: [r.wtLowLbs, r.wtHighLbs] as [number, number],
      weightedAvgCentsPerCwt: r.avgCentsPerCwt,
      headCount: r.headCount,
      source: r.source,
    }));
  }

  // ── proprietary basis: what comparable lots actually brought here ──
  // Within 15% of this lot's weight, same class. This is the half that makes
  // the estimate defensible rather than a restatement of public data.
  const sold = await prisma.lot.findMany({
    where: {
      status: LotStatus.SOLD,
      category: lot.category,
      priceUnit: "CWT",
      id: { not: lot.id },
      avgWeightLbs: { gte: weight * 0.85, lte: weight * 1.15 },
    },
    select: { avgWeightLbs: true, headCount: true, payment: { select: { amountCents: true, createdAt: true } } },
    take: 200,
  });

  const hammers: HammerComp[] = sold.flatMap((s) => {
    if (!s.payment || !s.headCount || !s.avgWeightLbs) return [];
    const totalCwt = (Number(s.avgWeightLbs) * s.headCount) / 100;
    if (totalCwt <= 0) return [];
    return [{
      soldOn: s.payment.createdAt.toISOString().slice(0, 10),
      category: lot.category,
      avgWeightLbs: Number(s.avgWeightLbs),
      centsPerCwt: Math.round(Number(s.payment.amountCents) / totalCwt),
      headCount: s.headCount,
    }];
  });

  const range = estimateBidRange({
    category: lot.category, avgWeightLbs: weight, asOf, usda, hammers,
  });

  if (!range) {
    return {
      lotId,
      range: null,
      reason: patterns
        ? "Not enough recent comparable sales to put a range on this lot."
        : "No comparable public market series for this class yet — the USDA feed we ingest covers " +
          "fed cattle, not feeders. This will fill in as sales close on Brindle.",
    };
  }
  return { lotId, range };
}
