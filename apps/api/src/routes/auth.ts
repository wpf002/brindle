import type { FastifyInstance } from "fastify";
import { prisma, CreditStatus } from "@brindle/db";
import { signSession, requireAuth, type Session } from "../auth.js";

export async function authRoutes(app: FastifyInstance) {
  // Dev-only login: mint a session for an existing user by email. Real auth
  // (identity verification + credit approval) lands in Phase 1; until then this
  // is how the console/web apps obtain a token to exercise protected routes.
  app.post<{ Body: { email?: string } }>("/auth/dev-login", async (req, reply) => {
    if (process.env.NODE_ENV === "production") {
      return reply.code(404).send({ error: "NOT_FOUND" });
    }
    const email = req.body?.email;
    if (!email) return reply.code(400).send({ error: "EMAIL_REQUIRED" });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return reply.code(404).send({ error: "USER_NOT_FOUND" });

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
