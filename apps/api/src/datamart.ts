import { prisma } from "@brindle/db";
import { normalizeDataMartRow, type DataMartDetailRow } from "@brindle/market-data";

// Client for USDA AMS's Livestock Mandatory Price Reporting DataMart. This is
// the one AMS cattle price API that is genuinely free and requires no API key —
// verified against the live service. The separate MyMarketNews API (richer
// feeder-cattle auction data) does require a key; see AMS_MMN_API_KEY handling
// in market.ts for that path.
const BASE = process.env.AMS_DATAMART_BASE ?? "https://mpr.datamart.ams.usda.gov/services/v1.1";

// Reports worth syncing by default. Slug ids are stable AMS report identifiers.
export const DEFAULT_REPORTS = [
  { slug: "2466", label: "5 Area Daily Weighted Average Direct Slaughter Cattle — Negotiated (LM_CT100)" },
  { slug: "2477", label: "5 Area Weekly Weighted Average Direct Slaughter Cattle (LM_CT150)" },
];

interface DetailResponse {
  results?: DataMartDetailRow[];
  stats?: Record<string, number>;
}

/**
 * Fetch one report's Detail rows. Without a date filter this endpoint returns
 * the report's entire history (tens of MB), so a date filter is strongly
 * preferred — `reportDate` is MM/DD/YYYY, matching AMS's own format.
 */
export async function fetchDataMartDetail(slug: string, reportDate?: string): Promise<DataMartDetailRow[]> {
  const qs = reportDate ? `?q=report_date=${encodeURIComponent(reportDate)}` : "";
  const res = await fetch(`${BASE}/reports/${slug}/detail${qs}`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`DataMart ${slug} fetch failed: ${res.status}`);
  const body = (await res.json()) as DetailResponse;
  return body.results ?? [];
}

function formatUsDate(d: Date): string {
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
}

export interface SyncResult {
  slug: string;
  fetched: number;
  usable: number;
  upserted: number;
  error?: string;
}

/**
 * Pull the last `days` of each report into MarketReport rows. Idempotent — the
 * MarketReport natural key means re-running a sync updates in place rather than
 * duplicating, so this is safe to run on a schedule.
 */
export async function syncDataMart(days = 7, slugs: string[] = DEFAULT_REPORTS.map((r) => r.slug)): Promise<SyncResult[]> {
  const out: SyncResult[] = [];

  for (const slug of slugs) {
    const result: SyncResult = { slug, fetched: 0, usable: 0, upserted: 0 };
    try {
      for (let i = 0; i < days; i++) {
        const day = new Date();
        day.setDate(day.getDate() - i);
        const rows = await fetchDataMartDetail(slug, formatUsDate(day));
        result.fetched += rows.length;

        for (const row of rows) {
          const comp = normalizeDataMartRow(row);
          if (!comp) continue; // rows without a reported price are normal in this feed
          result.usable += 1;

          await prisma.marketReport.upsert({
            where: {
              source_category_wtLowLbs_wtHighLbs_reportDate: {
                source: comp.source,
                category: comp.category,
                wtLowLbs: comp.weightBandLbs[0],
                wtHighLbs: comp.weightBandLbs[1],
                reportDate: new Date(comp.reportDate),
              },
            },
            create: {
              reportDate: new Date(comp.reportDate),
              region: comp.region,
              category: comp.category,
              wtLowLbs: comp.weightBandLbs[0],
              wtHighLbs: comp.weightBandLbs[1],
              avgCentsPerCwt: comp.weightedAvgCentsPerCwt,
              headCount: comp.headCount,
              source: comp.source,
            },
            update: {
              avgCentsPerCwt: comp.weightedAvgCentsPerCwt,
              headCount: comp.headCount,
              region: comp.region,
            },
          });
          result.upserted += 1;
        }
      }
    } catch (e) {
      result.error = e instanceof Error ? e.message : String(e);
    }
    out.push(result);
  }

  return out;
}
