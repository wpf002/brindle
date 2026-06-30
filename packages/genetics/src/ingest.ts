import type { EpdSet, TraitDef } from "./traits.js";

export interface EpdParseResult {
  epd: EpdSet;
  warnings: string[];
}

// Validate/normalize a seller's pasted EPD blob (the console writes the result to
// Lot.epd). Unknown traits are dropped with a warning rather than rejecting the
// whole set — sellers shouldn't lose a lot because one extra column came along.
export function parseEpdSet(
  input: unknown,
  traits: TraitDef[],
): EpdParseResult {
  const warnings: string[] = [];
  const epd: EpdSet = {};
  if (typeof input !== "object" || input === null) {
    return { epd, warnings: ["EPD payload must be an object keyed by trait"] };
  }

  const known = new Set(traits.map((t) => t.key));
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    if (!known.has(key)) {
      warnings.push(`Unknown trait "${key}" ignored`);
      continue;
    }
    const v = normalizeValue(raw);
    if (v === null) {
      warnings.push(`Trait "${key}" has no numeric value; skipped`);
      continue;
    }
    epd[key] = v;
  }
  return { epd, warnings };
}

function normalizeValue(raw: unknown): { value: number; accuracy?: number; percentile?: number } | null {
  // Accept either a bare number or the full {value, acc/accuracy, pct/percentile} shape.
  if (typeof raw === "number" && Number.isFinite(raw)) return { value: raw };
  if (typeof raw !== "object" || raw === null) return null;

  const o = raw as Record<string, unknown>;
  const value = num(o.value);
  if (value === null) return null;

  const accuracy = num(o.accuracy ?? o.acc);
  const percentile = num(o.percentile ?? o.pct);
  return {
    value,
    ...(accuracy !== null ? { accuracy } : {}),
    ...(percentile !== null ? { percentile } : {}),
  };
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}
