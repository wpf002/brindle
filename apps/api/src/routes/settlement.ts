import type { FastifyInstance } from "fastify";
import {
  prisma,
  SettlementMode,
  PaymentStatus,
  LotStatus,
  type PriceUnit,
} from "@brindle/db";
import {
  totalFromCwt,
  totalFromHead,
  totalFromDose,
  type Cents,
} from "@brindle/core";
import { PrismaLotStateStore } from "../sequencer/prismaStore.js";
import { requireAuth } from "../auth.js";
import { makePaymentService, PLATFORM_FEE_BPS } from "../settlement.js";

// Compute the lot total from the winning per-unit price using the centralized
// cattle math — never inline arithmetic here.
function lotTotalCents(
  priceUnit: PriceUnit,
  perUnitCents: Cents,
  lot: { avgWeightLbs: unknown; headCount: number | null; dosesAvailable: number | null },
): Cents {
  switch (priceUnit) {
    case "CWT":
      return totalFromCwt(perUnitCents, Number(lot.avgWeightLbs ?? 0), lot.headCount ?? 0);
    case "HEAD":
      return totalFromHead(perUnitCents, lot.headCount ?? 0);
    case "DOSE":
    case "EMBRYO":
      return totalFromDose(perUnitCents, lot.dosesAvailable ?? 1);
    default:
      return perUnitCents;
  }
}

export async function settlementRoutes(app: FastifyInstance) {
  const payments = makePaymentService();
  const store = new PrismaLotStateStore();

  // Seller (or system) places the authorization hold once a lot is won.
  app.post<{ Params: { lotId: string } }>(
    "/lots/:lotId/settle",
    { preHandler: requireAuth },
    async (req, reply) => {
      const lot = await prisma.lot.findUnique({
        where: { id: req.params.lotId },
        include: { auction: { include: { seller: true } } },
      });
      if (!lot) return reply.code(404).send({ error: "LOT_NOT_FOUND" });
      if (lot.auction.settlementMode !== SettlementMode.INTEGRATED_PAYMENT) {
        return reply.code(409).send({ error: "NOT_INTEGRATED_PAYMENT_LOT" });
      }
      if (req.session!.userId !== lot.auction.sellerId) {
        return reply.code(403).send({ error: "NOT_LOT_SELLER" });
      }
      if (!lot.auction.seller.stripeAccountId) {
        return reply.code(409).send({ error: "SELLER_NOT_ONBOARDED" });
      }

      const state = await store.load(lot.id);
      if (!state?.highBidderId) {
        return reply.code(409).send({ error: "NO_WINNING_BID" });
      }

      const hammerCents = lotTotalCents(lot.priceUnit, state.highBidCents, lot);
      const record = await payments.holdAtHammer({
        lotId: lot.id,
        buyerId: state.highBidderId,
        sellerId: lot.auction.sellerId,
        sellerAccountId: lot.auction.seller.stripeAccountId,
        hammerCents,
        buyerPremiumBps: lot.auction.buyerPremiumBps,
        platformFeeBps: PLATFORM_FEE_BPS,
      });

      const payment = await prisma.payment.upsert({
        where: { lotId: lot.id },
        create: {
          lotId: lot.id,
          buyerId: record.buyerId,
          sellerId: record.sellerId,
          amountCents: record.amountCents,
          platformFeeCents: record.platformFeeCents,
          stripePaymentId: record.gatewayRef,
          status: PaymentStatus.HELD,
        },
        update: {
          stripePaymentId: record.gatewayRef,
          amountCents: record.amountCents,
          platformFeeCents: record.platformFeeCents,
          status: PaymentStatus.HELD,
        },
      });
      await prisma.lot.update({ where: { id: lot.id }, data: { status: LotStatus.SOLD } });

      return { paymentId: payment.id, status: payment.status, fees: record.fees };
    },
  );

  // Seller confirms the lot ships → capture the held funds.
  app.post<{ Params: { paymentId: string } }>(
    "/payments/:paymentId/capture",
    { preHandler: requireAuth },
    async (req, reply) => {
      const payment = await prisma.payment.findUnique({ where: { id: req.params.paymentId } });
      if (!payment) return reply.code(404).send({ error: "PAYMENT_NOT_FOUND" });
      if (req.session!.userId !== payment.sellerId) {
        return reply.code(403).send({ error: "NOT_PAYMENT_SELLER" });
      }
      if (!payment.stripePaymentId) return reply.code(409).send({ error: "NO_GATEWAY_REF" });

      await payments.captureOnConfirm(payment.lotId, payment.stripePaymentId);
      const updated = await prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.CAPTURED },
      });
      return { paymentId: updated.id, status: updated.status };
    },
  );

  // Refund after capture (dispute resolution). Optional partial amount in cents.
  app.post<{ Params: { paymentId: string }; Body: { amountCents?: string | number } }>(
    "/payments/:paymentId/refund",
    { preHandler: requireAuth },
    async (req, reply) => {
      const payment = await prisma.payment.findUnique({ where: { id: req.params.paymentId } });
      if (!payment) return reply.code(404).send({ error: "PAYMENT_NOT_FOUND" });
      if (req.session!.userId !== payment.sellerId) {
        return reply.code(403).send({ error: "NOT_PAYMENT_SELLER" });
      }
      if (!payment.stripePaymentId) return reply.code(409).send({ error: "NO_GATEWAY_REF" });

      const amount = req.body?.amountCents != null ? BigInt(req.body.amountCents) : null;
      await payments.refund(payment.lotId, payment.stripePaymentId, amount);
      const updated = await prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.REFUNDED },
      });
      return { paymentId: updated.id, status: updated.status };
    },
  );
}
