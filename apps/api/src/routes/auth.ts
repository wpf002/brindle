import type { FastifyInstance } from "fastify";
import { prisma, CreditStatus, UserType } from "@brindle/db";
import { signSession, requireAuth, type Session } from "../auth.js";
import { nextBuyerNumber } from "../buyers.js";

export async function authRoutes(app: FastifyInstance) {
  // Dev-only login: mint a session for an email. Auto-provisions the account on
  // first use (approved buyer with a buyer number) so anyone can sign in and try
  // the app. Real auth (identity verification + credit approval) lands later.
  app.post<{ Body: { email?: string; name?: string } }>("/auth/dev-login", async (req, reply) => {
    if (process.env.NODE_ENV === "production") {
      return reply.code(404).send({ error: "NOT_FOUND" });
    }
    const email = req.body?.email?.trim().toLowerCase();
    if (!email) return reply.code(400).send({ error: "EMAIL_REQUIRED" });

    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      const issued = await prisma.user.findMany({
        where: { buyerNumber: { not: null } },
        select: { buyerNumber: true },
      });
      const name = req.body?.name?.trim() || email.split("@")[0]!;
      user = await prisma.user.create({
        data: {
          email,
          type: UserType.BUYER,
          legalName: name,
          businessName: name,
          creditStatus: CreditStatus.APPROVED,
          creditLimitCents: 5_000_000n,
          buyerNumber: nextBuyerNumber(issued.map((u) => u.buyerNumber).filter((n): n is string => n !== null)),
        },
      });
    }

    const session: Session = {
      userId: user.id,
      type: user.type,
      buyerNumber: user.buyerNumber,
      creditApproved: user.creditStatus === CreditStatus.APPROVED,
    };
    return { token: await signSession(session), session };
  });

  // Echo the caller's session — handy for the SPA to confirm a token is live.
  app.get("/auth/me", { preHandler: requireAuth }, async (req) => ({
    session: req.session,
  }));
}
