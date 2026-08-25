import type { FastifyInstance } from "fastify";
import { prisma, BuyOrderStatus, type LotCategory } from "@brindle/db";
import { requireAuth } from "../auth.js";

// Order-buyer tooling.
//
// An order buyer is buying for someone else — a feedlot filling pen space, a
// packer, a rancher who can't attend — and works many lots across many barns
// against a single mandate. A bid button alone is useless to them: the question
// they need answered on every lot is "does this fit an order I'm working, and
// what can I pay without blowing its average?"
//
// Everything here is scoped to the signed-in buyer. Orders are commercially
// sensitive — knowing what a rival is filling is knowing what they'll bid.

function serialize<T>(v: T): T {
  return JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));
}

interface OrderTotals {
  filledHead: number;
  remainingHead: number;
  /** Head-weighted average of what's been paid, in the order's unit. */
  avgPaidCents: number | null;
  /**
   * The most that can be paid for the remaining head while still landing at or
   * under the order's ceiling on average — the number an order buyer actually
   * bids to, which is not the ceiling once they've overpaid on an early lot.
   */
  headroomCents: number | null;
}

function totals(order: {
  targetHead: number;
  maxPriceCents: bigint;
  fills: { headCount: number; priceCents: bigint }[];
}): OrderTotals {
  const filledHead = order.fills.reduce((n, f) => n + f.headCount, 0);
  const remainingHead = Math.max(0, order.targetHead - filledHead);

  const spent = order.fills.reduce((n, f) => n + f.priceCents * BigInt(f.headCount), 0n);
  const avgPaidCents = filledHead > 0 ? Number(spent / BigInt(filledHead)) : null;

  let headroomCents: number | null = null;
  if (remainingHead > 0) {
    // Budget for the whole order at the ceiling, less what's already committed,
    // spread over what's left.
    const budget = order.maxPriceCents * BigInt(order.targetHead);
    const left = budget - spent;
    headroomCents = left > 0n ? Number(left / BigInt(remainingHead)) : 0;
  }

  return { filledHead, remainingHead, avgPaidCents, headroomCents };
}

export async function orderRoutes(app: FastifyInstance) {
  app.post<{
    Body: {
      clientName?: string; category?: LotCategory; targetHead?: number;
      maxPriceCents?: string | number; minWeightLbs?: number; maxWeightLbs?: number;
      region?: string; notes?: string;
    };
  }>("/orders", { preHandler: requireAuth }, async (req, reply) => {
    const b = req.body ?? {};
    if (!b.clientName?.trim() || !b.category || !b.targetHead || b.maxPriceCents == null) {
      return reply.code(400).send({ error: "CLIENT_CLASS_HEAD_AND_CEILING_REQUIRED" });
    }
    if (b.targetHead <= 0) return reply.code(400).send({ error: "TARGET_HEAD_MUST_BE_POSITIVE" });

    const order = await prisma.buyOrder.create({
      data: {
        buyerId: req.session!.userId,
        clientName: b.clientName.trim(),
        category: b.category,
        targetHead: b.targetHead,
        maxPriceCents: BigInt(b.maxPriceCents),
        minWeightLbs: b.minWeightLbs ?? null,
        maxWeightLbs: b.maxWeightLbs ?? null,
        region: b.region ?? null,
        notes: b.notes ?? null,
      },
    });
    return { orderId: order.id };
  });

  /** The buyer's book: every order with its fill progress. */
  app.get("/orders", { preHandler: requireAuth }, async (req) => {
    const orders = await prisma.buyOrder.findMany({
      where: { buyerId: req.session!.userId },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      include: {
        fills: {
          include: { lot: { select: { id: true, lotNumber: true, bullName: true, category: true } } },
        },
      },
    });
    return serialize({
      orders: orders.map((o) => ({ ...o, ...totals(o) })),
    });
  });

  /**
   * Which of the buyer's open orders a given lot would satisfy.
   *
   * This is the piece that turns a catalog into a work list — an order buyer
   * scanning a sale wants the lot to tell them which client it's for, not to
   * hold four orders in their head while the ring moves.
   */
  app.get<{ Params: { lotId: string } }>(
    "/lots/:lotId/matching-orders",
    { preHandler: requireAuth },
    async (req, reply) => {
      const lot = await prisma.lot.findUnique({
        where: { id: req.params.lotId },
        select: { id: true, category: true, avgWeightLbs: true, headCount: true, originState: true },
      });
      if (!lot) return reply.code(404).send({ error: "LOT_NOT_FOUND" });

      const open = await prisma.buyOrder.findMany({
        where: { buyerId: req.session!.userId, status: BuyOrderStatus.OPEN, category: lot.category },
        include: { fills: { select: { headCount: true, priceCents: true } } },
      });

      const weight = lot.avgWeightLbs != null ? Number(lot.avgWeightLbs) : null;
      const matches = open
        .filter((o) => {
          // A lot outside the order's weight window doesn't fit, and a filled
          // order isn't looking for more.
          if (o.minWeightLbs != null && (weight == null || weight < o.minWeightLbs)) return false;
          if (o.maxWeightLbs != null && (weight == null || weight > o.maxWeightLbs)) return false;
          if (o.region && lot.originState && o.region !== lot.originState) return false;
          return totals(o).remainingHead > 0;
        })
        .map((o) => ({ ...o, ...totals(o) }));

      return serialize({ matches });
    },
  );

  /** Record a lot bought against an order. */
  app.post<{ Params: { id: string }; Body: { lotId?: string; headCount?: number; priceCents?: string | number } }>(
    "/orders/:id/fills",
    { preHandler: requireAuth },
    async (req, reply) => {
      const b = req.body ?? {};
      if (!b.lotId || !b.headCount || b.priceCents == null) {
        return reply.code(400).send({ error: "LOT_HEAD_AND_PRICE_REQUIRED" });
      }
      const order = await prisma.buyOrder.findUnique({
        where: { id: req.params.id },
        include: { fills: true },
      });
      if (!order) return reply.code(404).send({ error: "ORDER_NOT_FOUND" });
      if (order.buyerId !== req.session!.userId) return reply.code(403).send({ error: "NOT_YOUR_ORDER" });

      await prisma.buyOrderFill.upsert({
        where: { orderId_lotId: { orderId: order.id, lotId: b.lotId } },
        update: { headCount: b.headCount, priceCents: BigInt(b.priceCents) },
        create: {
          orderId: order.id, lotId: b.lotId,
          headCount: b.headCount, priceCents: BigInt(b.priceCents),
        },
      });

      const fresh = await prisma.buyOrder.findUniqueOrThrow({
        where: { id: order.id }, include: { fills: true },
      });
      const t = totals(fresh);
      // Close the order once it's full, so it stops matching new lots.
      if (t.remainingHead === 0 && fresh.status === BuyOrderStatus.OPEN) {
        await prisma.buyOrder.update({
          where: { id: order.id }, data: { status: BuyOrderStatus.FILLED },
        });
      }
      return serialize({ ...t, status: t.remainingHead === 0 ? "FILLED" : fresh.status });
    },
  );

  app.post<{ Params: { id: string } }>("/orders/:id/cancel", { preHandler: requireAuth }, async (req, reply) => {
    const order = await prisma.buyOrder.findUnique({ where: { id: req.params.id } });
    if (!order) return reply.code(404).send({ error: "ORDER_NOT_FOUND" });
    if (order.buyerId !== req.session!.userId) return reply.code(403).send({ error: "NOT_YOUR_ORDER" });
    await prisma.buyOrder.update({ where: { id: order.id }, data: { status: BuyOrderStatus.CANCELLED } });
    return { cancelled: true };
  });
}
