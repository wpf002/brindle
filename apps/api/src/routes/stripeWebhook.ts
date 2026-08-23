import type { FastifyInstance } from "fastify";
import type Stripe from "stripe";
import { prisma, PaymentStatus, NotificationType } from "@brindle/db";
import { makeStripeClient } from "../stripeClient.js";
import { notify } from "../notify.js";
import { captureError } from "../observability.js";

// Stripe webhooks. Previously onboarding state was only ever polled, so a
// Connect account disabled *after* onboarding went unnoticed until someone
// happened to refresh. These events also keep payment status honest when a
// charge succeeds, fails, or is disputed outside our own request flow.
//
// The signature is verified against the raw body — Stripe signs the exact
// bytes, so this route opts out of JSON parsing.
export async function stripeWebhookRoutes(app: FastifyInstance) {
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (req, body, done) => {
      // Only this route needs the raw buffer; everything else keeps normal
      // JSON parsing via the default parser on the main instance.
      done(null, body);
    },
  );

  app.post("/webhooks/stripe", async (req, reply) => {
    const stripe = makeStripeClient();
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!stripe || !secret) return reply.code(503).send({ error: "WEBHOOK_NOT_CONFIGURED" });

    const signature = req.headers["stripe-signature"];
    if (typeof signature !== "string") return reply.code(400).send({ error: "MISSING_SIGNATURE" });

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(req.body as Buffer, signature, secret);
    } catch {
      // Unsigned or tampered payloads never reach any handler.
      return reply.code(401).send({ error: "INVALID_SIGNATURE" });
    }

    try {
      await handleEvent(event);
    } catch (e) {
      captureError(e, { stripeEvent: event.type, eventId: event.id });
      // 500 so Stripe retries — better than silently dropping a payment event.
      return reply.code(500).send({ error: "HANDLER_FAILED" });
    }

    return { received: true };
  });
}

async function handleEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    // Connect onboarding finished, or the account later lost the ability to
    // accept charges (missing docs, risk review, disablement).
    case "account.updated": {
      const account = event.data.object as Stripe.Account;
      const user = await prisma.user.findFirst({ where: { stripeAccountId: account.id } });
      if (!user) return;

      const onboarded = Boolean(account.charges_enabled && account.details_submitted);
      const wasOnboarded = user.stripeOnboardedAt != null;

      if (onboarded && !wasOnboarded) {
        await prisma.user.update({ where: { id: user.id }, data: { stripeOnboardedAt: new Date() } });
        await notify(user.id, NotificationType.SYSTEM, "Payouts are set up",
          "Your Stripe account is connected and ready — buyers can now pay you through Brindle.");
      } else if (!onboarded && wasOnboarded) {
        // The important case the poll-only approach missed entirely.
        await prisma.user.update({ where: { id: user.id }, data: { stripeOnboardedAt: null } });
        await notify(user.id, NotificationType.SYSTEM, "Action needed on your payout account",
          "Stripe has paused charges on your connected account. Open your seller console to finish what they need.");
      }
      return;
    }

    case "payment_intent.succeeded": {
      const pi = event.data.object as Stripe.PaymentIntent;
      await prisma.payment.updateMany({
        where: { stripePaymentId: pi.id },
        data: { status: PaymentStatus.CAPTURED },
      });
      return;
    }

    case "payment_intent.payment_failed": {
      const pi = event.data.object as Stripe.PaymentIntent;
      const payment = await prisma.payment.findFirst({ where: { stripePaymentId: pi.id } });
      if (!payment) return;
      await prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.PENDING } });
      await notify(payment.buyerId, NotificationType.SYSTEM, "Your payment didn't go through",
        "The card on your winning lot was declined. Update your payment method to complete the sale.",
        `/lots/${payment.lotId}`);
      return;
    }

    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge;
      if (typeof charge.payment_intent !== "string") return;
      await prisma.payment.updateMany({
        where: { stripePaymentId: charge.payment_intent },
        data: { status: PaymentStatus.REFUNDED },
      });
      return;
    }

    // A card-network dispute (distinct from our own in-app dispute flow) —
    // flag the payment so nobody treats those funds as settled.
    case "charge.dispute.created": {
      const dispute = event.data.object as Stripe.Dispute;
      if (typeof dispute.payment_intent !== "string") return;
      const payment = await prisma.payment.findFirst({
        where: { stripePaymentId: dispute.payment_intent },
      });
      if (!payment) return;
      await prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.DISPUTED } });
      await notify(payment.sellerId, NotificationType.DISPUTE_UPDATE, "A buyer opened a card dispute",
        "A payment on one of your lots is being disputed through the card network. Brindle will be in touch.",
        `/lots/${payment.lotId}`);
      return;
    }

    default:
      // Unhandled event types are acknowledged, not errored — Stripe sends
      // plenty we don't subscribe to logically.
      return;
  }
}
