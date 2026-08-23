export { parseCsv, parseCsvRecords, normalizeHeader } from "./csv.js";
export {
  detectColumns,
  detectEpdColumns,
  buildLotDrafts,
  dollarsToCents,
  FIELD_ALIASES,
  type CanonicalField,
  type LotDraft,
  type RowError,
  type ParsedCatalog,
  type ParseOptions,
} from "./mapping.js";

import { parseCsv, parseCsvRecords } from "./csv.js";
import { buildLotDrafts, type ParsedCatalog, type ParseOptions } from "./mapping.js";

/** Parse a full CSV catalog file into validated lot drafts. */
export function parseCatalogCsv(text: string, opts: ParseOptions = {}): ParsedCatalog {
  const rows = parseCsv(text);
  if (rows.length === 0) {
    return { columns: {}, epdColumns: {}, lots: [], errors: [{ row: 0, message: "File is empty" }] };
  }
  const headers = rows[0]!;
  const records = parseCsvRecords(text);
  return buildLotDrafts(records, headers, opts);
}
