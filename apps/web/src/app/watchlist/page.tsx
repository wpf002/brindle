"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { authed, isSignedIn, onAuthChange, openSignIn } from "../../lib/session";
import { formatCents, priceUnitLabel } from "../../lib/format";

interface WatchLot {
  id: string;
  lotNumber: number;
  category: string;
  priceUnit: string;
  startingBidCents: string;
  bullName: string | null;
  primaryBreed: string | null;
  dosesAvailable: number | null;
  status: string;
  auction: { id: string; name: string; status: string };
}

export default function WatchlistPage() {
  const [signedIn, setSignedIn] = useState(false);
  const [lots, setLots] = useState<WatchLot[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!(await isSignedIn())) { setSignedIn(false); setLoaded(true); return; }
    setSignedIn(true);
    try {
      const r = await authed<{ lots: WatchLot[] }>("/watchlist");
      setLots(r.lots);
    } catch {
      setLots([]);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
    return onAuthChange(() => void load());
  }, [load]);

  async function remove(lotId: string) {
    try {
      await authed(`/watchlist/${lotId}`, { method: "DELETE" });
      setLots((prev) => prev.filter((l) => l.id !== lotId));
    } catch { /* leave the row in place if the removal didn't stick */ }
  }

  if (!loaded) return <main className="wrap section"><p className="muted">Loading…</p></main>;

  if (!signedIn) {
    return (
      <main className="wrap section">
        <div className="signin-wrap">
          <div className="eyebrow">Watchlist</div>
          <h1>Keep an eye on lots</h1>
          <p className="muted">Sign in to save lots and get told when you&rsquo;re outbid.</p>
          <button className="btn btn-primary btn-lg" style={{ marginTop: 20, maxWidth: 220 }} onClick={openSignIn}>
            Sign in
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="wrap section">
      <div className="eyebrow">Watchlist</div>
      <h1 style={{ fontSize: 34, margin: "10px 0 20px" }}>Lots you&rsquo;re watching</h1>

      {lots.length === 0 ? (
        <div className="empty">
          Nothing saved yet. Tap the star on any lot to keep track of it.
          <div style={{ marginTop: 16 }}>
            <Link href="/" className="btn btn-primary">Browse auctions</Link>
          </div>
        </div>
      ) : (
        <div className="grid">
          {lots.map((lot) => (
            <div key={lot.id} className="card">
              <Link href={`/lots/${lot.id}`}>
                <div className="card-media">
                  <span className={`pill ${lot.auction.status.toLowerCase()}`}>{lot.auction.status}</span>
                  <span className="glyph">{(lot.bullName ?? lot.category).charAt(0).toUpperCase()}</span>
                </div>
              </Link>
              <div className="card-body">
                <div className="card-lotno">Lot {lot.lotNumber}</div>
                <h3><Link href={`/lots/${lot.id}`}>{lot.bullName ?? lot.category}</Link></h3>
                <div className="card-meta">
                  {lot.category}
                  {lot.primaryBreed ? ` · ${lot.primaryBreed}` : ""}
                  {lot.dosesAvailable ? ` · ${lot.dosesAvailable} doses` : ""}
                </div>
                <div className="card-foot">
                  <div className="card-price">
                    {formatCents(lot.startingBidCents)}
                    <span className="u">{priceUnitLabel(lot.priceUnit)}</span>
                  </div>
                  <button className="btn-link" onClick={() => remove(lot.id)}>Remove</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
