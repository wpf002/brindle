// Turns a day's USDA rows into a written market report.
//
// The Market Report category was the one part of the news desk nobody could
// keep up by hand — a daily price summary is exactly the sort of thing that
// goes stale the first week someone gets busy. We already pull the numbers
// every day, so the post writes itself from them.
//
// Everything here is pure: rows in, post draft out. No database, no clock, no
// locale lookups — the same rows always produce the same words, which is what
// makes it testable and makes a re-run safely idempotent.

/** A stored MarketReport row, narrowed to what the write-up actually reads. */
export interface ReportRow {
  category: string;
  region: string;
  wtLowLbs: number;
  wtHighLbs: number;
  avgCentsPerCwt: number;
  headCount: number;
  /** Which AMS report the row came from, e.g. "DATAMART-2466". */
  source: string;
}

export interface MarketPostDraft {
  slug: string;
  title: string;
  dek: string;
  body: string;
  category: "Market Report";
  authorName: string;
  authorTitle: string;
  publishedAt: string; // ISO date of the report itself, not of generation
}

/** The byline these carry. Deliberately not a person's name — nobody wrote it. */
export const MARKET_DESK_AUTHOR = "Brindle Market Desk";
export const MARKET_DESK_TITLE = "Compiled from USDA AMS data";

/**
 * Below this, AMS's own reporters would call the market "steady" rather than
 * up or down. Reporting a 12-cent move as a direction reads as noise.
 */
const STEADY_THRESHOLD_CENTS = 50; // $0.50/cwt

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2026-08-21" → "August 21, 2026". Explicit, so it can't drift with locale. */
export function formatReportDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/**
 * Trade terms AMS writes as acronyms. Title-casing blindly turns "FOB" into
 * "Fob", which reads as a typo to anyone in the business.
 */
const ACRONYMS = new Set(["FOB", "CWT", "USDA", "AMS", "LMPR", "NE", "TX", "KS", "CO", "IA", "MN", "MO"]);

/** AMS reports classes in caps ("STEER — DRESSED DELIVERED"); soften for prose. */
export function formatClassName(raw: string): string {
  return raw
    .split(/(\s+|—|-|\/)/) // keep separators so spacing, dashes and slashes survive
    .map((part) => {
      if (/^(\s+|—|-)$/.test(part) || part === "") return part;
      if (ACRONYMS.has(part.toUpperCase())) return part.toUpperCase();
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join("");
}

/** Integer cents per cwt → "$355.46". */
export function formatCwt(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * Head-weighted average price across rows.
 *
 * Weighted, not a plain mean: a 40-head class and a 4,000-head class are not
 * equally informative about where the market traded. Returns null when no row
 * reports any head, which happens on thin days.
 */
export function weightedAverageCents(rows: ReportRow[]): number | null {
  let head = 0;
  let total = 0;
  for (const r of rows) {
    if (r.headCount <= 0) continue;
    head += r.headCount;
    total += r.avgCentsPerCwt * r.headCount;
  }
  if (head === 0) return null;
  return Math.round(total / head);
}

function totalHead(rows: ReportRow[]): number {
  return rows.reduce((n, r) => n + Math.max(0, r.headCount), 0);
}

/**
 * How a price is quoted. This is the single most important distinction in the
 * feed and the easiest thing to get catastrophically wrong.
 *
 * Live prices are per hundredweight of the animal on the hoof (~$225 in current
 * markets); dressed prices are per hundredweight of the hanging carcass
 * (~$355). They describe the same cattle at the same moment. Averaging them
 * together produces a number that corresponds to nothing on earth, and calling
 * the gap between them a "spread" reports the dressing percentage as if it were
 * market news. So the two never mix — every figure below is per basis.
 */
export type PriceBasis = "live" | "dressed" | "other";

export function basisOf(category: string): PriceBasis {
  const c = category.toUpperCase();
  if (c.includes("DRESSED")) return "dressed";
  if (c.includes("LIVE")) return "live";
  return "other";
}

const BASIS_LABEL: Record<PriceBasis, string> = {
  live: "live",
  dressed: "dressed",
  other: "other",
};

function splitByBasis(rows: ReportRow[]): Record<PriceBasis, ReportRow[]> {
  const out: Record<PriceBasis, ReportRow[]> = { live: [], dressed: [], other: [] };
  for (const r of rows) out[basisOf(r.category)].push(r);
  return out;
}

/**
 * AMS reports each quote twice: once per sex class, and once as an "All Beef
 * Type" roll-up of those same cattle. On the 2026-08-21 report, "All Beef Type
 * — Live FOB" was 5,280 head and Steer + Heifer + Mixed on that quote came to
 * exactly 5,280.
 *
 * So the rows cannot simply be summed — doing so double-counts every animal and
 * reports twice the cattle that actually traded. Where a roll-up exists it is
 * the authority for head and average; the sex classes are the detail underneath
 * it, and are listed but never added to the total.
 */
function isRollup(category: string): boolean {
  return category.toUpperCase().trimStart().startsWith("ALL BEEF TYPE");
}

/**
 * The quote a class belongs to — "LIVE FOB", "DRESSED DELIVERED". A roll-up
 * only covers its own quote, so totals are taken one quote at a time.
 */
function quoteOf(category: string): string {
  const parts = category.split("—");
  return (parts.length > 1 ? parts.slice(1).join("—") : category).trim().toUpperCase();
}

/**
 * The rows that count toward a basis total: each quote's roll-up where AMS
 * published one, otherwise that quote's individual classes.
 */
function unduplicated(rows: ReportRow[]): ReportRow[] {
  const byQuote = new Map<string, ReportRow[]>();
  for (const r of rows) {
    const q = quoteOf(r.category);
    const list = byQuote.get(q);
    if (list) list.push(r);
    else byQuote.set(q, [r]);
  }

  const out: ReportRow[] = [];
  for (const list of byQuote.values()) {
    const rollups = list.filter((r) => isRollup(r.category));
    out.push(...(rollups.length > 0 ? rollups : list));
  }
  return out;
}

/**
 * Collapse rows to one line per class, head-weighted within the class.
 * Roll-ups are dropped: listing "All Beef Type" beside the Steer and Heifer
 * lines it is the sum of reads as a fourth class rather than their total.
 */
function byClass(all: ReportRow[]): { name: string; cents: number; head: number }[] {
  const detail = all.filter((r) => !isRollup(r.category));
  const rows = detail.length > 0 ? detail : all; // some quotes publish only the roll-up
  const groups = new Map<string, ReportRow[]>();
  for (const r of rows) {
    const list = groups.get(r.category);
    if (list) list.push(r);
    else groups.set(r.category, [r]);
  }

  const out: { name: string; cents: number; head: number }[] = [];
  for (const [name, list] of groups) {
    const cents = weightedAverageCents(list);
    if (cents == null) continue;
    out.push({ name: formatClassName(name), cents, head: totalHead(list) });
  }
  // Most-traded first — that's the class that best describes the day.
  return out.sort((a, b) => b.head - a.head);
}

function withCommas(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

export interface BuildInput {
  /** The report date being written up, as "YYYY-MM-DD". */
  reportDate: string;
  rows: ReportRow[];
  /**
   * Which AMS report to write up. Required, and rows from any other source are
   * discarded, because more than one AMS report carries the same date and the
   * same class names while meaning different things: the 5 Area Daily (2466)
   * covers one day's trade, the 5 Area Weekly (2477) covers the week to date
   * and therefore *contains* those same cattle. Blending them counts animals
   * twice and calls a week's trade a day's.
   */
  source: string;
  /** The previous report we hold, for the day-over-day comparison. Optional. */
  previous?: { reportDate: string; rows: ReportRow[] };
}


/** One price basis, summarised, with its day-over-day move. */
interface BasisSummary {
  basis: PriceBasis;
  label: string;
  cents: number;
  head: number;
  classes: { name: string; cents: number; head: number }[];
  /** Change vs the previous report *on the same basis*, or null if unknown. */
  deltaCents: number | null;
  previousCents: number | null;
}

function summarise(
  basis: PriceBasis,
  rows: ReportRow[],
  previousRows: ReportRow[] | null,
): BasisSummary | null {
  // Totals come from the de-duplicated set; the full rows are still what the
  // per-class detail is built from.
  const counted = unduplicated(rows);
  const cents = weightedAverageCents(counted);
  if (cents == null) return null;

  // Compared only against the same basis in the prior report. A live figure is
  // never measured against a dressed one.
  const previousCents = previousRows ? weightedAverageCents(unduplicated(previousRows)) : null;

  return {
    basis,
    label: BASIS_LABEL[basis],
    cents,
    head: totalHead(counted),
    classes: byClass(rows),
    deltaCents: previousCents == null ? null : cents - previousCents,
    previousCents,
  };
}

/** "up $2.14 from $353.29 on August 20, 2026" / "essentially unchanged…" */
function describeMove(s: BasisSummary, previousDate: string | undefined): string {
  if (s.deltaCents == null || !previousDate) return "with no prior report on hand to compare against";
  if (Math.abs(s.deltaCents) < STEADY_THRESHOLD_CENTS) {
    return `essentially unchanged from ${formatReportDate(previousDate)}`;
  }
  return (
    `${s.deltaCents > 0 ? "up" : "down"} ${formatCwt(Math.abs(s.deltaCents))} from ` +
    `${formatCwt(s.previousCents!)} on ${formatReportDate(previousDate)}`
  );
}

/**
 * Build the post, or null when there's nothing worth publishing — no rows, or
 * rows that report no head at all. Returning null rather than an empty post
 * matters: a news feed full of "no data today" entries is worse than a gap.
 */
export function buildMarketPost(input: BuildInput): MarketPostDraft | null {
  const { reportDate, source, previous } = input;

  // One source only — see BuildInput.source. Filtering here rather than
  // trusting the caller means a query that widens later can't silently start
  // producing double-counted posts.
  const rows = input.rows.filter((r) => r.source === source);
  if (rows.length === 0) return null;
  const previousRows = previous?.rows.filter((r) => r.source === source) ?? null;

  const today = splitByBasis(rows);
  const prior = previousRows ? splitByBasis(previousRows) : null;

  const order: PriceBasis[] = ["live", "dressed", "other"];
  const summaries = order
    .map((b) => summarise(b, today[b], prior ? prior[b] : null))
    .filter((s): s is BasisSummary => s !== null);

  if (summaries.length === 0) return null;

  const dateLabel = formatReportDate(reportDate);
  const head = summaries.reduce((n, s) => n + s.head, 0);

  // The headline carries whichever basis the most cattle traded on, always
  // labelled — an unlabelled fed-cattle price is ambiguous by half.
  const lead = [...summaries].sort((a, b) => b.head - a.head)[0]!;

  let move: string;
  if (lead.deltaCents == null) {
    move = `Fed Cattle at ${formatCwt(lead.cents)} ${lead.label}`;
  } else if (Math.abs(lead.deltaCents) < STEADY_THRESHOLD_CENTS) {
    move = `Fed Cattle Steady at ${formatCwt(lead.cents)} ${lead.label}`;
  } else {
    move =
      `Fed Cattle ${lead.deltaCents > 0 ? "Up" : "Down"} ` +
      `${formatCwt(Math.abs(lead.deltaCents))} to ${formatCwt(lead.cents)} ${lead.label}`;
  }
  const title = `${move} — ${dateLabel}`;

  const priceList = summaries.map((s) => `${formatCwt(s.cents)} ${s.label}`).join(", ");
  const dek =
    `${priceList} on ${withCommas(head)} ${plural(head, "head", "head")}, from the USDA's ` +
    `negotiated slaughter cattle report for ${dateLabel}.`;

  const paras: string[] = [];

  for (const s of summaries) {
    paras.push(
      `Negotiated slaughter cattle on a ${s.label} basis averaged ${formatCwt(s.cents)} per ` +
        `hundredweight on ${dateLabel}, ${describeMove(s, previous?.reportDate)}. Packers ` +
        `reported ${withCommas(s.head)} ${plural(s.head, "head", "head")} across ` +
        `${s.classes.length} ${plural(s.classes.length, "class", "classes")}.`,
    );

    const lines = s.classes
      .slice(0, 6)
      .map((c) => `${c.name}: ${formatCwt(c.cents)} on ${withCommas(c.head)} ${plural(c.head, "head", "head")}`);
    if (lines.length > 0) paras.push(`By class — ${lines.join("; ")}.`);

    // Spread within a basis is a real observation about how uniformly the day
    // traded. Across bases it would just be the dressing percentage.
    if (s.classes.length > 1) {
      const hi = Math.max(...s.classes.map((c) => c.cents));
      const lo = Math.min(...s.classes.map((c) => c.cents));
      if (hi - lo >= STEADY_THRESHOLD_CENTS) {
        paras.push(
          `Classes on the ${s.label} basis ranged ${formatCwt(hi - lo)} per hundredweight ` +
            `from ${formatCwt(lo)} to ${formatCwt(hi)}.`,
        );
      }
    }
  }

  // Explain why there is no single headline number, so the split doesn't read
  // as an omission.
  if (summaries.length > 1) {
    paras.push(
      `Live and dressed prices are quoted on different weights — the animal on the ` +
        `hoof against the hanging carcass — and describe the same cattle. They are ` +
        `reported separately here because averaging them together would produce a ` +
        `figure that means nothing.`,
    );
  }

  // Not boilerplate: mistaking this feed for sale-barn feeder averages is the
  // single easiest way to misread it, so it stays in every post.
  paras.push(
    `These are packer-reported fed cattle trades filed with USDA under Livestock ` +
      `Mandatory Price Reporting. They are useful market context, not a substitute ` +
      `for feeder-calf averages out of a sale barn.`,
  );
  paras.push(
    `Compiled automatically from the USDA Agricultural Marketing Service data ` +
      `feed. No one at Brindle wrote or reviewed this summary.`,
  );

  return {
    slug: `market-report-${reportDate}`,
    title,
    dek,
    body: paras.join("\n\n"),
    category: "Market Report",
    authorName: MARKET_DESK_AUTHOR,
    authorTitle: MARKET_DESK_TITLE,
    publishedAt: reportDate,
  };
}
