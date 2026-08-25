import type { FastifyInstance } from "fastify";
import { prisma } from "@brindle/db";
import { normalizeAmsRow, type AmsRow } from "@brindle/market-data";
import { requireOperator } from "../auth.js";
import { queryComparables } from "../marketQuery.js";
import { estimateForLot } from "../bidEstimate.js";

export async function marketRoutes(app: FastifyInstance) {
  // Ingest AMS rows (admin/back-office). Idempotent on the natural key.
  app.post<{ Body: { rows?: AmsRow[] } }>(
    "/market/ingest",
    { preHandler: requireOperator },
    async (req, reply) => {
      const rows = req.body?.rows;
      if (!Array.isArray(rows)) return reply.code(400).send({ error: "ROWS_REQUIRED" });

      let upserted = 0;
      for (const row of rows) {
        const c = normalizeAmsRow(row);
        const key = {
          source_category_wtLowLbs_wtHighLbs_reportDate: {
            source: c.source,
            category: c.category,
            wtLowLbs: c.weightBandLbs[0],
            wtHighLbs: c.weightBandLbs[1],
            reportDate: new Date(c.reportDate),
          },
        };
        await prisma.marketReport.upsert({
          where: key,
          create: {
            reportDate: new Date(c.reportDate),
            region: c.region,
            category: c.category,
            wtLowLbs: c.weightBandLbs[0],
            wtHighLbs: c.weightBandLbs[1],
            avgCentsPerCwt: c.weightedAvgCentsPerCwt,
            headCount: c.headCount,
            source: c.source,
          },
          update: { avgCentsPerCwt: c.weightedAvgCentsPerCwt, headCount: c.headCount },
        });
        upserted += 1;
      }
      return { upserted };
    },
  );

  // Latest reported prices for the public market page. Returns every row from
  // the most recent report date we hold, ordered high to low.
  app.get("/market/latest", async () => {
    const newest = await prisma.marketReport.findFirst({
      orderBy: { reportDate: "desc" },
      select: { reportDate: true },
    });
    if (!newest) return { rows: [], asOf: null };

    const rows = await prisma.marketReport.findMany({
      where: { reportDate: newest.reportDate },
      orderBy: { avgCentsPerCwt: "desc" },
      take: 100,
    });
    return {
      asOf: newest.reportDate.toISOString().slice(0, 10),
      rows: rows.map((r) => ({ ...r, reportDate: r.reportDate.toISOString().slice(0, 10) })),
    };
  });

  // Comparable-sale context for a class + weight — rendered at the bid box.
  app.get<{
    Querystring: { category?: string; weight?: string; region?: string; asOf?: string; head?: string };
  }>("/market/comparables", async (req, reply) => {
    const { category, weight, region, asOf, head } = req.query;
    if (!category || !weight) return reply.code(400).send({ error: "CATEGORY_AND_WEIGHT_REQUIRED" });
    return queryComparables({
      category, weightLbs: Number(weight), region, asOf, head: head != null ? Number(head) : undefined,
    });
  });

  /**
   * What a lot should bring, per hundredweight.
   *
   * Returns range: null with a reason rather than a number it can't stand
   * behind — a buyer will act on whatever this says.
   */
  app.get<{ Params: { lotId: string } }>("/lots/:lotId/estimate", async (req, reply) => {
    const est = await estimateForLot(req.params.lotId);
    if (!est) return reply.code(404).send({ error: "LOT_NOT_FOUND" });
    return est;
  });
}
