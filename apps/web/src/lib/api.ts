// Single place the buyer app talks to the API. NEXT_PUBLIC_ so the same base URL
// is available in server and client components.
export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export function wsBase(): string {
  return API.replace(/^http/, "ws");
}

// Object-storage keys are stored bare (e.g. "lots/<uuid>"); the public base is
// environment-specific. Returns null when storage isn't configured, so callers
// fall back to a placeholder rather than rendering a broken image.
export function mediaUrl(key: string): string | null {
  const base = process.env.NEXT_PUBLIC_MEDIA_BASE_URL;
  if (!base) return null;
  return `${base.replace(/\/$/, "")}/${key}`;
}

export interface CatalogLot {
  id: string;
  lotNumber: number;
  category: string;
  priceUnit: string;
  startingBidCents: string;
  bullName: string | null;
  bullRegId: string | null;
  primaryBreed: string | null;
  dosesAvailable: number | null;
  headCount: number | null;
  avgWeightLbs: string | null;   // Decimal over the wire
  originState: string | null;
  programCerts: string[];
  endsAt: string | null;
  photos: string[];
  auction: { id: string; name: string; startsAt: string; status: string; sellerId: string };
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
  sellerId: string;
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

// ---------- market data (USDA AMS) ----------
export interface MarketRow {
  reportDate: string;
  region: string;
  category: string;
  wtLowLbs: number;
  wtHighLbs: number;
  avgCentsPerCwt: number;
  headCount: number;
  source: string;
}

export async function getMarketLatest(): Promise<{ rows: MarketRow[]; asOf: string | null }> {
  try {
    const r = await fetch(`${API}/market/latest`, { cache: "no-store" });
    if (!r.ok) return { rows: [], asOf: null };
    return r.json();
  } catch {
    return { rows: [], asOf: null };
  }
}

// ---------- seller directory + story pages ----------
export interface SellerSummary {
  id: string;
  businessName: string | null;
  legalName: string;
  state: string | null;
  title: string | null;
  sellerVerified: boolean;
  foundedYear: number | null;
}

export async function getSellers(): Promise<{ sellers: SellerSummary[] }> {
  const r = await fetch(`${API}/sellers`, { cache: "no-store" });
  if (!r.ok) return { sellers: [] };
  return r.json();
}

export interface SellerOperation {
  id: string;
  name: string;
  location: string;
  description: string;
  acres: number | null;
  herdSize: number | null;
}

export interface SellerProfile {
  seller: SellerSummary & { bio: string | null; quote: string | null };
  operations: SellerOperation[];
  lots: CatalogLot[];
  trust: { avgStars: number | null; ratingCount: number; lotsSold: number; identityVerified: boolean };
}

export async function getSeller(id: string): Promise<SellerProfile | null> {
  const r = await fetch(`${API}/sellers/${id}`, { cache: "no-store" });
  if (!r.ok) return null;
  return r.json();
}

// ---------- news / editorial ----------
export interface NewsSummary {
  slug: string;
  title: string;
  dek: string;
  category: string;
  authorName: string;
  publishedAt: string;
}

export async function getNews(category?: string, limit?: number): Promise<{ posts: NewsSummary[] }> {
  const params = new URLSearchParams();
  if (category) params.set("category", category);
  if (limit) params.set("limit", String(limit));
  const qs = params.toString();
  const r = await fetch(`${API}/news${qs ? `?${qs}` : ""}`, { cache: "no-store" });
  if (!r.ok) return { posts: [] };
  return r.json();
}

export interface NewsPost extends NewsSummary {
  body: string;
  authorTitle: string | null;
  sellerId: string | null;
}

export async function getNewsPost(slug: string): Promise<NewsPost | null> {
  const r = await fetch(`${API}/news/${slug}`, { cache: "no-store" });
  if (!r.ok) return null;
  const { post } = await r.json();
  return post;
}

// ---------- deployment capabilities ----------
/**
 * What this deployment can actually do. Read once on load so the UI can leave
 * out flows that would dead-end — a payout step with payments switched off, a
 * photo picker with no bucket behind it. Absent beats broken.
 *
 * Defaults to everything-on if the API can't be reached, so a transient blip
 * doesn't silently strip the interface down.
 */
export interface Features {
  payments: boolean;
  identityVerification: boolean;
  email: boolean;
  mediaUploads: boolean;
}

const ALL_ON: Features = {
  payments: true, identityVerification: true, email: true, mediaUploads: true,
};

let featuresCache: Features | null = null;

export async function getFeatures(): Promise<Features> {
  if (featuresCache) return featuresCache;
  try {
    const r = await fetch(`${API}/config`, { cache: "no-store" });
    if (!r.ok) return ALL_ON;
    featuresCache = ((await r.json()) as { features: Features }).features;
    return featuresCache;
  } catch {
    return ALL_ON;
  }
}
