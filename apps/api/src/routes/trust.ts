import type { FastifyInstance } from "fastify";
import { prisma } from "@brindle/db";
import { requireAuth, requireAdmin } from "../auth.js";

// Trust surface: ratings, verified-seller badges, and a transaction-history
// summary. Reputation is what lets a buyer bid real money with a seller they've
// never met.
export async function trustRoutes(app: FastifyInstance) {
  app.post<{ Body: { rateeId?: string; lotId?: string; role?: string; stars?: number; comment?: string } }>(
    "/ratings",
    { preHandler: requireAuth },
    async (req, reply) => {
      const { rateeId, lotId, role, stars, comment } = req.body ?? {};
      if (!rateeId || !role || stars == null) return reply.code(400).send({ error: "RATEE_ROLE_STARS_REQUIRED" });
      if (stars < 1 || stars > 5) return reply.code(400).send({ error: "STARS_OUT_OF_RANGE" });
      if (rateeId === req.session!.userId) return reply.code(409).send({ error: "CANNOT_RATE_SELF" });

      const rating = await prisma.rating.create({
        data: { raterId: req.session!.userId, rateeId, lotId: lotId ?? null, role, stars, comment: comment ?? null },
      });
      return { ratingId: rating.id };
    },
  );

  // Public trust profile: average stars, count, verified badge, transaction volume.
  app.get<{ Params: { id: string } }>("/users/:id/trust", async (req, reply) => {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true, businessName: true, legalName: true, sellerVerified: true, idVerifiedAt: true },
    });
    if (!user) return reply.code(404).send({ error: "USER_NOT_FOUND" });

    const agg = await prisma.rating.aggregate({
      where: { rateeId: user.id },
      _avg: { stars: true },
      _count: { _all: true },
    });
    const soldLots = await prisma.lot.count({
      where: { status: "SOLD", auction: { sellerId: user.id } },
    });

    return {
      id: user.id,
      name: user.businessName ?? user.legalName,
      sellerVerified: user.sellerVerified,
      identityVerified: user.idVerifiedAt != null,
      avgStars: agg._avg.stars,
      ratingCount: agg._count._all,
      lotsSold: soldLots,
    };
  });

  // Admin grants the verified-seller badge (after off-platform vetting).
  app.post<{ Params: { id: string } }>(
    "/admin/users/:id/verify",
    { preHandler: requireAdmin },
    async (req, reply) => {
      const user = await prisma.user.findUnique({ where: { id: req.params.id } });
      if (!user) return reply.code(404).send({ error: "USER_NOT_FOUND" });
      await prisma.user.update({ where: { id: user.id }, data: { sellerVerified: true } });
      return { id: user.id, sellerVerified: true };
    },
  );
}
