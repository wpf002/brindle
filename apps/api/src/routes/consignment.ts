import type { FastifyInstance } from "fastify";
import { prisma, ConsignmentStatus, LotStatus, PriceUnit, type LotCategory } from "@brindle/db";
import { requireAuth } from "../auth.js";
import { audit } from "../audit.js";

// Consignment: the seller's path onto sale day, before any Lot exists.
//
// A rancher tells the barn what's coming, hauls in, the cattle get tagged and
// papered, and only then does the barn sort them into uniform lots. That
// sorting is the barn's actual craft — a straight load brings more than the
// same cattle sold mixed — and it's why one consignment usually becomes several
// lots rather than one.
//
// Modelling it separately from Lot matters because the barn needs to know
// what's arriving before it knows what the lots will be.

function serialize<T>(v: T): T {
  return JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));
}

/** Feeder and slaughter classes trade per hundredweight; breeding stock by head. */
function priceUnitFor(category: string): PriceUnit {
  if (category === "SEMEN") return PriceUnit.DOSE;
  if (category === "EMBRYO") return PriceUnit.EMBRYO;
  if (["BULLS", "PAIRS", "BRED_HEIFERS"].includes(category)) return PriceUnit.HEAD;
  return PriceUnit.CWT;
}

export async function consignmentRoutes(app: FastifyInstance) {
  /** A rancher consigns ahead of the sale — head, class, weight, and the story. */
  app.post<{
    Params: { auctionId: string };
    Body: {
      headCount?: number; category?: LotCategory; estWeightLbs?: number;
      primaryBreed?: string; story?: string; programCerts?: string[]; originState?: string;
    };
  }>("/auctions/:auctionId/consignments", { preHandler: requireAuth }, async (req, reply) => {
    const b = req.body ?? {};
    if (!b.headCount || !b.category) return reply.code(400).send({ error: "HEAD_AND_CLASS_REQUIRED" });

    const auction = await prisma.auction.findUnique({ where: { id: req.params.auctionId } });
    if (!auction) return reply.code(404).send({ error: "AUCTION_NOT_FOUND" });

    const c = await prisma.consignment.create({
      data: {
        auctionId: auction.id,
        consignorId: req.session!.userId,
        headCount: b.headCount,
        category: b.category,
        estWeightLbs: b.estWeightLbs ?? null,
        primaryBreed: b.primaryBreed ?? null,
        story: b.story ?? null,
        programCerts: b.programCerts ?? [],
        originState: b.originState ?? null,
      },
    });
    return { consignmentId: c.id, status: c.status };
  });

  /** The barn's arrivals board for a sale; the consignor sees only their own. */
  app.get<{ Params: { auctionId: string } }>(
    "/auctions/:auctionId/consignments",
    { preHandler: requireAuth },
    async (req, reply) => {
      const auction = await prisma.auction.findUnique({ where: { id: req.params.auctionId } });
      if (!auction) return reply.code(404).send({ error: "AUCTION_NOT_FOUND" });

      const isBarn = auction.sellerId === req.session!.userId;
      const consignments = await prisma.consignment.findMany({
        where: {
          auctionId: auction.id,
          ...(isBarn ? {} : { consignorId: req.session!.userId }),
        },
        orderBy: { createdAt: "asc" },
        include: {
          consignor: { select: { id: true, legalName: true, businessName: true } },
          lots: { select: { id: true, lotNumber: true, headCount: true } },
        },
      });
      return serialize({ consignments, viewingAsBarn: isBarn });
    },
  );

  /**
   * Advance a consignment through check-in and tag-in. Barn only — these are
   * things that happen at the scale house, not things a seller asserts.
   */
  app.post<{
    Params: { id: string };
    Body: {
      status?: ConsignmentStatus; payeeName?: string; payeeAddress?: string;
      backTagRange?: string; brandInspected?: boolean; cviOnFile?: boolean;
    };
  }>("/consignments/:id/status", { preHandler: requireAuth }, async (req, reply) => {
    const c = await prisma.consignment.findUnique({
      where: { id: req.params.id }, include: { auction: true },
    });
    if (!c) return reply.code(404).send({ error: "CONSIGNMENT_NOT_FOUND" });
    if (c.auction.sellerId !== req.session!.userId) {
      return reply.code(403).send({ error: "NOT_AUCTION_SELLER" });
    }

    const b = req.body ?? {};
    const updated = await prisma.consignment.update({
      where: { id: c.id },
      data: {
        status: b.status ?? c.status,
        // Where the check goes. A barn pays by mail and this is recorded at
        // check-in for exactly that reason.
        payeeName: b.payeeName ?? c.payeeName,
        payeeAddress: b.payeeAddress ?? c.payeeAddress,
        backTagRange: b.backTagRange ?? c.backTagRange,
        brandInspected: b.brandInspected ?? c.brandInspected,
        cviOnFile: b.cviOnFile ?? c.cviOnFile,
      },
    });
    await audit(req, "consignment.status", { type: "consignment", id: c.id }, { to: updated.status });
    return { id: updated.id, status: updated.status };
  });

  /**
   * Sort a consignment into uniform lots.
   *
   * The head split must add up: cattle can't appear in two lots or vanish
   * between the pen and the ring, and a barn that mis-sorts owes a consignor an
   * explanation it can't give from a system that let the numbers drift.
   */
  app.post<{
    Params: { id: string };
    Body: {
      lots?: {
        lotNumber: number; headCount: number; avgWeightLbs?: number;
        shrinkPct?: number; startingBidCents: string | number; bidIncrementCents?: string | number;
      }[];
    };
  }>("/consignments/:id/sort", { preHandler: requireAuth }, async (req, reply) => {
    const c = await prisma.consignment.findUnique({
      where: { id: req.params.id }, include: { auction: true, lots: true },
    });
    if (!c) return reply.code(404).send({ error: "CONSIGNMENT_NOT_FOUND" });
    if (c.auction.sellerId !== req.session!.userId) {
      return reply.code(403).send({ error: "NOT_AUCTION_SELLER" });
    }
    if (c.lots.length > 0) return reply.code(409).send({ error: "ALREADY_SORTED" });

    const specs = req.body?.lots ?? [];
    if (specs.length === 0) return reply.code(400).send({ error: "LOTS_REQUIRED" });

    const split = specs.reduce((n, l) => n + l.headCount, 0);
    if (split !== c.headCount) {
      return reply.code(400).send({
        error: "HEAD_COUNT_MISMATCH", consigned: c.headCount, sorted: split,
      });
    }

    const created = await prisma.$transaction(
      specs.map((l) =>
        prisma.lot.create({
          data: {
            auctionId: c.auctionId,
            consignmentId: c.id,
            lotNumber: l.lotNumber,
            category: c.category,
            priceUnit: priceUnitFor(c.category),
            headCount: l.headCount,
            avgWeightLbs: l.avgWeightLbs ?? c.estWeightLbs ?? null,
            shrinkPct: l.shrinkPct ?? null,
            primaryBreed: c.primaryBreed,
            originState: c.originState,
            programCerts: c.programCerts,
            startingBidCents: BigInt(l.startingBidCents),
            bidIncrementCents: l.bidIncrementCents != null ? BigInt(l.bidIncrementCents) : 25n,
            status: LotStatus.ACTIVE,
          },
        }),
      ),
    );

    await prisma.consignment.update({
      where: { id: c.id }, data: { status: ConsignmentStatus.SORTED },
    });
    await audit(req, "consignment.sort", { type: "consignment", id: c.id }, { lots: created.length });
    return { lotIds: created.map((l) => l.id), status: ConsignmentStatus.SORTED };
  });
}
