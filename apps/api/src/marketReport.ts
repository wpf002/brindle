import { prisma } from "@brindle/db";
import { buildMarketPost, type ReportRow, type MarketPostDraft } from "@brindle/market-data";
import { DAILY_REPORT_SOURCE } from "./datamart.js";

// Publishes the automated Market Report posts.
//
// The writing itself lives in @brindle/market-data as a pure function; this is
// just the database either side of it — find the report dates we hold, hand the
// rows over, upsert what comes back.

/** Dates the daily report covers, newest first. */
async function reportDates(limit: number): Promise<string[]> {
  const rows = await prisma.marketReport.findMany({
    where: { source: DAILY_REPORT_SOURCE },
    distinct: ["reportDate"],
    orderBy: { reportDate: "desc" },
    select: { reportDate: true },
    take: limit,
  });
  return rows.map((r) => isoDate(r.reportDate));
}

/** A DateTime column holding a date — take the UTC calendar day, not local. */
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function rowsFor(isoDay: string): Promise<ReportRow[]> {
  return prisma.marketReport.findMany({
    // Scoped to the daily report. The weekly one carries the same dates and the
    // same class names but covers the week to date, so mixing them would count
    // the same cattle twice — buildMarketPost filters again for the same reason.
    where: { reportDate: new Date(`${isoDay}T00:00:00.000Z`), source: DAILY_REPORT_SOURCE },
    select: {
      category: true, region: true, wtLowLbs: true, wtHighLbs: true,
      avgCentsPerCwt: true, headCount: true, source: true,
    },
  });
}

async function publish(draft: MarketPostDraft): Promise<void> {
  const data = {
    title: draft.title,
    dek: draft.dek,
    body: draft.body,
    category: draft.category,
    authorName: draft.authorName,
    authorTitle: draft.authorTitle,
    publishedAt: new Date(`${draft.publishedAt}T12:00:00.000Z`),
  };
  // Upsert on the date-derived slug. A re-run after a late USDA revision
  // rewrites that day's post with the corrected numbers instead of publishing
  // a second one — the whole reason the slug is derived from the date.
  await prisma.newsPost.upsert({
    where: { slug: draft.slug },
    create: { slug: draft.slug, ...data },
    update: data,
  });
}

export interface GenerateResult {
  reportDate: string;
  published: boolean;
  slug?: string;
  title?: string;
  reason?: string;
}

/**
 * Write up the most recent `days` report dates we hold.
 *
 * Regenerating recent days rather than only the newest is deliberate: AMS
 * revises reports after the fact, and a report published on a thin day may
 * become publishable once the rest of the day's rows land.
 */
export async function generateMarketReports(days = 3): Promise<GenerateResult[]> {
  const dates = await reportDates(days);
  const out: GenerateResult[] = [];

  for (const date of dates) {
    const rows = await rowsFor(date);

    // The prior date we actually hold, which on a Monday is the previous
    // business day rather than "yesterday" — reading it from the data avoids
    // inventing a comparison against a day that was never reported.
    const [previousDate] = (
      await prisma.marketReport.findMany({
        where: {
          reportDate: { lt: new Date(`${date}T00:00:00.000Z`) },
          source: DAILY_REPORT_SOURCE,
        },
        distinct: ["reportDate"],
        orderBy: { reportDate: "desc" },
        select: { reportDate: true },
        take: 1,
      })
    ).map((r) => isoDate(r.reportDate));

    const draft = buildMarketPost({
      reportDate: date,
      source: DAILY_REPORT_SOURCE,
      rows,
      previous: previousDate
        ? { reportDate: previousDate, rows: await rowsFor(previousDate) }
        : undefined,
    });

    if (!draft) {
      out.push({ reportDate: date, published: false, reason: "NO_PRICED_ROWS" });
      continue;
    }

    await publish(draft);
    out.push({ reportDate: date, published: true, slug: draft.slug, title: draft.title });
  }

  return out;
}
