import type { FastifyInstance } from "fastify";
import { prisma, LotStatus, AuctionStatus, type LotCategory } from "@brindle/db";
import { PrismaLotStateStore } from "../sequencer/prismaStore.js";

// Read side for buyers: the catalog and lot detail. Current price comes from the
// same store the sequencer writes, so the price a buyer sees is the price the
// engine holds — one source of truth, replayed from the bid log.
const store = new PrismaLotStateStore();

function serializeBigints<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
  );
}

export async function catalogRoutes(app: FastifyInstance) {
  // Cross-seller catalog with light filters. Only live/scheduled auctions show.
  app.get<{ Querystring: { category?: string; state?: string } }>(
    "/catalog",
    async (req) => {
      const { category, state } = req.query;
      const lots = await prisma.lot.findMany({
        where: {
          status: { in: [LotStatus.ACTIVE, LotStatus.DRAFT] },
          ...(category ? { category: category as LotCategory } : {}),
          ...(state ? { originState: state } : {}),
          auction: { status: { in: [AuctionStatus.SCHEDULED, AuctionStatus.LIVE] } },
        },
        select: {
          id: true, lotNumber: true, category: true, priceUnit: true,
          startingBidCents: true, bullName: true, primaryBreed: true,
          dosesAvailable: true, endsAt: true, photos: true,
          auction: { select: { id: true, name: true, startsAt: true, status: true } },
        },
        orderBy: [{ auction: { startsAt: "asc" } }, { lotNumber: "asc" }],
        take: 200,
      });
      return { lots: serializeBigints(lots) };
    },
  );

  // Auction header (public) — name, status, live-video stream URL for the ring.
  app.get<{ Params: { id: string } }>("/auctions/:id", async (req, reply) => {
    const auction = await prisma.auction.findUnique({
      where: { id: req.params.id },
      select: { id: true, name: true, status: true, format: true, streamUrl: true, startsAt: true, sellerId: true },
    });
    if (!auction) return reply.code(404).send({ error: "AUCTION_NOT_FOUND" });
    return serializeBigints(auction);
  });

  // Lot detail with current standing price + reserve-met flag.
  app.get<{ Params: { id: string } }>("/lots/:id", async (req, reply) => {
    const lot = await prisma.lot.findUnique({
      where: { id: req.params.id },
      include: {
        auction: {
          select: {
            id: true, name: true, status: true, format: true, startsAt: true,
            endsAt: true, softCloseSecs: true, buyerPremiumBps: true,
            seller: { select: { businessName: true, legalName: true, state: true } },
          },
        },
      },
    });
    if (!lot) return reply.code(404).send({ error: "LOT_NOT_FOUND" });

    const state = await store.load(lot.id);
    return serializeBigints({
      lot,
      live: state
        ? {
            currentPriceCents: state.highBidCents,
            highBidderId: state.highBidderId,
            bidIncrementCents: state.minIncrementCents,
            endsAt: state.endsAt,
            closed: state.closed,
          }
        : null,
    });
  });
}
