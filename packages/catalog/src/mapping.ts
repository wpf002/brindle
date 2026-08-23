import { ANGUS_TRAITS, type EpdSet } from "@brindle/genetics";
import { normalizeHeader } from "./csv.js";

// Real sale catalogs come out of a dozen different sale-management tools and no
// two use the same column names. Rather than force sellers to reformat their
// export, each canonical field lists the aliases seen in the wild and we match
// on normalized headers.
export const FIELD_ALIASES: Record<string, string[]> = {
  lotNumber: ["lot", "lotno", "lotnumber", "lot#"],
  bullName: ["name", "bullname", "animal", "animalname", "sire", "tattoo", "description"],
  bullRegId: ["reg", "regno", "regnumber", "registration", "registrationnumber", "regid", "aaa", "asa", "aha"],
  category: ["category", "type", "lottype", "class"],
  priceUnit: ["priceunit", "unit", "sellby"],
  startingBidCents: ["openingbid", "opening", "startingbid", "start", "minimumbid", "minbid", "askingprice"],
  bidIncrementCents: ["increment", "bidincrement", "raise"],
  reserveCents: ["reserve", "reserveprice"],
  headCount: ["head", "headcount", "qty", "quantity", "count"],
  dosesAvailable: ["doses", "dosesavailable", "units", "straws"],
  avgWeightLbs: ["weight", "avgweight", "averageweight", "wt", "avgwt"],
  primaryBreed: ["breed", "primarybreed"],
  originState: ["state", "originstate", "location"],
  postThawMotility: ["motility", "postthaw", "postthawmotility"],
  storageFacility: ["storage", "storagefacility", "facility", "tank"],
  photoCredit: ["photocredit", "photo", "photographer"],
};

export type CanonicalField = keyof typeof FIELD_ALIASES;

/** Map a catalog's raw headers onto canonical field names. */
export function detectColumns(headers: string[]): Partial<Record<CanonicalField, string>> {
  const normalized = headers.map((h) => ({ raw: h, key: normalizeHeader(h) }));
  const out: Partial<Record<CanonicalField, string>> = {};

  for (const [field, aliases] of Object.entries(FIELD_ALIASES) as [CanonicalField, string[]][]) {
    // Exact alias match wins; fall back to a prefix match ("openingbidusd").
    const exact = normalized.find((h) => aliases.includes(h.key));
    const prefix = normalized.find((h) => aliases.some((a) => h.key.startsWith(a)));
    const hit = exact ?? prefix;
    if (hit) out[field] = hit.raw;
  }
  return out;
}

/** Detect EPD columns by trait key (CED, BW, WW, Marb, …) present in the header. */
export function detectEpdColumns(headers: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const trait of ANGUS_TRAITS) {
    const key = normalizeHeader(trait.key);
    const hit = headers.find((h) => normalizeHeader(h) === key);
    if (hit) out[trait.key] = hit;
  }
  return out;
}

/** Dollars (or "$1,250.00") to integer cents, without floats touching money. */
export function dollarsToCents(input: string): bigint | null {
  const clean = input.trim().replace(/[$,\s]/g, "");
  if (!clean) return null;
  if (!/^-?\d*(\.\d*)?$/.test(clean)) return null;
  const negative = clean.startsWith("-");
  const [d = "0", c = ""] = clean.replace("-", "").split(".");
  const cents = BigInt(d || "0") * 100n + BigInt((c + "00").slice(0, 2));
  return negative ? -cents : cents;
}

function parseNumber(v: string | undefined): number | null {
  if (!v) return null;
  const n = Number(v.replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export interface LotDraft {
  lotNumber: number;
  category: string;
  priceUnit: string;
  startingBidCents: string; // stringified bigint — safe across the JSON boundary
  bidIncrementCents?: string;
  reserveCents?: string;
  bullName?: string;
  bullRegId?: string;
  primaryBreed?: string;
  originState?: string;
  headCount?: number;
  dosesAvailable?: number;
  avgWeightLbs?: number;
  postThawMotility?: number;
  storageFacility?: string;
  photoCredit?: string;
  epd?: EpdSet;
}

export interface RowError {
  row: number; // 1-based data row (excludes the header)
  message: string;
}

export interface ParsedCatalog {
  columns: Partial<Record<CanonicalField, string>>;
  epdColumns: Record<string, string>;
  lots: LotDraft[];
  errors: RowError[];
}

const VALID_CATEGORIES = new Set([
  "STEERS", "HEIFERS", "COWS", "BULLS", "PAIRS", "BRED_HEIFERS",
  "CALVES", "SEMEN", "EMBRYO", "SHEEP", "GOATS",
]);
const VALID_UNITS = new Set(["CWT", "HEAD", "DOSE", "EMBRYO"]);

function normalizeCategory(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback;
  const key = raw.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (VALID_CATEGORIES.has(key)) return key;
  // Common free-text spellings seen in catalogs.
  if (/^BULL/.test(key)) return "BULLS";
  if (/^HEIFER/.test(key)) return "HEIFERS";
  if (/^STEER/.test(key)) return "STEERS";
  if (/^COW/.test(key)) return "COWS";
  if (/SEMEN|STRAW/.test(key)) return "SEMEN";
  if (/EMBRYO/.test(key)) return "EMBRYO";
  return fallback;
}

function normalizeUnit(raw: string | undefined, category: string): string {
  if (raw) {
    const key = raw.trim().toUpperCase().replace(/[^A-Z]/g, "");
    if (VALID_UNITS.has(key)) return key;
    if (key === "PERHEAD" || key === "HD") return "HEAD";
    if (key === "PERCWT") return "CWT";
    if (key === "STRAW" || key === "PERDOSE") return "DOSE";
  }
  // Sensible default from the lot type: genetics sell per dose/embryo, live
  // animals per head.
  if (category === "SEMEN") return "DOSE";
  if (category === "EMBRYO") return "EMBRYO";
  return "HEAD";
}

export interface ParseOptions {
  /** Category to use when a row/catalog doesn't specify one. */
  defaultCategory?: string;
}

/**
 * Turn parsed CSV records into validated lot drafts. Bad rows are collected as
 * errors rather than aborting the whole import — a seller with one malformed
 * row in a 200-lot catalog should still get the other 199.
 */
export function buildLotDrafts(
  records: Record<string, string>[],
  headers: string[],
  opts: ParseOptions = {},
): ParsedCatalog {
  const columns = detectColumns(headers);
  const epdColumns = detectEpdColumns(headers);
  const lots: LotDraft[] = [];
  const errors: RowError[] = [];
  const seenLotNumbers = new Set<number>();
  const fallbackCategory = opts.defaultCategory ?? "SEMEN";

  const get = (rec: Record<string, string>, field: CanonicalField): string | undefined => {
    const col = columns[field];
    if (!col) return undefined;
    return rec[normalizeHeader(col)];
  };

  records.forEach((rec, idx) => {
    const rowNum = idx + 1;

    // Skip fully blank rows — trailing empties are common in spreadsheet exports.
    if (Object.values(rec).every((v) => !v)) return;

    const lotNumber = parseNumber(get(rec, "lotNumber"));
    if (lotNumber == null || !Number.isInteger(lotNumber) || lotNumber <= 0) {
      errors.push({ row: rowNum, message: "Missing or invalid lot number" });
      return;
    }
    if (seenLotNumbers.has(lotNumber)) {
      errors.push({ row: rowNum, message: `Duplicate lot number ${lotNumber}` });
      return;
    }

    const startingBid = dollarsToCents(get(rec, "startingBidCents") ?? "");
    if (startingBid == null || startingBid < 0n) {
      errors.push({ row: rowNum, message: "Missing or invalid opening bid" });
      return;
    }

    const category = normalizeCategory(get(rec, "category"), fallbackCategory);
    const priceUnit = normalizeUnit(get(rec, "priceUnit"), category);

    const epd: EpdSet = {};
    for (const [traitKey, rawCol] of Object.entries(epdColumns)) {
      const value = parseNumber(rec[normalizeHeader(rawCol)]);
      if (value != null) epd[traitKey] = { value };
    }

    const increment = dollarsToCents(get(rec, "bidIncrementCents") ?? "");
    const reserve = dollarsToCents(get(rec, "reserveCents") ?? "");

    seenLotNumbers.add(lotNumber);
    lots.push({
      lotNumber,
      category,
      priceUnit,
      startingBidCents: startingBid.toString(),
      ...(increment != null && increment > 0n ? { bidIncrementCents: increment.toString() } : {}),
      ...(reserve != null && reserve > 0n ? { reserveCents: reserve.toString() } : {}),
      ...(get(rec, "bullName") ? { bullName: get(rec, "bullName") } : {}),
      ...(get(rec, "bullRegId") ? { bullRegId: get(rec, "bullRegId") } : {}),
      ...(get(rec, "primaryBreed") ? { primaryBreed: get(rec, "primaryBreed") } : {}),
      ...(get(rec, "originState") ? { originState: get(rec, "originState") } : {}),
      ...(get(rec, "storageFacility") ? { storageFacility: get(rec, "storageFacility") } : {}),
      ...(get(rec, "photoCredit") ? { photoCredit: get(rec, "photoCredit") } : {}),
      ...(parseNumber(get(rec, "headCount")) != null ? { headCount: parseNumber(get(rec, "headCount"))! } : {}),
      ...(parseNumber(get(rec, "dosesAvailable")) != null ? { dosesAvailable: parseNumber(get(rec, "dosesAvailable"))! } : {}),
      ...(parseNumber(get(rec, "avgWeightLbs")) != null ? { avgWeightLbs: parseNumber(get(rec, "avgWeightLbs"))! } : {}),
      ...(parseNumber(get(rec, "postThawMotility")) != null ? { postThawMotility: parseNumber(get(rec, "postThawMotility"))! } : {}),
      ...(Object.keys(epd).length > 0 ? { epd } : {}),
    });
  });

  return { columns, epdColumns, lots, errors };
}
