import type { FastifyInstance } from "fastify";
import { prisma, DeliveryMethod, DeliveryStatus } from "@brindle/db";
import { requireAuth } from "../auth.js";

// Post-sale logistics handoff for a won lot — pickup/shipping contact info and
// status, visible to both the buyer and the seller of that specific lot only.
async function loadPartyLot(lotId: string) {
  return prisma.lot.findUnique({
    where: { id: lotId },
    include: {
      auction: { select: { sellerId: true } },
      bids: { orderBy: { seq: "desc" }, take: 1, select: { bidderId: true } },
    },
  });
}

function assertParty(lot: NonNullable<Awaited<ReturnType<typeof loadPartyLot>>>, userId: string): boolean {
  const winningBidderId = lot.bids[0]?.bidderId;
  return userId === lot.auction.sellerId || userId === winningBidderId;
}

export async function deliveryRoutes(app: FastifyInstance) {
  app.get<{ Params: { lotId: string } }>("/lots/:lotId/delivery", { preHandler: requireAuth }, async (req, reply) => {
    const lot = await loadPartyLot(req.params.lotId);
    if (!lot) return reply.code(404).send({ error: "LOT_NOT_FOUND" });
    if (!assertParty(lot, req.session!.userId)) return reply.code(403).send({ error: "NOT_A_PARTY_TO_THIS_LOT" });

    const delivery = await prisma.delivery.findUnique({ where: { lotId: lot.id } });
    return { delivery, storageFacility: lot.storageFacility };
  });

  app.put<{
    Params: { lotId: string };
    Body: {
      method?: DeliveryMethod; contactName?: string; contactPhone?: string;
      contactEmail?: string; address?: string; status?: DeliveryStatus; notes?: string;
    };
  }>("/lots/:lotId/delivery", { preHandler: requireAuth }, async (req, reply) => {
    const lot = await loadPartyLot(req.params.lotId);
    if (!lot) return reply.code(404).send({ error: "LOT_NOT_FOUND" });
    if (!assertParty(lot, req.session!.userId)) return reply.code(403).send({ error: "NOT_A_PARTY_TO_THIS_LOT" });

    const b = req.body ?? {};
    const delivery = await prisma.delivery.upsert({
      where: { lotId: lot.id },
      update: {
        method: b.method, contactName: b.contactName, contactPhone: b.contactPhone,
        contactEmail: b.contactEmail, address: b.address, status: b.status, notes: b.notes,
      },
      create: {
        lotId: lot.id,
        method: b.method ?? DeliveryMethod.PICKUP,
        contactName: b.contactName, contactPhone: b.contactPhone,
        contactEmail: b.contactEmail, address: b.address,
        status: b.status ?? DeliveryStatus.PENDING,
        notes: b.notes,
      },
    });
    return { delivery };
  });
}
