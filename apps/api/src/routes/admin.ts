import type { FastifyInstance } from "fastify";
import { prisma, CreditStatus, NotificationType } from "@brindle/db";
import { requireAdmin } from "../auth.js";
import { syncDataMart, DEFAULT_REPORTS } from "../datamart.js";
import { closeExpiredLots } from "../lotCloser.js";
import { notify } from "../notify.js";

// Back office. Everything here is gated by the shared admin token — these are
// the operations that move money or gate access, so none of them are reachable
// with a normal user session.
export async function adminRoutes(app: FastifyInstance) {
  // Queue of buyers awaiting credit approval — the review list that made the
  // previously curl-only approval flow usable.
  app.get<{ Querystring: { status?: string } }>(
    "/admin/buyers",
    { preHandler: requireAdmin },
    async (req) => {
      const status = req.query.status;
      const buyers = await prisma.user.findMany({
        where: status ? { creditStatus: status as CreditStatus } : {},
        select: {
          id: true, email: true, legalName: true, businessName: true, state: true,
          type: true, creditStatus: true, creditLimitCents: true, buyerNumber: true,
          idVerifiedAt: true, createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 200,
      });
      return {
        buyers: buyers.map((b) => ({
          ...b,
          creditLimitCents: b.creditLimitCents?.toString() ?? null,
          identityVerified: b.idVerifiedAt != null,
        })),
      };
    },
  );

  app.post<{ Params: { id: string }; Body: { reason?: string } }>(
    "/admin/buyers/:id/suspend",
    { preHandler: requireAdmin },
    async (req, reply) => {
      const user = await prisma.user.findUnique({ where: { id: req.params.id } });
      if (!user) return reply.code(404).send({ error: "USER_NOT_FOUND" });
      await prisma.user.update({ where: { id: user.id }, data: { creditStatus: CreditStatus.SUSPENDED } });
      await notify(
        user.id,
        NotificationType.SYSTEM,
        "Your buyer credit has been suspended",
        req.body?.reason ?? "Contact Brindle support for details.",
      );
      return { id: user.id, creditStatus: CreditStatus.SUSPENDED };
    },
  );

  // Pull the latest USDA AMS LMPR (DataMart) cattle price reports. Free, keyless,
  // and safe to re-run — the ingest is idempotent on the report natural key.
  app.post<{ Body: { days?: number; slugs?: string[] } }>(
    "/admin/market/sync",
    { preHandler: requireAdmin },
    async (req) => {
      const days = Math.min(Math.max(req.body?.days ?? 3, 1), 30);
      const results = await syncDataMart(days, req.body?.slugs);
      return { results, availableReports: DEFAULT_REPORTS };
    },
  );

  // Manually trigger the timed-lot close sweep (also runs on an interval).
  app.post("/admin/lots/close-expired", { preHandler: requireAdmin }, async (req) => {
    const closed = await closeExpiredLots(req.server.sequencer);
    return { closed };
  });

  app.get("/admin/stats", { preHandler: requireAdmin }, async () => {
    const [users, pendingCredit, activeLots, soldLots, marketRows, openDisputes] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { creditStatus: CreditStatus.PENDING } }),
      prisma.lot.count({ where: { status: "ACTIVE" } }),
      prisma.lot.count({ where: { status: "SOLD" } }),
      prisma.marketReport.count(),
      prisma.dispute.count({ where: { status: { in: ["OPEN", "UNDER_REVIEW"] } } }),
    ]);
    return { users, pendingCredit, activeLots, soldLots, marketRows, openDisputes };
  });
}
