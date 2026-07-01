import type { FastifyInstance } from "fastify";
import { prisma, LotStatus, AuctionStatus, UserType } from "@brindle/db";
import { requireAuth } from "../auth.js";

function serializeBigints<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}

// Public seller directory + story pages — "brand family" strip and the
// editorial "behind the brand" profile (bio, pull-quote, operations, active lots).
export async function sellerRoutes(app: FastifyInstance) {
  // Directory of sellers with at least one active lot — the homepage strip.
  app.get("/sellers", async () => {
    const sellers = await prisma.user.findMany({
      where: {
        type: { in: [UserType.SELLER_BREEDER, UserType.GENETICS_PROVIDER] },
        auctions: { some: { lots: { some: { status: LotStatus.ACTIVE } } } },
      },
      select: {
        id: true, businessName: true, legalName: true, state: true,
        title: true, sellerVerified: true, foundedYear: true,
      },
      orderBy: { businessName: "asc" },
    });
    return { sellers };
  });

  app.get<{ Params: { id: string } }>("/sellers/:id", async (req, reply) => {
    const seller = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true, businessName: true, legalName: true, state: true, title: true,
        bio: true, quote: true, foundedYear: true, sellerVerified: true, idVerifiedAt: true,
      },
    });
    if (!seller) return reply.code(404).send({ error: "SELLER_NOT_FOUND" });

    const [operations, lots, ratingAgg, soldCount] = await Promise.all([
      prisma.sellerOperation.findMany({ where: { sellerId: seller.id }, orderBy: { sortOrder: "asc" } }),
      prisma.lot.findMany({
        where: { status: LotStatus.ACTIVE, auction: { sellerId: seller.id, status: { in: [AuctionStatus.SCHEDULED, AuctionStatus.LIVE] } } },
        select: {
          id: true, lotNumber: true, category: true, priceUnit: true, startingBidCents: true,
          bullName: true, primaryBreed: true, dosesAvailable: true, bullRegId: true,
          auction: { select: { id: true, name: true, status: true, startsAt: true } },
        },
        orderBy: { lotNumber: "asc" },
      }),
      prisma.rating.aggregate({ where: { rateeId: seller.id }, _avg: { stars: true }, _count: { _all: true } }),
      prisma.lot.count({ where: { status: LotStatus.SOLD, auction: { sellerId: seller.id } } }),
    ]);

    return serializeBigints({
      seller,
      operations,
      lots,
      trust: {
        avgStars: ratingAgg._avg.stars,
        ratingCount: ratingAgg._count._all,
        lotsSold: soldCount,
        identityVerified: seller.idVerifiedAt != null,
      },
    });
  });

  // Seller maintains their own story — profile fields + operations (divisions).
  app.get("/console/profile", { preHandler: requireAuth }, async (req) => {
    const me = await prisma.user.findUniqueOrThrow({
      where: { id: req.session!.userId },
      select: { id: true, businessName: true, legalName: true, title: true, bio: true, quote: true, foundedYear: true, state: true },
    });
    return { profile: me };
  });

  app.put<{ Body: { title?: string; bio?: string; quote?: string; foundedYear?: number } }>(
    "/console/profile",
    { preHandler: requireAuth },
    async (req) => {
      const { title, bio, quote, foundedYear } = req.body ?? {};
      const updated = await prisma.user.update({
        where: { id: req.session!.userId },
        data: { title, bio, quote, foundedYear },
      });
      return { title: updated.title, bio: updated.bio, quote: updated.quote, foundedYear: updated.foundedYear };
    },
  );

  app.get("/console/operations", { preHandler: requireAuth }, async (req) => {
    const operations = await prisma.sellerOperation.findMany({
      where: { sellerId: req.session!.userId },
      orderBy: { sortOrder: "asc" },
    });
    return { operations };
  });

  app.post<{ Body: { name?: string; location?: string; description?: string; acres?: number; herdSize?: number } }>(
    "/console/operations",
    { preHandler: requireAuth },
    async (req, reply) => {
      const { name, location, description, acres, herdSize } = req.body ?? {};
      if (!name || !location || !description) {
        return reply.code(400).send({ error: "NAME_LOCATION_DESCRIPTION_REQUIRED" });
      }
      const count = await prisma.sellerOperation.count({ where: { sellerId: req.session!.userId } });
      const op = await prisma.sellerOperation.create({
        data: { sellerId: req.session!.userId, name, location, description, acres, herdSize, sortOrder: count },
      });
      return { operation: op };
    },
  );

  app.delete<{ Params: { id: string } }>("/console/operations/:id", { preHandler: requireAuth }, async (req, reply) => {
    const op = await prisma.sellerOperation.findUnique({ where: { id: req.params.id } });
    if (!op) return reply.code(404).send({ error: "OPERATION_NOT_FOUND" });
    if (op.sellerId !== req.session!.userId) return reply.code(403).send({ error: "NOT_YOUR_OPERATION" });
    await prisma.sellerOperation.delete({ where: { id: op.id } });
    return { deleted: true };
  });
}
