import type { FastifyInstance } from "fastify";
import {
  prisma, Prisma, CatalogImportStatus,
  type LotCategory, type PriceUnit,
} from "@brindle/db";
import { parseCatalogCsv, type LotDraft } from "@brindle/catalog";
import { requireAuth } from "../auth.js";

// Bulk catalog import: a seller pastes/uploads their existing sale-catalog CSV
// (whatever tool exported it) and gets lots created in one shot. Two steps by
// design — preview first so the seller can see the column mapping and row
// errors before anything is written.
export async function catalogImportRoutes(app: FastifyInstance) {
  app.post<{ Body: { csv?: string; defaultCategory?: string } }>(
    "/console/catalog/preview",
    { preHandler: requireAuth },
    async (req, reply) => {
      const csv = req.body?.csv;
      if (!csv?.trim()) return reply.code(400).send({ error: "CSV_REQUIRED" });
      const parsed = parseCatalogCsv(csv, { defaultCategory: req.body?.defaultCategory });
      return {
        columns: parsed.columns,
        epdColumns: parsed.epdColumns,
        lots: parsed.lots,
        errors: parsed.errors,
        summary: { parsed: parsed.lots.length, failed: parsed.errors.length },
      };
    },
  );

  app.post<{
    Params: { auctionId: string };
    Body: { csv?: string; filename?: string; defaultCategory?: string };
  }>("/console/auctions/:auctionId/catalog/commit", { preHandler: requireAuth }, async (req, reply) => {
    const csv = req.body?.csv;
    if (!csv?.trim()) return reply.code(400).send({ error: "CSV_REQUIRED" });

    const auction = await prisma.auction.findUnique({ where: { id: req.params.auctionId } });
    if (!auction) return reply.code(404).send({ error: "AUCTION_NOT_FOUND" });
    if (auction.sellerId !== req.session!.userId) {
      return reply.code(403).send({ error: "NOT_AUCTION_SELLER" });
    }

    const parsed = parseCatalogCsv(csv, { defaultCategory: req.body?.defaultCategory });
    const errors = [...parsed.errors];
    let created = 0;

    for (const draft of parsed.lots) {
      try {
        await prisma.lot.create({ data: toLotCreate(draft, auction.id) });
        created += 1;
      } catch (e) {
        // A lot number already used in this auction is the common case; report
        // it against the row rather than failing the whole import.
        const message =
          e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002"
            ? `Lot ${draft.lotNumber} already exists in this auction`
            : `Lot ${draft.lotNumber} could not be created`;
        errors.push({ row: draft.lotNumber, message });
      }
    }

    const record = await prisma.catalogImport.create({
      data: {
        sellerId: req.session!.userId,
        auctionId: auction.id,
        filename: req.body?.filename ?? "catalog.csv",
        status: created > 0 ? CatalogImportStatus.COMMITTED : CatalogImportStatus.FAILED,
        rowCount: parsed.lots.length + parsed.errors.length,
        createdCount: created,
        errorLog: errors as unknown as Prisma.InputJsonValue,
      },
    });

    return { importId: record.id, created, errors, status: record.status };
  });

  app.get("/console/catalog/imports", { preHandler: requireAuth }, async (req) => {
    const imports = await prisma.catalogImport.findMany({
      where: { sellerId: req.session!.userId },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { auction: { select: { name: true } } },
    });
    return { imports };
  });
}

function toLotCreate(draft: LotDraft, auctionId: string): Prisma.LotUncheckedCreateInput {
  return {
    auctionId,
    lotNumber: draft.lotNumber,
    category: draft.category as LotCategory,
    priceUnit: draft.priceUnit as PriceUnit,
    startingBidCents: BigInt(draft.startingBidCents),
    ...(draft.bidIncrementCents ? { bidIncrementCents: BigInt(draft.bidIncrementCents) } : {}),
    ...(draft.reserveCents ? { reserveCents: BigInt(draft.reserveCents) } : {}),
    bullName: draft.bullName ?? null,
    bullRegId: draft.bullRegId ?? null,
    primaryBreed: draft.primaryBreed ?? null,
    originState: draft.originState ?? null,
    storageFacility: draft.storageFacility ?? null,
    photoCredit: draft.photoCredit ?? null,
    headCount: draft.headCount ?? null,
    dosesAvailable: draft.dosesAvailable ?? null,
    avgWeightLbs: draft.avgWeightLbs ?? null,
    postThawMotility: draft.postThawMotility ?? null,
    ...(draft.epd ? { epd: draft.epd as unknown as Prisma.InputJsonValue } : {}),
  };
}
