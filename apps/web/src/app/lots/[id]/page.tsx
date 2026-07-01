import Link from "next/link";
import type { EpdSet } from "@brindle/genetics";
import { getLot } from "../../../lib/api";
import { formatCents, priceUnitLabel } from "../../../lib/format";
import { BidBox } from "../../../components/BidBox";
import { EpdTable } from "../../../components/EpdTable";
import { Comparables } from "../../../components/Comparables";

export const dynamic = "force-dynamic";

interface LotDetail {
  lot: {
    id: string; lotNumber: number; category: string; priceUnit: string;
    avgWeightLbs: string | null; startingBidCents: string; bidIncrementCents: string;
    bullName: string | null; bullRegId: string | null; primaryBreed: string | null;
    dosesAvailable: number | null; postThawMotility: string | null; storageFacility: string | null;
    epd: EpdSet | null; photos: string[]; photoCredit: string | null;
    auction: { id: string; name: string; status: string; buyerPremiumBps: number;
      seller: { id: string; businessName: string | null; legalName: string; state: string | null; sellerVerified: boolean } };
  };
  registry: { code: string; name: string } | null;
  live: { currentPriceCents: string; highBidderId: string | null; bidIncrementCents: string; closed: boolean } | null;
}

export default async function LotPage({ params }: { params: { id: string } }) {
  const data = (await getLot(params.id)) as LotDetail | null;
  if (!data?.lot) {
    return (
      <main className="wrap section">
        <p className="muted">Lot not found.</p>
        <Link href="/" className="btn-link">← Back to catalog</Link>
      </main>
    );
  }

  const { lot, live, registry } = data;
  const price = live?.currentPriceCents ?? lot.startingBidCents;
  const increment = live?.bidIncrementCents ?? lot.bidIncrementCents;
  const seller = lot.auction.seller.businessName ?? lot.auction.seller.legalName;
  const unit = priceUnitLabel(lot.priceUnit);
  const glyph = (lot.bullName ?? lot.category).trim().charAt(0).toUpperCase();

  return (
    <main className="wrap">
      <Link href="/" className="crumb">← Catalog</Link>

      <div className="detail">
        <div>
          <div className="card-lotno">Lot {lot.lotNumber} · {lot.auction.name}</div>
          <div className="lot-head">
            <h1>{lot.bullName ?? lot.category}</h1>
            <div className="lot-sub">
              {lot.category}
              {lot.primaryBreed ? ` · ${lot.primaryBreed}` : ""} ·{" "}
              <Link href={`/sellers/${lot.auction.seller.id}`} className="btn-link" style={{ fontSize: "inherit" }}>{seller}</Link>
              {lot.auction.seller.sellerVerified && <span className="pill verified" style={{ marginLeft: 6 }}>Verified</span>}
              {lot.auction.seller.state ? ` · ${lot.auction.seller.state}` : ""}
            </div>
          </div>

          <div className="lot-hero"><span className="glyph">{glyph}</span></div>
          {lot.photoCredit && <p className="photo-credit">{lot.photoCredit}</p>}

          <dl className="specs">
            {lot.bullRegId && (
              <>
                <dt>Registration</dt>
                <dd className="tabular">{lot.bullRegId}{registry && <span className="dim"> · {registry.name}</span>}</dd>
              </>
            )}
            {lot.primaryBreed && (<><dt>Breed</dt><dd>{lot.primaryBreed}</dd></>)}
            {lot.dosesAvailable != null && (<><dt>Doses available</dt><dd className="tabular">{lot.dosesAvailable}</dd></>)}
            {lot.postThawMotility && (<><dt>Post-thaw motility</dt><dd className="tabular">{lot.postThawMotility}%</dd></>)}
            {lot.storageFacility && (<><dt>Storage facility</dt><dd>{lot.storageFacility}</dd></>)}
            {lot.auction.buyerPremiumBps > 0 && (<><dt>Buyer premium</dt><dd>{(lot.auction.buyerPremiumBps / 100).toFixed(1)}%</dd></>)}
          </dl>

          <h2 className="block-title">Expected Progeny Differences</h2>
          <p className="block-note">Bars show desirability within breed — fuller is better. Percentile is breed rank.</p>
          {lot.epd ? <EpdTable epd={lot.epd} /> : <p className="dim">No EPDs published for this lot.</p>}
        </div>

        <div>
          <BidBox auctionId={lot.auction.id} lotId={lot.id} initialPriceCents={price} incrementCents={increment} unit={unit} />
          {lot.priceUnit === "CWT" && lot.avgWeightLbs && (
            <Comparables category={lot.category} weightLbs={Number(lot.avgWeightLbs)} />
          )}
          <p className="dim" style={{ fontSize: 13, marginTop: 14 }}>Opening {formatCents(lot.startingBidCents)}{unit}</p>
        </div>
      </div>
    </main>
  );
}
