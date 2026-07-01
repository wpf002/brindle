import type { FastifyInstance } from "fastify";
import {
  prisma,
  Prisma,
  AuctionFormat,
  SettlementMode,
  LotCategory,
  PriceUnit,
  LotStatus,
} from "@brindle/db";
import { parseEpdSet, ANGUS_TRAITS } from "@brindle/genetics";
import { evaluateShipment, type Species } from "@brindle/compliance";
import { requireAuth } from "../auth.js";

function speciesFor(category: string): Species {
  if (category === "SHEEP") return "SHEEP";
  if (category === "GOATS") return "GOAT";
  return "CATTLE";
}

// Seller console write side: create auctions, build lots (genetics EPD ingested
// and validated here), and open/close them. Every mutation is scoped to the
// authenticated seller.
export async function consoleRoutes(app: FastifyInstance) {
  app.post<{
    Body: {
      name?: string;
      format?: AuctionFormat;
      settlementMode?: SettlementMode;
      startsAt?: string;
      endsAt?: string;
      buyerPremiumBps?: number;
      softCloseSecs?: number;
    };
  }>("/console/auctions", { preHandler: requireAuth }, async (req, reply) => {
    const b = req.body ?? {};
    if (!b.name || !b.startsAt) return reply.code(400).send({ error: "NAME_AND_START_REQUIRED" });
    const auction = await prisma.auction.create({
      data: {
        sellerId: req.session!.userId,
        name: b.name,
        format: b.format ?? AuctionFormat.TIMED_ONLINE,
        settlementMode: b.settlementMode ?? SettlementMode.INTEGRATED_PAYMENT,
        startsAt: new Date(b.startsAt),
        endsAt: b.endsAt ? new Date(b.endsAt) : null,
        buyerPremiumBps: b.buyerPremiumBps ?? 0,
        softCloseSecs: b.softCloseSecs ?? 120,
      },
    });
    return { auctionId: auction.id };
  });

  app.get("/console/auctions", { preHandler: requireAuth }, async (req) => {
    const auctions = await prisma.auction.findMany({
      where: { sellerId: req.session!.userId },
      include: { lots: { select: { id: true, lotNumber: true, status: true, bullName: true } } },
      orderBy: { startsAt: "desc" },
    });
    return { auctions };
  });

  app.post<{
    Params: { auctionId: string };
    Body: {
      lotNumber?: number;
      category?: LotCategory;
      priceUnit?: PriceUnit;
      startingBidCents?: string | number;
      bidIncrementCents?: string | number;
      reserveCents?: string | number;
      bullName?: string;
      bullRegId?: string;
      dosesAvailable?: number;
      postThawMotility?: number;
      storageFacility?: string;
      epd?: unknown;
      endsAt?: string;
      photos?: string[];
    };
  }>("/console/auctions/:auctionId/lots", { preHandler: requireAuth }, async (req, reply) => {
    const auction = await prisma.auction.findUnique({ where: { id: req.params.auctionId } });
    if (!auction) return reply.code(404).send({ error: "AUCTION_NOT_FOUND" });
    if (auction.sellerId !== req.session!.userId) {
      return reply.code(403).send({ error: "NOT_AUCTION_SELLER" });
    }

    const b = req.body ?? {};
    if (b.lotNumber == null || !b.category || !b.priceUnit || b.startingBidCents == null) {
      return reply.code(400).send({ error: "MISSING_REQUIRED_LOT_FIELDS" });
    }

    // Validate/normalize seller-supplied EPDs; surface warnings, don't reject.
    const { epd, warnings } = b.epd
      ? parseEpdSet(b.epd, ANGUS_TRAITS)
      : { epd: undefined, warnings: [] as string[] };

    const lot = await prisma.lot.create({
      data: {
        auctionId: auction.id,
        lotNumber: b.lotNumber,
        category: b.category,
        priceUnit: b.priceUnit,
        startingBidCents: BigInt(b.startingBidCents),
        bidIncrementCents: b.bidIncrementCents != null ? BigInt(b.bidIncrementCents) : 100n,
        reserveCents: b.reserveCents != null ? BigInt(b.reserveCents) : null,
        bullName: b.bullName ?? null,
        bullRegId: b.bullRegId ?? null,
        dosesAvailable: b.dosesAvailable ?? null,
        postThawMotility: b.postThawMotility ?? null,
        storageFacility: b.storageFacility ?? null,
        epd: epd ? (epd as unknown as Prisma.InputJsonValue) : undefined,
        endsAt: b.endsAt ? new Date(b.endsAt) : null,
        photos: b.photos ?? [],
      },
    });
    return { lotId: lot.id, epdWarnings: warnings };
  });

  // Seller analytics: clearance, realized price vs opening, GMV, buyer reach.
  app.get("/console/analytics", { preHandler: requireAuth }, async (req) => {
    const sellerId = req.session!.userId;
    const lots = await prisma.lot.findMany({
      where: { auction: { sellerId } },
      select: {
        id: true, status: true, startingBidCents: true,
        bids: { orderBy: { seq: "desc" }, take: 1, select: { amountCents: true } },
      },
    });
    const sold = lots.filter((l) => l.status === LotStatus.SOLD);
    const gmvCents = sold.reduce((sum, l) => sum + (l.bids[0]?.amountCents ?? 0n), 0n);

    const bidders = await prisma.bid.findMany({
      where: { lot: { auction: { sellerId } } },
      select: { bidderId: true },
      distinct: ["bidderId"],
    });

    // Average realized-over-opening ratio across sold lots (integer basis points).
    let realizationBps = 0;
    if (sold.length > 0) {
      let acc = 0;
      for (const l of sold) {
        const hammer = l.bids[0]?.amountCents ?? l.startingBidCents;
        if (l.startingBidCents > 0n) {
          acc += Number((hammer * 10_000n) / l.startingBidCents);
        }
      }
      realizationBps = Math.round(acc / sold.length);
    }

    return {
      totalLots: lots.length,
      soldLots: sold.length,
      clearanceRateBps: lots.length ? Math.round((sold.length / lots.length) * 10_000) : 0,
      gmvCents: gmvCents.toString(),
      realizationBps, // 10000 = sold at opening; >10000 = above opening
      buyerReach: bidders.length,
    };
  });

  // Shipment-compliance check for a lot to a destination state (multi-state /
  // multi-species). Drives the console's "docs required before shipping" panel.
  app.get<{ Params: { lotId: string }; Querystring: { destState?: string; breedingBull?: string } }>(
    "/console/lots/:lotId/compliance",
    { preHandler: requireAuth },
    async (req, reply) => {
      const lot = await prisma.lot.findUnique({
        where: { id: req.params.lotId },
        select: { category: true, originState: true, diseaseTests: true, auction: { select: { sellerId: true } } },
      });
      if (!lot) return reply.code(404).send({ error: "LOT_NOT_FOUND" });
      if (lot.auction.sellerId !== req.session!.userId) return reply.code(403).send({ error: "NOT_LOT_SELLER" });

      const destState = req.query.destState ?? lot.originState ?? "";
      return evaluateShipment({
        species: speciesFor(lot.category),
        originState: lot.originState ?? "",
        destState,
        breedingIntactMale: req.query.breedingBull === "true" || lot.category === "BULLS",
      });
    },
  );

  // Open a lot for bidding (or withdraw it).
  app.post<{ Params: { lotId: string }; Body: { status?: LotStatus } }>(
    "/console/lots/:lotId/status",
    { preHandler: requireAuth },
    async (req, reply) => {
      const lot = await prisma.lot.findUnique({
        where: { id: req.params.lotId },
        include: { auction: { select: { sellerId: true } } },
      });
      if (!lot) return reply.code(404).send({ error: "LOT_NOT_FOUND" });
      if (lot.auction.sellerId !== req.session!.userId) {
        return reply.code(403).send({ error: "NOT_LOT_SELLER" });
      }
      const status = req.body?.status ?? LotStatus.ACTIVE;
      const updated = await prisma.lot.update({ where: { id: lot.id }, data: { status } });
      return { lotId: updated.id, status: updated.status };
    },
  );
}
