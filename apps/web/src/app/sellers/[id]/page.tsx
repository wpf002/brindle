import Link from "next/link";
import { getSeller } from "../../../lib/api";
import { formatCents, priceUnitLabel } from "../../../lib/format";

export const dynamic = "force-dynamic";

export default async function SellerStory({ params }: { params: { id: string } }) {
  const data = await getSeller(params.id);
  if (!data) {
    return (
      <main className="wrap section">
        <p className="muted">Seller not found.</p>
        <Link href="/" className="btn-link">← Back to catalog</Link>
      </main>
    );
  }

  const { seller, operations, lots, trust } = data;
  const name = seller.businessName ?? seller.legalName;
  const bioParagraphs = (seller.bio ?? "").split("\n\n").filter(Boolean);

  return (
    <main>
      <section className="story-hero">
        <div className="wrap">
          <div className="eyebrow">
            {seller.foundedYear ? `Est. ${seller.foundedYear}` : "Seller profile"}
            {seller.sellerVerified ? " · Verified seller" : ""}
          </div>
          <h1>{name}</h1>
          <div className="loc">
            {seller.title ?? "Seller"}{seller.state ? ` · ${seller.state}` : ""}
          </div>
        </div>
      </section>

      <div className="wrap story-grid">
        <div>
          {bioParagraphs.length > 0 && (
            <div className="bio-block">
              {bioParagraphs.map((p, i) => <p key={i}>{p}</p>)}
            </div>
          )}

          {seller.quote && (
            <div className="pull-quote">
              <p>&ldquo;{seller.quote}&rdquo;</p>
              <span className="attr">{seller.title ?? name}, {name}</span>
            </div>
          )}

          {operations.length > 0 && (
            <>
              <h2 className="block-title" style={{ marginTop: 36 }}>Operations</h2>
              <p className="block-note">The properties behind the program.</p>
              <div className="op-list">
                {operations.map((op) => (
                  <div className="op-card" key={op.id}>
                    <h4>{op.name}</h4>
                    <div className="loc">{op.location}</div>
                    <p>{op.description}</p>
                    <div className="op-stats">
                      {op.acres != null && <div><b className="tabular">{op.acres.toLocaleString()}</b>acres</div>}
                      {op.herdSize != null && <div><b className="tabular">{op.herdSize.toLocaleString()}</b>head</div>}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {lots.length > 0 && (
            <>
              <h2 className="block-title" style={{ marginTop: 36 }}>Current lots</h2>
              <p className="block-note">Active sales from {name}.</p>
              <div className="grid">
                {lots.map((lot) => (
                  <Link href={`/lots/${lot.id}`} key={lot.id} className="card">
                    <div className="card-media">
                      <span className={`pill ${lot.auction.status.toLowerCase()}`}>{lot.auction.status}</span>
                      <span className="glyph">{(lot.bullName ?? lot.category).charAt(0)}</span>
                    </div>
                    <div className="card-body">
                      <div className="card-lotno">Lot {lot.lotNumber}</div>
                      <h3>{lot.bullName ?? lot.category}</h3>
                      <div className="card-foot">
                        <div className="card-price">
                          {formatCents(lot.startingBidCents)}<span className="u">{priceUnitLabel(lot.priceUnit)}</span>
                        </div>
                        <div className="card-seller">{lot.auction.name}</div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="story-side">
          <div className="tile">
            <div className="l">Lots sold on Brindle</div>
            <div className="n tabular">{trust.lotsSold}</div>
          </div>
          <div className="tile">
            <div className="l">Buyer rating</div>
            <div className="n tabular">{trust.avgStars ? `${trust.avgStars.toFixed(1)} ★` : "—"}</div>
            <div className="dim" style={{ fontSize: 12 }}>{trust.ratingCount} review{trust.ratingCount === 1 ? "" : "s"}</div>
          </div>
          <div className="tile">
            <div className="l">Status</div>
            <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
              {seller.sellerVerified && <span className="pill verified">Verified seller</span>}
              {trust.identityVerified && <span className="pill live">Identity verified</span>}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
