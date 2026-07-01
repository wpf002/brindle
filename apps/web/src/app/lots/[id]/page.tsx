import Link from "next/link";
import type { EpdSet } from "@brindle/genetics";
import { getLot } from "../../../lib/api";
import { formatCents, priceUnitLabel } from "../../../lib/format";
import { BidBox } from "../../../components/BidBox";
import { EpdTable } from "../../../components/EpdTable";

export const dynamic = "force-dynamic";

interface LotDetail {
  lot: {
    id: string;
    lotNumber: number;
    category: string;
    priceUnit: string;
    startingBidCents: string;
    bidIncrementCents: string;
    bullName: string | null;
    bullRegId: string | null;
    primaryBreed: string | null;
    dosesAvailable: number | null;
    postThawMotility: string | null;
    storageFacility: string | null;
    epd: EpdSet | null;
    photos: string[];
    auction: {
      id: string;
      name: string;
      status: string;
      buyerPremiumBps: number;
      seller: { businessName: string | null; legalName: string; state: string | null };
    };
  };
  live: {
    currentPriceCents: string;
    highBidderId: string | null;
    bidIncrementCents: string;
    closed: boolean;
  } | null;
}

export default async function LotPage({ params }: { params: { id: string } }) {
  const data = (await getLot(params.id)) as LotDetail | null;
  if (!data?.lot) {
    return (
      <main className="wrap">
        <p className="muted">Lot not found.</p>
        <Link href="/">← Back to catalog</Link>
      </main>
    );
  }

  const { lot, live } = data;
  const price = live?.currentPriceCents ?? lot.startingBidCents;
  const increment = live?.bidIncrementCents ?? lot.bidIncrementCents;
  const seller = lot.auction.seller.businessName ?? lot.auction.seller.legalName;

  return (
    <main className="wrap detail">
      <Link href="/" className="back">← Catalog</Link>

      <div className="detail-grid">
        <section>
          <span className="lotno">Lot {lot.lotNumber}</span>
          <h1>{lot.bullName ?? lot.category}</h1>
          <p className="muted">
            {lot.category} · {seller}
            {lot.auction.seller.state ? ` · ${lot.auction.seller.state}` : ""}
          </p>

          <dl className="specs">
            {lot.bullRegId && (<><dt>Reg #</dt><dd>{lot.bullRegId}</dd></>)}
            {lot.primaryBreed && (<><dt>Breed</dt><dd>{lot.primaryBreed}</dd></>)}
            {lot.dosesAvailable != null && (<><dt>Doses</dt><dd>{lot.dosesAvailable}</dd></>)}
            {lot.postThawMotility && (<><dt>Post-thaw motility</dt><dd>{lot.postThawMotility}%</dd></>)}
            {lot.storageFacility && (<><dt>Storage</dt><dd>{lot.storageFacility}</dd></>)}
            {lot.auction.buyerPremiumBps > 0 && (
              <><dt>Buyer premium</dt><dd>{(lot.auction.buyerPremiumBps / 100).toFixed(1)}%</dd></>
            )}
          </dl>

          <h2>EPDs {priceUnitLabel(lot.priceUnit) && <span className="muted"> </span>}</h2>
          {lot.epd ? <EpdTable epd={lot.epd} /> : <p className="muted">No EPDs published.</p>}
        </section>

        <aside>
          <BidBox
            auctionId={lot.auction.id}
            lotId={lot.id}
            initialPriceCents={price}
            incrementCents={increment}
          />
          <p className="muted openingnote">
            Opening {formatCents(lot.startingBidCents)}
            {priceUnitLabel(lot.priceUnit)}
          </p>
        </aside>
      </div>
    </main>
  );
}
