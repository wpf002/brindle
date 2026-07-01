import Link from "next/link";
import { getCatalog } from "../lib/api";
import { formatCents, priceUnitLabel } from "../lib/format";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { lots } = await getCatalog();

  return (
    <main className="wrap">
      <header className="topbar">
        <h1>Brindle</h1>
        <p className="muted">Genetics auctions — one credit approval, every seller&apos;s sale.</p>
      </header>

      {lots.length === 0 ? (
        <p className="muted empty">No lots listed yet. Sellers create lots in the console.</p>
      ) : (
        <ul className="catalog">
          {lots.map((lot) => (
            <li key={lot.id} className="card">
              <Link href={`/lots/${lot.id}`}>
                <div className="card-head">
                  <span className="lotno">Lot {lot.lotNumber}</span>
                  <span className={`pill ${lot.auction.status.toLowerCase()}`}>
                    {lot.auction.status}
                  </span>
                </div>
                <h3>{lot.bullName ?? lot.category}</h3>
                <p className="muted">
                  {lot.category}
                  {lot.primaryBreed ? ` · ${lot.primaryBreed}` : ""}
                  {lot.dosesAvailable ? ` · ${lot.dosesAvailable} doses` : ""}
                </p>
                <p className="start">
                  Opening {formatCents(lot.startingBidCents)}
                  <span className="muted">{priceUnitLabel(lot.priceUnit)}</span>
                </p>
                <p className="muted seller">{lot.auction.name}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
