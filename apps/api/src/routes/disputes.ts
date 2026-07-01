import type { FastifyInstance } from "fastify";
import { prisma, DisputeStatus, DisputeClaim, PaymentStatus } from "@brindle/db";
import { disputeTransition, type DisputeAction } from "@brindle/settlement";
import { requireAuth, requireAdmin } from "../auth.js";
import { makePaymentService } from "../settlement.js";

export async function disputeRoutes(app: FastifyInstance) {
  const payments = makePaymentService();

  // Buyer files a claim on a won lot. Any held payment is flagged DISPUTED so it
  // can't be captured while the claim is open.
  app.post<{ Params: { lotId: string }; Body: { claim?: DisputeClaim; detail?: string; evidence?: string[] } }>(
    "/lots/:lotId/disputes",
    { preHandler: requireAuth },
    async (req, reply) => {
      const { claim, detail, evidence } = req.body ?? {};
      if (!claim || !detail) return reply.code(400).send({ error: "CLAIM_AND_DETAIL_REQUIRED" });

      const lot = await prisma.lot.findUnique({ where: { id: req.params.lotId } });
      if (!lot) return reply.code(404).send({ error: "LOT_NOT_FOUND" });

      const dispute = await prisma.dispute.create({
        data: {
          lotId: lot.id,
          filedById: req.session!.userId,
          claim,
          detail,
          evidence: evidence ?? [],
          status: DisputeStatus.OPEN,
        },
      });
      await prisma.payment.updateMany({
        where: { lotId: lot.id, status: PaymentStatus.HELD },
        data: { status: PaymentStatus.DISPUTED },
      });
      return { disputeId: dispute.id, status: dispute.status };
    },
  );

  app.get<{ Params: { lotId: string } }>("/lots/:lotId/disputes", async (req) => {
    const disputes = await prisma.dispute.findMany({
      where: { lotId: req.params.lotId },
      orderBy: { createdAt: "desc" },
    });
    return { disputes };
  });

  // Arbiter advances the dispute; fund side effects follow the pure transition.
  app.post<{ Params: { id: string }; Body: { action?: DisputeAction } }>(
    "/disputes/:id/transition",
    { preHandler: requireAdmin },
    async (req, reply) => {
      const action = req.body?.action;
      if (!action) return reply.code(400).send({ error: "ACTION_REQUIRED" });

      const dispute = await prisma.dispute.findUnique({ where: { id: req.params.id } });
      if (!dispute) return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });

      const t = disputeTransition(dispute.status, action);
      if (!t.ok) return reply.code(409).send({ error: t.reason });

      const payment = await prisma.payment.findUnique({ where: { lotId: dispute.lotId } });
      if (payment?.stripePaymentId) {
        if (t.refundsFunds) {
          await payments.refund(dispute.lotId, payment.stripePaymentId, null);
          await prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.REFUNDED } });
        } else if (t.capturesFunds) {
          await payments.captureOnConfirm(dispute.lotId, payment.stripePaymentId);
          await prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.CAPTURED } });
        }
      }

      const updated = await prisma.dispute.update({
        where: { id: dispute.id },
        data: { status: t.next, resolvedAt: ["RESOLVED_REFUND", "RESOLVED_RELEASE", "WITHDRAWN"].includes(t.next) ? new Date() : null },
      });
      return { disputeId: updated.id, status: updated.status };
    },
  );

  // The immutable bid log — the dispute record. Append-only, ordered by seq.
  app.get<{ Params: { lotId: string } }>(
    "/lots/:lotId/bids",
    { preHandler: requireAuth },
    async (req) => {
      const bids = await prisma.bid.findMany({
        where: { lotId: req.params.lotId },
        orderBy: { seq: "asc" },
        select: { seq: true, bidderId: true, amountCents: true, kind: true, streamId: true, createdAt: true },
      });
      return {
        log: bids.map((b) => ({ ...b, seq: b.seq.toString(), amountCents: b.amountCents.toString() })),
      };
    },
  );
}
