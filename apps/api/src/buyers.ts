// Buyer numbers are issued once on credit approval and reused across every
// seller's sale — the "approve once, bid everywhere" promise. Format is B-######
// (zero-padded), monotonic. Assignment is pure here; the route handles DB
// persistence and unique-collision retries.

const PREFIX = "B-";
const WIDTH = 6;

export function formatBuyerNumber(n: number): string {
  return PREFIX + String(n).padStart(WIDTH, "0");
}

export function parseBuyerNumber(s: string): number | null {
  const m = /^B-(\d+)$/.exec(s);
  return m ? Number(m[1]) : null;
}

/** Next number given the set already issued. Starts at B-000001. */
export function nextBuyerNumber(existing: string[]): string {
  let max = 0;
  for (const s of existing) {
    const n = parseBuyerNumber(s);
    if (n !== null && n > max) max = n;
  }
  return formatBuyerNumber(max + 1);
}
