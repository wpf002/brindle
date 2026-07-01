import Link from "next/link";
import { getCatalog, type CatalogLot } from "../lib/api";
import { formatCents, priceUnitLabel } from "../lib/format";

export const dynamic = "force-dynamic";

const FILTERS: { label: string; value: string }[] = [
  { label: "All lots", value: "" },
  { label: "Semen", value: "SEMEN" },
  { label: "Embryo", value: "EMBRYO" },
  { label: "Bulls", value: "BULLS" },
];

export default async function Page({ searchParams }: { searchParams: { category?: string } }) {
  const { lots } = await getCatalog();
  const active = searchParams.category ?? "";
  const shown = active ? lots.filter((l) => l.category === active) : lots;
  const sellers = new Set(lots.map((l) => l.auction.name)).size;

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
            <div className="stat"><div className="n tabular">{sellers}</div><div className="l">Active sales</div></div>
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
      </section>
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
