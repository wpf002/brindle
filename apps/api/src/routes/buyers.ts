import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { prisma, Prisma, CreditStatus } from "@brindle/db";
import { nextBuyerNumber } from "../buyers.js";

// Approving credit is sensitive (it gates real money), so it sits behind a shared
// admin token used by the internal back-office tool until full RBAC lands. Identity
// verification (Persona / Stripe Identity) runs before this call and is recorded as
// User.idVerifiedAt; this endpoint is the credit decision itself.
function adminGuard(req: FastifyRequest, reply: FastifyReply, done: (err?: Error) => void) {
  const expected = process.env.ADMIN_API_TOKEN;
  if (!expected || req.headers["x-admin-token"] !== expected) {
    reply.code(403).send({ error: "FORBIDDEN" });
    return;
  }
  done();
}

export async function buyerRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string }; Body: { creditLimitCents?: string | number } }>(
    "/buyers/:id/approve",
    { preHandler: adminGuard },
    async (req, reply) => {
      const user = await prisma.user.findUnique({ where: { id: req.params.id } });
      if (!user) return reply.code(404).send({ error: "USER_NOT_FOUND" });

      const creditLimitCents =
        req.body?.creditLimitCents != null ? BigInt(req.body.creditLimitCents) : undefined;

      // Already has a number — just (re)approve and adjust the limit.
      if (user.buyerNumber) {
        const updated = await prisma.user.update({
          where: { id: user.id },
          data: { creditStatus: CreditStatus.APPROVED, creditLimitCents },
        });
        return { buyerNumber: updated.buyerNumber, creditStatus: updated.creditStatus };
      }

      // Issue a fresh buyer number, retrying if a concurrent approval grabs it.
      for (let attempt = 0; attempt < 5; attempt++) {
        const issued = await prisma.user.findMany({
          where: { buyerNumber: { not: null } },
          select: { buyerNumber: true },
        });
        const candidate = nextBuyerNumber(
          issued.map((u) => u.buyerNumber).filter((n): n is string => n !== null),
        );
        try {
          const updated = await prisma.user.update({
            where: { id: user.id },
            data: { buyerNumber: candidate, creditStatus: CreditStatus.APPROVED, creditLimitCents },
          });
          return { buyerNumber: updated.buyerNumber, creditStatus: updated.creditStatus };
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
          throw e;
        }
      }
      return reply.code(409).send({ error: "BUYER_NUMBER_ASSIGN_FAILED" });
    },
  );
}
