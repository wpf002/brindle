import Link from "next/link";
import { registryBadges } from "@brindle/genetics";
import {
  getCatalog, getSellers, getNews, getMarketLatest,
  type CatalogLot, type SellerSummary, type NewsSummary, type MarketRow,
} from "../lib/api";
import { formatCents, priceUnitLabel } from "../lib/format";
// Shared with the report generator, so the hero card and the written market
// reports name a class the same way.
import { formatClassName } from "@brindle/market-data";

export const dynamic = "force-dynamic";

// Grouped the way a buyer shops rather than one chip per enum value — an order
// buyer filling a feedlot pen wants feeders, not "STEERS" and "HEIFERS"
// separately. Values are comma-separated category sets.
const FILTERS: { label: string; value: string }[] = [
  { label: "All Lots", value: "" },
  { label: "Feeders", value: "STEERS,HEIFERS,CALVES" },
  { label: "Bred & Pairs", value: "BRED_HEIFERS,PAIRS" },
  { label: "Cows", value: "COWS" },
  { label: "Bulls", value: "BULLS" },
  { label: "Genetics", value: "SEMEN,EMBRYO" },
];

export default async function Page({ searchParams }: { searchParams: { category?: string } }) {
  const [{ lots }, { sellers }, { posts }, market] = await Promise.all([
    getCatalog(),
    getSellers(),
    getNews(undefined, 3),
    getMarketLatest(),
  ]);
  const active = searchParams.category ?? "";
  const wanted = new Set(active ? active.split(",") : []);
  const shown = wanted.size > 0 ? lots.filter((l) => wanted.has(l.category)) : lots;
  const sellerCount = new Set(lots.map((l) => l.auction.name)).size;
  const badges = registryBadges(lots.map((l) => l.bullRegId));

  return (
    <main>
      <section className="hero">
        <div className="wrap hero-grid">
          <div>
            <div className="eyebrow">Cattle Auctions · Live Ring &amp; Timed Online</div>
            <h1>Every lot, with the data to back it.</h1>
            <p>
              Sale barns run their own ring, online and in person. Uniform lots with weights,
              health and vaccination programs, and verified pedigree where it exists — plus one
              credit approval that works at every barn on Brindle.
            </p>
            <div className="hero-stats">
              <div className="stat"><div className="n tabular">{lots.length}</div><div className="l">Lots Open</div></div>
              <div className="stat"><div className="n tabular">{sellerCount}</div><div className="l">Sales Open</div></div>
              <div className="stat"><div className="n">Cleared Once</div><div className="l">Bid Everywhere</div></div>
            </div>
          </div>
          <MarketSnapshot rows={market.rows} asOf={market.asOf} />
        </div>
      </section>

      <section className="wrap section">
        <div className="toolbar">
          <div className="filters">
            {FILTERS.map((f) => (
              <Link key={f.value} href={f.value ? `/?category=${f.value}` : "/"}
                className={`filter ${active === f.value ? "active" : ""}`}>
                {f.label}
              </Link>
            ))}
          </div>
        </div>

        {shown.length === 0 ? (
          <div className="empty">No lots in this category yet.</div>
        ) : (
          <div className="grid">
            {shown.map((lot) => <LotCard key={lot.id} lot={lot} />)}
          </div>
        )}

        {badges.length > 0 && (
          <div style={{ marginTop: 36 }}>
            <div className="k" style={{ fontSize: 12, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 600, marginBottom: 10 }}>
              Registered With
            </div>
            <div className="badge-wall">
              {badges.map((b) => (
                <span key={b.code} className="badge"><span className="mark">{b.code}</span>{b.name}</span>
              ))}
              <span className="badge verified">✓ Verified Sellers</span>
            </div>
          </div>
        )}
      </section>

      {sellers.length > 0 && (
        <section className="wrap strip">
          <div className="strip-head">
            <h2>Barns &amp; Programs on Brindle</h2>
            <Link href="/sell">List Your Sale →</Link>
          </div>
          <div className="seller-grid">
            {sellers.map((s) => <SellerCard key={s.id} seller={s} />)}
          </div>
        </section>
      )}

      {posts.length > 0 && (
        <section className="wrap strip">
          <div className="strip-head">
            <h2>From the Market Desk</h2>
            <Link href="/news">All News →</Link>
          </div>
          <div className="news-grid">
            {posts.map((p) => <NewsCard key={p.slug} post={p} />)}
          </div>
        </section>
      )}
    </main>
  );
}

/**
 * The hero's right-hand column: today's USDA-reported prices.
 *
 * It's there because a hero with one column of copy left the top-right of the
 * page empty, and because price context is the first thing a buyer wants before
 * bidding — not decoration. Renders nothing at all when no reports have been
 * ingested, so a fresh install gets a clean single-column hero instead of an
 * empty box.
 */
function MarketSnapshot({ rows, asOf }: { rows: MarketRow[]; asOf: string | null }) {
  if (rows.length === 0 || !asOf) return null;

  // Highest-value classes first, which is how /market/latest already orders them.
  const top = rows.slice(0, 3);
  const asOfLabel = new Date(`${asOf}T12:00:00Z`).toLocaleDateString(undefined, {
    month: "short", day: "numeric",
  });

  return (
    <aside className="market-card" aria-labelledby="market-snapshot-heading">
      <div className="market-card-head">
        <span id="market-snapshot-heading" className="k">Cattle Market</span>
        <span className="asof">{asOfLabel}</span>
      </div>
      <ul className="market-card-list">
        {top.map((r) => (
          <li key={`${r.category}-${r.wtLowLbs}`}>
            <span className="cls">{formatClassName(r.category)}</span>
            <span className="val tabular">{formatCents(String(r.avgCentsPerCwt))}<span className="u">/cwt</span></span>
          </li>
        ))}
      </ul>
      <Link href="/market" className="market-card-link">All USDA Prices →</Link>
    </aside>
  );
}

/** Title case a LotCategory enum for display: BRED_HEIFERS -> Bred Heifers. */
function categoryLabel(raw: string): string {
  return raw.toLowerCase().split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * What a lot actually is, in the terms its buyer thinks in.
 *
 * Commercial cattle sell as a uniform load — "300 head · 575 lb avg" is the
 * whole description, and the animals have no individual names. Genetics lots
 * are the opposite: one named, registered animal. The same card has to carry
 * both without one reading as a broken version of the other.
 */
function lotHeadline(lot: CatalogLot): string {
  if (lot.bullName) return lot.bullName;
  if (lot.headCount) return `${lot.headCount} Head ${categoryLabel(lot.category)}`;
  return categoryLabel(lot.category);
}

function lotDetail(lot: CatalogLot): string {
  const parts: string[] = [];
  if (lot.headCount && lot.avgWeightLbs) {
    parts.push(`${Math.round(Number(lot.avgWeightLbs))} lb avg`);
  }
  if (lot.primaryBreed) parts.push(lot.primaryBreed);
  if (lot.originState) parts.push(lot.originState);
  if (lot.dosesAvailable) parts.push(`${lot.dosesAvailable} doses`);
  if (!lot.headCount && !lot.dosesAvailable) parts.unshift(categoryLabel(lot.category));
  return parts.join(" · ");
}

function LotCard({ lot }: { lot: CatalogLot }) {
  const glyph = (lot.bullName ?? lot.category).trim().charAt(0).toUpperCase();
  return (
    <Link href={`/lots/${lot.id}`} className="card">
      <div className="card-media">
        <span className={`pill ${lot.auction.status.toLowerCase()}`}>{lot.auction.status}</span>
        <span className="glyph">{glyph}</span>
      </div>
      <div className="card-body">
        <div className="card-lotno">Lot {lot.lotNumber}</div>
        <h3>{lotHeadline(lot)}</h3>
        <div className="card-meta">{lotDetail(lot)}</div>
        {lot.programCerts.length > 0 && (
          <div className="card-meta" style={{ marginTop: 2 }}>
            {/* VAC-45 and BQA are price-premium drivers buyers scan for. */}
            {lot.programCerts.join(" · ")}
          </div>
        )}
        <div className="card-foot">
          <div className="card-price">
            {formatCents(lot.startingBidCents)}<span className="u">{priceUnitLabel(lot.priceUnit)}</span>
          </div>
          <div className="card-seller">{lot.auction.name}</div>
        </div>
      </div>
    </Link>
  );
}

function SellerCard({ seller }: { seller: SellerSummary }) {
  const name = seller.businessName ?? seller.legalName;
  const glyph = name.trim().charAt(0).toUpperCase();
  return (
    <div className="seller-card">
      <div className="seller-badge">{glyph}</div>
      <h3>{name}</h3>
      <div className="role">
        {seller.state ?? ""}
        {seller.sellerVerified && <span className="pill verified" style={{ marginLeft: 6 }}>Verified</span>}
      </div>
    </div>
  );
}

function NewsCard({ post }: { post: NewsSummary }) {
  return (
    <Link href={`/news/${post.slug}`} className="news-card">
      <div className="eyebrow cat">{post.category}</div>
      <h3>{post.title}</h3>
      <p className="dek">{post.dek}</p>
      <div className="byline">{post.authorName} · {new Date(post.publishedAt).toLocaleDateString()}</div>
    </Link>
  );
}
