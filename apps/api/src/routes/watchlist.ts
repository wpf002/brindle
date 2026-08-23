import type { FastifyInstance } from "fastify";
import { prisma } from "@brindle/db";
import { requireAuth } from "../auth.js";

function serializeBigints<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}

export async function watchlistRoutes(app: FastifyInstance) {
  app.get("/watchlist", { preHandler: requireAuth }, async (req) => {
    const rows = await prisma.watchlist.findMany({
      where: { buyerId: req.session!.userId },
      orderBy: { createdAt: "desc" },
      include: {
        lot: {
          select: {
            id: true, lotNumber: true, category: true, priceUnit: true, startingBidCents: true,
            bullName: true, primaryBreed: true, dosesAvailable: true, status: true,
            auction: { select: { id: true, name: true, status: true } },
          },
        },
      },
    });
    return { lots: serializeBigints(rows.map((r) => r.lot)) };
  });

  app.post<{ Params: { lotId: string } }>("/watchlist/:lotId", { preHandler: requireAuth }, async (req, reply) => {
    const lot = await prisma.lot.findUnique({ where: { id: req.params.lotId } });
    if (!lot) return reply.code(404).send({ error: "LOT_NOT_FOUND" });
    await prisma.watchlist.upsert({
      where: { buyerId_lotId: { buyerId: req.session!.userId, lotId: lot.id } },
      update: {},
      create: { buyerId: req.session!.userId, lotId: lot.id },
    });
    return { watching: true };
  });

  app.delete<{ Params: { lotId: string } }>("/watchlist/:lotId", { preHandler: requireAuth }, async (req) => {
    await prisma.watchlist.deleteMany({ where: { buyerId: req.session!.userId, lotId: req.params.lotId } });
    return { watching: false };
  });

  // Bulk membership check for the catalog/lot-detail UI to render filled/empty stars.
  app.get<{ Querystring: { lotIds?: string } }>("/watchlist/mine", { preHandler: requireAuth }, async (req) => {
    const ids = req.query.lotIds?.split(",").filter(Boolean) ?? [];
    if (ids.length === 0) return { lotIds: [] };
    const rows = await prisma.watchlist.findMany({
      where: { buyerId: req.session!.userId, lotId: { in: ids } },
      select: { lotId: true },
    });
    return { lotIds: rows.map((r) => r.lotId) };
  });
}
