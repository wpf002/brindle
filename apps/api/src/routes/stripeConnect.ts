import type { FastifyInstance } from "fastify";
import { prisma } from "@brindle/db";
import { requireAuth } from "../auth.js";
import { makeStripeClient } from "../stripeClient.js";

// Seller onboarding onto Stripe Connect Express, so a seller's INTEGRATED_PAYMENT
// lots have a real destination account to settle to. Creates the Express account
// on first call, then issues a fresh Account Link each time onboarding is
// (re)started — Account Links expire and can't be reused across page loads.
export async function stripeConnectRoutes(app: FastifyInstance) {
  app.post("/console/stripe/onboard", { preHandler: requireAuth }, async (req, reply) => {
    const stripe = makeStripeClient();
    if (!stripe) return reply.code(503).send({ error: "STRIPE_NOT_CONFIGURED" });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.session!.userId } });
    const webBase = process.env.WEB_BASE_URL ?? "http://localhost:3010";

    let accountId = user.stripeAccountId;
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "express",
        email: user.email,
        business_type: user.businessName ? "company" : "individual",
        capabilities: { transfers: { requested: true }, card_payments: { requested: true } },
      });
      accountId = account.id;
      await prisma.user.update({ where: { id: user.id }, data: { stripeAccountId: accountId } });
    }

    const link = await stripe.accountLinks.create({
      account: accountId,
      type: "account_onboarding",
      refresh_url: `${webBase}/sell?stripe=refresh`,
      return_url: `${webBase}/sell?stripe=return`,
    });

    return { url: link.url };
  });

  // Poll right after the return redirect, so the console reflects reality the
  // instant the seller lands back. Ongoing changes (an account later disabled)
  // arrive via the `account.updated` webhook instead of waiting for a refresh.
  app.get("/console/stripe/status", { preHandler: requireAuth }, async (req) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.session!.userId } });
    if (!user.stripeAccountId) return { connected: false, onboarded: false };

    const stripe = makeStripeClient();
    if (!stripe) return { connected: true, onboarded: user.stripeOnboardedAt != null };

    const account = await stripe.accounts.retrieve(user.stripeAccountId);
    const onboarded = Boolean(account.charges_enabled && account.details_submitted);
    if (onboarded !== (user.stripeOnboardedAt != null)) {
      await prisma.user.update({
        where: { id: user.id },
        data: { stripeOnboardedAt: onboarded ? new Date() : null },
      });
    }
    return { connected: true, onboarded, chargesEnabled: account.charges_enabled, detailsSubmitted: account.details_submitted };
  });
}
