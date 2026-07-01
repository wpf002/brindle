"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { authed, getToken, onAuthChange, openSignIn } from "../../lib/session";
import { formatCents } from "../../lib/format";

interface AuctionRow {
  id: string; name: string; status: string;
  lots: { id: string; lotNumber: number; status: string; bullName: string | null }[];
}
interface Analytics {
  totalLots: number; soldLots: number; clearanceRateBps: number;
  gmvCents: string; realizationBps: number; buyerReach: number;
}

function dollarsToCents(s: string): string {
  const clean = s.trim().replace(/[$,]/g, "");
  if (!clean) return "0";
  const [d, c = ""] = clean.split(".");
  return (BigInt(d || "0") * 100n + BigInt((c + "00").slice(0, 2))).toString();
}

export default function Sell() {
  const [signedIn, setSignedIn] = useState(false);
  const [auctions, setAuctions] = useState<AuctionRow[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const sync = () => setSignedIn(Boolean(getToken()));
    sync();
    return onAuthChange(sync);
  }, []);
  useEffect(() => { if (signedIn) void refresh(); }, [signedIn]);

  async function refresh() {
    try {
      const [a, an] = await Promise.all([
        authed<{ auctions: AuctionRow[] }>("/console/auctions"),
        authed<Analytics>("/console/analytics"),
      ]);
      setAuctions(a.auctions);
      setAnalytics(an);
    } catch (e) { setMsg(String(e)); }
  }

  const [aName, setAName] = useState("");
  const [aStart, setAStart] = useState("");
  const [premium, setPremium] = useState("0");
  async function createAuction() {
    try {
      await authed("/console/auctions", { method: "POST", body: JSON.stringify({
        name: aName, startsAt: aStart ? new Date(aStart).toISOString() : new Date().toISOString(),
        buyerPremiumBps: Math.round(Number(premium) * 100),
      }) });
      setAName(""); setMsg("Auction created"); await refresh();
    } catch (e) { setMsg(String(e)); }
  }

  const [lotAuction, setLotAuction] = useState("");
  const [lotNo, setLotNo] = useState("1");
  const [bull, setBull] = useState("");
  const [doses, setDoses] = useState("");
  const [start, setStart] = useState("");
  const [epdText, setEpdText] = useState('{ "CED": 8, "BW": {"value": 1.2, "pct": 15}, "WW": 70, "Marb": {"value": 0.8, "pct": 4} }');
  async function addLot() {
    let epd: unknown;
    try { epd = epdText.trim() ? JSON.parse(epdText) : undefined; } catch { setMsg("EPD JSON is invalid"); return; }
    try {
      const res = await authed<{ epdWarnings: string[] }>(`/console/auctions/${lotAuction}/lots`, {
        method: "POST", body: JSON.stringify({
          lotNumber: Number(lotNo), category: "SEMEN", priceUnit: "DOSE",
          startingBidCents: dollarsToCents(start), bullName: bull || undefined,
          dosesAvailable: doses ? Number(doses) : undefined, epd,
        }),
      });
      setMsg(`Lot created${res.epdWarnings.length ? ` · EPD warnings: ${res.epdWarnings.join("; ")}` : ""}`);
      await refresh();
    } catch (e) { setMsg(String(e)); }
  }

  async function activate(lotId: string) {
    try { await authed(`/console/lots/${lotId}/status`, { method: "POST", body: JSON.stringify({ status: "ACTIVE" }) }); await refresh(); }
    catch (e) { setMsg(String(e)); }
  }

  if (!signedIn) {
    return (
      <main className="wrap section">
        <div className="signin-wrap">
          <div className="eyebrow">Seller console</div>
          <h1>Run your own genetics sale</h1>
          <p className="muted">Sign in to build auctions, list lots with EPDs, and take them live.</p>
          <button className="btn btn-primary btn-lg" style={{ marginTop: 20, maxWidth: 220 }} onClick={openSignIn}>Sign in to sell</button>
        </div>
      </main>
    );
  }

  const pct = (bps: number) => `${(bps / 100).toFixed(0)}%`;

  return (
    <main className="wrap section">
      <div className="eyebrow">Seller console</div>
      <h1 style={{ fontSize: 34, margin: "10px 0 20px" }}>Your sales</h1>

      {analytics && (
        <div className="dash-grid">
          <div className="tile"><div className="l">Clearance</div><div className="n tabular">{pct(analytics.clearanceRateBps)}</div></div>
          <div className="tile"><div className="l">GMV</div><div className="n tabular">{formatCents(analytics.gmvCents)}</div></div>
          <div className="tile"><div className="l">Realization</div><div className="n tabular">{pct(analytics.realizationBps)}</div></div>
          <div className="tile"><div className="l">Lots</div><div className="n tabular">{analytics.soldLots}/{analytics.totalLots}</div></div>
          <div className="tile"><div className="l">Buyer reach</div><div className="n tabular">{analytics.buyerReach}</div></div>
        </div>
      )}

      {msg && <div className="statusmsg info" style={{ marginBottom: 18 }}>{msg}</div>}

      <div className="card-form">
        <h2>New auction</h2>
        <div className="form-grid">
          <label className="field"><span className="label">Sale name</span><input className="input" value={aName} onChange={(e) => setAName(e.target.value)} placeholder="Spring Genetics Sale" /></label>
          <label className="field"><span className="label">Starts</span><input className="input" type="datetime-local" value={aStart} onChange={(e) => setAStart(e.target.value)} /></label>
          <label className="field"><span className="label">Buyer premium %</span><input className="input" value={premium} onChange={(e) => setPremium(e.target.value)} /></label>
        </div>
        <button className="btn btn-primary" onClick={createAuction} disabled={!aName}>Create auction</button>
      </div>

      <div className="card-form">
        <h2>Add genetics lot</h2>
        <div className="form-grid">
          <label className="field"><span className="label">Auction</span>
            <select className="input" value={lotAuction} onChange={(e) => setLotAuction(e.target.value)}>
              <option value="">Select a sale…</option>
              {auctions.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label className="field"><span className="label">Lot #</span><input className="input" value={lotNo} onChange={(e) => setLotNo(e.target.value)} /></label>
          <label className="field"><span className="label">Bull name</span><input className="input" value={bull} onChange={(e) => setBull(e.target.value)} /></label>
          <label className="field"><span className="label">Doses</span><input className="input" value={doses} onChange={(e) => setDoses(e.target.value)} /></label>
          <label className="field"><span className="label">Opening bid $</span><input className="input" value={start} onChange={(e) => setStart(e.target.value)} placeholder="25.00" /></label>
        </div>
        <label className="field" style={{ marginBottom: 16 }}><span className="label">EPDs (JSON)</span>
          <textarea className="input" rows={3} value={epdText} onChange={(e) => setEpdText(e.target.value)} />
        </label>
        <button className="btn btn-primary" onClick={addLot} disabled={!lotAuction}>Add lot</button>
      </div>

      <h2 style={{ fontSize: 22, margin: "8px 0 14px" }}>Auctions</h2>
      {auctions.length === 0 ? <p className="dim">No auctions yet — create one above.</p> : auctions.map((a) => (
        <div key={a.id} className="auction-row">
          <div className="head">
            <strong style={{ fontFamily: "var(--font-display)", fontSize: 18 }}>{a.name}</strong>
            <span className={`pill ${a.status.toLowerCase()}`}>{a.status}</span>
            {a.status !== "CLOSED" && <Link href={`/ring/${a.id}`} className="btn-link" style={{ marginLeft: "auto" }}>Open ring →</Link>}
          </div>
          <ul className="lotlist">
            {a.lots.map((l) => (
              <li key={l.id}>
                <span>Lot {l.lotNumber}</span>
                <span className="muted">{l.bullName ?? "—"}</span>
                <span className={`pill ${l.status.toLowerCase()}`} style={{ marginLeft: "auto" }}>{l.status}</span>
                {l.status === "DRAFT" && <button className="btn btn-ghost btn-sm" onClick={() => activate(l.id)}>Activate</button>}
              </li>
            ))}
            {a.lots.length === 0 && <li className="dim">No lots yet</li>}
          </ul>
        </div>
      ))}
    </main>
  );
}
