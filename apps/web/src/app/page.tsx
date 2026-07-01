import Link from "next/link";
import { registryBadges } from "@brindle/genetics";
import { getCatalog, getSellers, getNews, type CatalogLot, type SellerSummary, type NewsSummary } from "../lib/api";
import { formatCents, priceUnitLabel } from "../lib/format";

export const dynamic = "force-dynamic";

const FILTERS: { label: string; value: string }[] = [
  { label: "All lots", value: "" },
  { label: "Semen", value: "SEMEN" },
  { label: "Embryo", value: "EMBRYO" },
  { label: "Bulls", value: "BULLS" },
];

export default async function Page({ searchParams }: { searchParams: { category?: string } }) {
  const [{ lots }, { sellers }, { posts }] = await Promise.all([
    getCatalog(),
    getSellers(),
    getNews(undefined, 3),
  ]);
  const active = searchParams.category ?? "";
  const shown = active ? lots.filter((l) => l.category === active) : lots;
  const sellerCount = new Set(lots.map((l) => l.auction.name)).size;
  const badges = registryBadges(lots.map((l) => l.bullRegId));

  return (
    <main>
      <section className="hero">
        <div className="wrap">
          <div className="eyebrow">Livestock genetics · timed &amp; live</div>
          <h1>Bid on proven genetics, with the data to back it.</h1>
          <p>
            Breeders run their own sales. Verified EPDs, side-by-side comparison, and one
            credit approval that works across every seller on Brindle.
          </p>
          <div className="hero-stats">
            <div className="stat"><div className="n tabular">{lots.length}</div><div className="l">Lots open</div></div>
            <div className="stat"><div className="n tabular">{sellerCount}</div><div className="l">Active sales</div></div>
            <div className="stat"><div className="n">Cleared once</div><div className="l">Bid everywhere</div></div>
          </div>
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
              Registered with
            </div>
            <div className="badge-wall">
              {badges.map((b) => (
                <span key={b.code} className="badge"><span className="mark">{b.code}</span>{b.name}</span>
              ))}
              <span className="badge verified">✓ Verified sellers</span>
            </div>
          </div>
        )}
      </section>

      {sellers.length > 0 && (
        <section className="wrap strip">
          <div className="strip-head">
            <h2>Sellers on Brindle</h2>
            <Link href="/sell">List your program →</Link>
          </div>
          <div className="seller-grid">
            {sellers.map((s) => <SellerCard key={s.id} seller={s} />)}
          </div>
        </section>
      )}

      {posts.length > 0 && (
        <section className="wrap strip">
          <div className="strip-head">
            <h2>From the market desk</h2>
            <Link href="/news">All news →</Link>
          </div>
          <div className="news-grid">
            {posts.map((p) => <NewsCard key={p.slug} post={p} />)}
          </div>
        </section>
      )}
    </main>
  );
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
        <h3>{lot.bullName ?? lot.category}</h3>
        <div className="card-meta">
          {lot.category}
          {lot.primaryBreed ? ` · ${lot.primaryBreed}` : ""}
          {lot.dosesAvailable ? ` · ${lot.dosesAvailable} doses` : ""}
        </div>
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
    <Link href={`/sellers/${seller.id}`} className="seller-card">
      <div className="seller-badge">{glyph}</div>
      <h3>{name}</h3>
      <div className="role">
        {seller.title ?? "Seller"}{seller.state ? ` · ${seller.state}` : ""}
        {seller.sellerVerified && <span className="pill verified" style={{ marginLeft: 6 }}>Verified</span>}
      </div>
      {seller.foundedYear && <div className="since">Est. {seller.foundedYear}</div>}
    </Link>
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
