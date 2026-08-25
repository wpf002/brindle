import type { FastifyInstance } from "fastify";
import { prisma, CreditStatus, NotificationType, AdminRole } from "@brindle/db";
import { requireAdmin, requireOperator, requireOwner, revokeAllSessions } from "../auth.js";
import { syncDataMart, DEFAULT_REPORTS } from "../datamart.js";
import { generateMarketReports } from "../marketReport.js";
import { closeExpiredLots } from "../lotCloser.js";
import { notify } from "../notify.js";
import { audit } from "../audit.js";

// Back office. Read access needs SUPPORT; anything that moves money or changes
// access needs OPERATOR; managing admins needs OWNER. Every mutation is
// recorded in the audit log against the acting human.
export async function adminRoutes(app: FastifyInstance) {
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
          idVerifiedAt: true, emailVerifiedAt: true, createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 200,
      });
      return {
        buyers: buyers.map((b) => ({
          ...b,
          creditLimitCents: b.creditLimitCents?.toString() ?? null,
          identityVerified: b.idVerifiedAt != null,
          emailVerified: b.emailVerifiedAt != null,
        })),
      };
    },
  );

  app.post<{ Params: { id: string }; Body: { reason?: string } }>(
    "/admin/buyers/:id/suspend",
    { preHandler: requireOperator },
    async (req, reply) => {
      const user = await prisma.user.findUnique({ where: { id: req.params.id } });
      if (!user) return reply.code(404).send({ error: "USER_NOT_FOUND" });

      await prisma.user.update({ where: { id: user.id }, data: { creditStatus: CreditStatus.SUSPENDED } });
      // A suspension should end their access now, not whenever a token expires.
      const revoked = await revokeAllSessions(user.id);
      await audit(req, "credit.suspend", { type: "user", id: user.id }, { reason: req.body?.reason, revoked });
      await notify(
        user.id,
        NotificationType.SYSTEM,
        "Your buyer credit has been suspended",
        req.body?.reason ?? "Contact Brindle support for details.",
      );
      return { id: user.id, creditStatus: CreditStatus.SUSPENDED, sessionsRevoked: revoked };
    },
  );

  app.post<{ Body: { days?: number; slugs?: string[]; publish?: boolean } }>(
    "/admin/market/sync",
    { preHandler: requireOperator },
    async (req) => {
      const days = Math.min(Math.max(req.body?.days ?? 3, 1), 30);
      const results = await syncDataMart(days, req.body?.slugs);

      // Write up what just landed, unless the caller only wanted the numbers.
      // Pass publish:false to backfill price history without filling the news
      // feed with months of retrospective daily reports.
      const posts = req.body?.publish === false ? [] : await generateMarketReports(days);

      await audit(req, "market.sync", undefined, { days, results, published: posts.length });
      return { results, posts, availableReports: DEFAULT_REPORTS };
    },
  );

  // Re-run the write-ups without re-fetching from USDA — useful after changing
  // the generator, or to fill in a day whose rows arrived late.
  app.post<{ Body: { days?: number } }>(
    "/admin/market/publish",
    { preHandler: requireOperator },
    async (req) => {
      const days = Math.min(Math.max(req.body?.days ?? 3, 1), 30);
      const posts = await generateMarketReports(days);
      await audit(req, "market.publish", undefined, { days, published: posts.length });
      return { posts };
    },
  );

  app.post("/admin/lots/close-expired", { preHandler: requireOperator }, async (req) => {
    const closed = await closeExpiredLots(req.server.sequencer);
    await audit(req, "lots.close_expired", undefined, { closed });
    return { closed };
  });

  app.get("/admin/stats", { preHandler: requireAdmin }, async () => {
    const [users, pendingCredit, activeLots, soldLots, marketRows, openDisputes, liveSessions] =
      await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { creditStatus: CreditStatus.PENDING } }),
        prisma.lot.count({ where: { status: "ACTIVE" } }),
        prisma.lot.count({ where: { status: "SOLD" } }),
        prisma.marketReport.count(),
        prisma.dispute.count({ where: { status: { in: ["OPEN", "UNDER_REVIEW"] } } }),
        prisma.session.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } }),
      ]);
    return { users, pendingCredit, activeLots, soldLots, marketRows, openDisputes, liveSessions };
  });

  // ── audit trail ──────────────────────────────────────────────
  app.get<{ Querystring: { action?: string; targetId?: string; limit?: string } }>(
    "/admin/audit",
    { preHandler: requireAdmin },
    async (req) => {
      const entries = await prisma.auditLog.findMany({
        where: {
          ...(req.query.action ? { action: req.query.action } : {}),
          ...(req.query.targetId ? { targetId: req.query.targetId } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: Math.min(Number(req.query.limit ?? 100), 500),
        include: { actor: { select: { email: true, legalName: true } } },
      });
      return { entries };
    },
  );

  // ── admin management (OWNER only) ────────────────────────────
  app.get("/admin/admins", { preHandler: requireOwner }, async () => {
    const admins = await prisma.user.findMany({
      where: { adminRole: { not: null } },
      select: { id: true, email: true, legalName: true, adminRole: true, totpEnabledAt: true },
      orderBy: { email: "asc" },
    });
    return {
      admins: admins.map((a) => ({ ...a, twoFactorEnabled: a.totpEnabledAt != null })),
    };
  });

  app.post<{ Params: { id: string }; Body: { role?: AdminRole | null } }>(
    "/admin/admins/:id",
    { preHandler: requireOwner },
    async (req, reply) => {
      const role = req.body?.role ?? null;
      if (role !== null && !Object.values(AdminRole).includes(role)) {
        return reply.code(400).send({ error: "INVALID_ROLE" });
      }
      const user = await prisma.user.findUnique({ where: { id: req.params.id } });
      if (!user) return reply.code(404).send({ error: "USER_NOT_FOUND" });

      // Don't let the last owner demote themselves and lock everyone out of
      // the back office.
      if (user.adminRole === AdminRole.OWNER && role !== AdminRole.OWNER) {
        const owners = await prisma.user.count({ where: { adminRole: AdminRole.OWNER } });
        if (owners <= 1) return reply.code(409).send({ error: "LAST_OWNER" });
      }

      await prisma.user.update({ where: { id: user.id }, data: { adminRole: role } });
      await audit(req, role ? "admin.grant" : "admin.revoke", { type: "user", id: user.id }, { role });
      return { id: user.id, adminRole: role };
    },
  );

  // Kept from the old trust surface: the barn vets a seller off-platform and
  // marks them verified. Peer star ratings went with the breeder-marketplace
  // framing — the memo's trust model is the venue standing behind its
  // participants, not buyers and sellers rating each other.
  app.post<{ Params: { id: string } }>(
    "/admin/users/:id/verify",
    { preHandler: requireOperator },
    async (req, reply) => {
      const user = await prisma.user.findUnique({ where: { id: req.params.id } });
      if (!user) return reply.code(404).send({ error: "USER_NOT_FOUND" });
      await prisma.user.update({ where: { id: user.id }, data: { sellerVerified: true } });
      await audit(req, "seller.verify", { type: "user", id: user.id });
      return { id: user.id, sellerVerified: true };
    },
  );
}
