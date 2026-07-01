"use client";
import { useEffect, useState } from "react";
import { authed, devSignIn, getToken, clearToken } from "../lib/session";

interface AuctionRow {
  id: string;
  name: string;
  status: string;
  lots: { id: string; lotNumber: number; status: string; bullName: string | null }[];
}

function dollarsToCents(s: string): string {
  const clean = s.trim().replace(/[$,]/g, "");
  if (!clean) return "0";
  const [d, c = ""] = clean.split(".");
  const cents = (c + "00").slice(0, 2);
  return (BigInt(d || "0") * 100n + BigInt(cents || "0")).toString();
}

export default function Console() {
  const [signedIn, setSignedIn] = useState(false);
  const [email, setEmail] = useState("");
  const [auctions, setAuctions] = useState<AuctionRow[]>([]);
  const [msg, setMsg] = useState("");

  useEffect(() => setSignedIn(Boolean(getToken())), []);
  useEffect(() => {
    if (signedIn) void refresh();
  }, [signedIn]);

  async function refresh() {
    try {
      const { auctions } = await authed<{ auctions: AuctionRow[] }>("/console/auctions");
      setAuctions(auctions);
    } catch (e) {
      setMsg(String(e));
    }
  }

  async function signIn() {
    if (await devSignIn(email)) setSignedIn(true);
    else setMsg("Sign-in failed — is this a seller email in the DB?");
  }

  // --- create auction ---
  const [aName, setAName] = useState("");
  const [aStart, setAStart] = useState("");
  const [premium, setPremium] = useState("0");
  async function createAuction() {
    try {
      await authed("/console/auctions", {
        method: "POST",
        body: JSON.stringify({
          name: aName,
          startsAt: aStart ? new Date(aStart).toISOString() : new Date().toISOString(),
          buyerPremiumBps: Math.round(Number(premium) * 100),
        }),
      });
      setAName("");
      setMsg("Auction created");
      await refresh();
    } catch (e) {
      setMsg(String(e));
    }
  }

  // --- add lot ---
  const [lotAuction, setLotAuction] = useState("");
  const [lotNo, setLotNo] = useState("1");
  const [bull, setBull] = useState("");
  const [doses, setDoses] = useState("");
  const [start, setStart] = useState("");
  const [epdText, setEpdText] = useState(
    '{ "CED": 8, "BW": {"value": 1.2, "pct": 15}, "WW": 70, "Marb": {"value": 0.8, "pct": 4} }',
  );
  async function addLot() {
    let epd: unknown;
    try {
      epd = epdText.trim() ? JSON.parse(epdText) : undefined;
    } catch {
      setMsg("EPD JSON is invalid");
      return;
    }
    try {
      const res = await authed<{ lotId: string; epdWarnings: string[] }>(
        `/console/auctions/${lotAuction}/lots`,
        {
          method: "POST",
          body: JSON.stringify({
            lotNumber: Number(lotNo),
            category: "SEMEN",
            priceUnit: "DOSE",
            startingBidCents: dollarsToCents(start),
            bullName: bull || undefined,
            dosesAvailable: doses ? Number(doses) : undefined,
            epd,
          }),
        },
      );
      setMsg(
        `Lot created${res.epdWarnings.length ? ` (EPD warnings: ${res.epdWarnings.join("; ")})` : ""}`,
      );
      await refresh();
    } catch (e) {
      setMsg(String(e));
    }
  }

  async function activate(lotId: string) {
    try {
      await authed(`/console/lots/${lotId}/status`, {
        method: "POST",
        body: JSON.stringify({ status: "ACTIVE" }),
      });
      await refresh();
    } catch (e) {
      setMsg(String(e));
    }
  }

  if (!signedIn) {
    return (
      <main className="wrap">
        <h1>Brindle Console</h1>
        <p className="muted">Seller sign-in</p>
        <div className="row">
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="seller@ranch.com" />
          <button onClick={signIn}>Sign in</button>
        </div>
        {msg && <p className="msg">{msg}</p>}
      </main>
    );
  }

  return (
    <main className="wrap">
      <header className="topbar">
        <h1>Console</h1>
        <button className="link" onClick={() => { clearToken(); setSignedIn(false); }}>Sign out</button>
      </header>
      {msg && <p className="msg">{msg}</p>}

      <section className="panel">
        <h2>New auction</h2>
        <div className="grid">
          <label>Name<input value={aName} onChange={(e) => setAName(e.target.value)} /></label>
          <label>Starts<input type="datetime-local" value={aStart} onChange={(e) => setAStart(e.target.value)} /></label>
          <label>Buyer premium %<input value={premium} onChange={(e) => setPremium(e.target.value)} /></label>
        </div>
        <button onClick={createAuction} disabled={!aName}>Create auction</button>
      </section>

      <section className="panel">
        <h2>Add genetics lot</h2>
        <div className="grid">
          <label>Auction
            <select value={lotAuction} onChange={(e) => setLotAuction(e.target.value)}>
              <option value="">Select…</option>
              {auctions.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label>Lot #<input value={lotNo} onChange={(e) => setLotNo(e.target.value)} /></label>
          <label>Bull name<input value={bull} onChange={(e) => setBull(e.target.value)} /></label>
          <label>Doses<input value={doses} onChange={(e) => setDoses(e.target.value)} /></label>
          <label>Opening bid $<input value={start} onChange={(e) => setStart(e.target.value)} placeholder="25.00" /></label>
        </div>
        <label className="full">EPDs (JSON)
          <textarea value={epdText} onChange={(e) => setEpdText(e.target.value)} rows={3} />
        </label>
        <button onClick={addLot} disabled={!lotAuction}>Add lot</button>
      </section>

      <section className="panel">
        <h2>Your auctions</h2>
        {auctions.length === 0 ? <p className="muted">None yet.</p> : auctions.map((a) => (
          <div key={a.id} className="auction">
            <div className="auction-head"><strong>{a.name}</strong> <span className="pill">{a.status}</span></div>
            <ul>
              {a.lots.map((l) => (
                <li key={l.id}>
                  Lot {l.lotNumber} — {l.bullName ?? "—"} <span className="pill sm">{l.status}</span>
                  {l.status === "DRAFT" && <button className="link" onClick={() => activate(l.id)}>Activate</button>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </main>
  );
}
