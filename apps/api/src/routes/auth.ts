import type { FastifyInstance } from "fastify";
import { prisma, CreditStatus, UserType } from "@brindle/db";
import { signSession, requireAuth, type Session } from "../auth.js";
import { hashPassword, verifyPassword, isPasswordStrongEnough } from "../password.js";
import { nextBuyerNumber } from "../buyers.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sessionFor(user: { id: string; type: string; buyerNumber: string | null; creditStatus: string }): Session {
  return {
    userId: user.id,
    type: user.type,
    buyerNumber: user.buyerNumber,
    creditApproved: user.creditStatus === CreditStatus.APPROVED,
  };
}

export async function authRoutes(app: FastifyInstance) {
  // Real account creation. Buyers start PENDING and get no buyer number until
  // credit is approved (the "approve once, bid everywhere" gate) — registering
  // does not grant the ability to bid on its own. Sellers register the same way;
  // Stripe/identity onboarding happen separately once signed in.
  app.post<{
    Body: { email?: string; password?: string; legalName?: string; businessName?: string; type?: string; state?: string };
  }>("/auth/register", { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } }, async (req, reply) => {
    const b = req.body ?? {};
    const email = b.email?.trim().toLowerCase();
    if (!email || !EMAIL_RE.test(email)) return reply.code(400).send({ error: "VALID_EMAIL_REQUIRED" });
    if (!b.password || !isPasswordStrongEnough(b.password)) {
      return reply.code(400).send({ error: "PASSWORD_TOO_SHORT" });
    }
    if (!b.legalName?.trim()) return reply.code(400).send({ error: "LEGAL_NAME_REQUIRED" });

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return reply.code(409).send({ error: "EMAIL_ALREADY_REGISTERED" });

    const type = (["BUYER", "SELLER_BREEDER", "GENETICS_PROVIDER", "RANCHER", "FEEDLOT", "ORDER_BUYER", "SALE_MANAGER"] as const)
      .includes(b.type as UserType)
      ? (b.type as UserType)
      : UserType.BUYER;

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await hashPassword(b.password),
        type,
        legalName: b.legalName.trim(),
        businessName: b.businessName?.trim() || null,
        state: b.state?.trim() || null,
        creditStatus: CreditStatus.PENDING,
      },
    });

    return { token: await signSession(sessionFor(user)), session: sessionFor(user) };
  });

  app.post<{ Body: { email?: string; password?: string } }>(
    "/auth/login",
    { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } },
    async (req, reply) => {
    const email = req.body?.email?.trim().toLowerCase();
    const password = req.body?.password;
    if (!email || !password) return reply.code(400).send({ error: "EMAIL_AND_PASSWORD_REQUIRED" });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user?.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
      // Same error for "no such user" and "wrong password" — don't leak which
      // emails are registered.
      return reply.code(401).send({ error: "INVALID_CREDENTIALS" });
    }

    return { token: await signSession(sessionFor(user)), session: sessionFor(user) };
  });

  // Dev-only login: mint a session for an email, auto-provisioning an approved
  // buyer on first use. Disabled outside development — see /auth/register for
  // the real credentialed path.
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

    return { token: await signSession(sessionFor(user)), session: sessionFor(user) };
  });

  // Live account state (not the possibly-stale JWT claims) — credit approval,
  // verification, and Stripe onboarding can all change mid-session.
  app.get("/auth/me", { preHandler: requireAuth }, async (req, reply) => {
    const user = await prisma.user.findUnique({
      where: { id: req.session!.userId },
      select: {
        id: true, type: true, email: true, legalName: true, businessName: true,
        buyerNumber: true, creditStatus: true, sellerVerified: true,
        emailVerifiedAt: true, idVerifiedAt: true, stripeOnboardedAt: true,
        stripeAccountId: true,
      },
    });
    if (!user) return reply.code(404).send({ error: "USER_NOT_FOUND" });
    return {
      session: sessionFor(user),
      account: {
        email: user.email,
        legalName: user.legalName,
        businessName: user.businessName,
        sellerVerified: user.sellerVerified,
        emailVerified: user.emailVerifiedAt != null,
        identityVerified: user.idVerifiedAt != null,
        stripeConnected: user.stripeAccountId != null,
        stripeOnboarded: user.stripeOnboardedAt != null,
      },
    };
  });
}
