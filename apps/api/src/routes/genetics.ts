import type { FastifyInstance } from "fastify";
import { prisma } from "@brindle/db";
import {
  compareBulls,
  summarizeWins,
  parseEpdSet,
  ANGUS_TRAITS,
  type BullEpdInput,
} from "@brindle/genetics";

export async function geneticsRoutes(app: FastifyInstance) {
  // Side-by-side EPD comparison for a set of genetics lots. Public — comparison
  // context is exactly what should be visible before a buyer commits to bidding.
  app.post<{ Body: { lotIds?: string[] } }>("/genetics/compare", async (req, reply) => {
    const lotIds = req.body?.lotIds;
    if (!Array.isArray(lotIds) || lotIds.length === 0) {
      return reply.code(400).send({ error: "LOT_IDS_REQUIRED" });
    }

    const lots = await prisma.lot.findMany({
      where: { id: { in: lotIds } },
      select: { id: true, bullName: true, bullRegId: true, lotNumber: true, epd: true },
    });

    const traits = ANGUS_TRAITS;
    const bulls: BullEpdInput[] = lots.map((l) => ({
      id: l.id,
      name: l.bullName ?? `Lot ${l.lotNumber}`,
      epd: parseEpdSet(l.epd, traits).epd,
    }));

    const comparison = compareBulls(bulls, traits);
    return {
      bulls: lots.map((l) => ({ id: l.id, name: l.bullName ?? `Lot ${l.lotNumber}`, regId: l.bullRegId })),
      traits,
      comparison,
      wins: summarizeWins(comparison),
    };
  });
}
