// Single place the buyer app talks to the API. NEXT_PUBLIC_ so the same base URL
// is available in server and client components.
export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export function wsBase(): string {
  return API.replace(/^http/, "ws");
}

export interface CatalogLot {
  id: string;
  lotNumber: number;
  category: string;
  priceUnit: string;
  startingBidCents: string;
  bullName: string | null;
  primaryBreed: string | null;
  dosesAvailable: number | null;
  endsAt: string | null;
  photos: string[];
  auction: { id: string; name: string; startsAt: string; status: string };
}

export async function getCatalog(): Promise<{ lots: CatalogLot[] }> {
  const r = await fetch(`${API}/catalog`, { cache: "no-store" });
  if (!r.ok) return { lots: [] };
  return r.json();
}

export interface AuctionHeader {
  id: string;
  name: string;
  status: string;
  format: string;
  streamUrl: string | null;
}

export async function getAuction(id: string): Promise<AuctionHeader | null> {
  const r = await fetch(`${API}/auctions/${id}`, { cache: "no-store" });
  if (!r.ok) return null;
  return r.json();
}

export async function getLot(id: string): Promise<unknown> {
  const r = await fetch(`${API}/lots/${id}`, { cache: "no-store" });
  if (!r.ok) return null;
  return r.json();
}

export async function compareLots(lotIds: string[]): Promise<unknown> {
  const r = await fetch(`${API}/genetics/compare`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ lotIds }),
  });
  if (!r.ok) return null;
  return r.json();
}
