// A small, dependency-free RFC-4180 CSV reader. Real sale catalogs are exported
// from Excel and routinely contain quoted fields with embedded commas ("Sitz
// Stellar 726D, ET"), escaped quotes, and \r\n line endings — a naive
// split(",") mangles all three, so this parses properly rather than
// approximately.

/** Parse CSV text into rows of raw string cells. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  // Strip a UTF-8 BOM — Excel adds one, and it otherwise corrupts the first header.
  if (text.charCodeAt(0) === 0xfeff) i = 1;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    // Skip blank trailing lines rather than emitting a phantom one-empty-cell row.
    if (!(row.length === 1 && row[0]!.trim() === "")) rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i]!;

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'; // escaped quote
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      pushField();
      i += 1;
      continue;
    }
    if (ch === "\r") {
      // Handle both \r\n and a bare \r line ending.
      if (text[i + 1] === "\n") i += 1;
      pushRow();
      i += 1;
      continue;
    }
    if (ch === "\n") {
      pushRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  // Flush whatever's pending when the file doesn't end in a newline.
  if (field.length > 0 || row.length > 0) pushRow();
  return rows;
}

/** Parse CSV with a header row into objects keyed by normalized header name. */
export function parseCsvRecords(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const headers = rows[0]!.map(normalizeHeader);
  return rows.slice(1).map((cells) => {
    const rec: Record<string, string> = {};
    headers.forEach((h, idx) => {
      if (h) rec[h] = (cells[idx] ?? "").trim();
    });
    return rec;
  });
}

/**
 * Normalize a header cell to a lookup key: lowercase, alphanumerics only.
 * "Lot #" -> "lot", "Birth Wt. (BW)" -> "birthwtbw" — so the column matcher
 * can tolerate the punctuation and spacing differences between real catalogs.
 */
export function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}
