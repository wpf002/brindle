"use client";
import { useEffect, useRef, useState } from "react";
import { authed, getToken, wsBase } from "../../../lib/session";

interface Lot {
  id: string;
  lotNumber: number;
  status: string;
  bullName: string | null;
}

function centsToDollars(c: string | bigint): string {
  const v = BigInt(c);
  return `$${(v / 100n).toLocaleString()}.${(v % 100n).toString().padStart(2, "0")}`;
}
function dollarsToCents(s: string): string {
  const clean = s.trim().replace(/[$,]/g, "");
  if (!clean) return "0";
  const [d, c = ""] = clean.split(".");
  return (BigInt(d || "0") * 100n + BigInt((c + "00").slice(0, 2))).toString();
}

export default function RingConsole({ params }: { params: { auctionId: string } }) {
  const { auctionId } = params;
  const [lots, setLots] = useState<Lot[]>([]);
  const [currentLot, setCurrentLot] = useState("");
  const [ask, setAsk] = useState<string | null>(null);
  const [standing, setStanding] = useState<string | null>(null);
  const [highBidder, setHighBidder] = useState<string | null>(null);
  const [status, setStatus] = useState("OPEN");
  const [log, setLog] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const [newAsk, setNewAsk] = useState("");
  const [floorBidder, setFloorBidder] = useState("");
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const { auctions } = await authed<{ auctions: { id: string; lots: Lot[] }[] }>("/console/auctions");
        const a = auctions.find((x) => x.id === auctionId);
        setLots(a?.lots ?? []);
        if (a?.lots[0]) setCurrentLot(a.lots[0].id);
      } catch {
        /* not signed in */
      }
    })();
  }, [auctionId]);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    const socket = new WebSocket(`${wsBase()}/auctions/${auctionId}/ring?token=${token}`);
    ws.current = socket;
    socket.onopen = () => setConnected(true);
    socket.onclose = () => setConnected(false);
    socket.onmessage = (e) => {
      const ev = JSON.parse(e.data);
      setLog((l) => [describe(ev), ...l].slice(0, 12));
      if (!ev.ok) return;
      if (ev.kind === "ASK_SET") setAsk(ev.askCents);
      if (ev.kind === "TAKEN") { setStanding(ev.priceCents); setHighBidder(ev.bidderId); setAsk(ev.nextAskCents); }
      if (ev.kind === "SOLD") { setStanding(ev.priceCents); setStatus("SOLD"); }
      if (ev.kind === "PASSED") setStatus("PASSED");
    };
    return () => socket.close();
  }, [auctionId]);

  function describe(ev: Record<string, unknown>): string {
    if (!ev.ok) return `✗ ${ev.reason}`;
    if (ev.kind === "ASK_SET") return `ask → ${centsToDollars(ev.askCents as string)}`;
    if (ev.kind === "TAKEN") return `TAKEN ${centsToDollars(ev.priceCents as string)} (${ev.bidKind})`;
    if (ev.kind === "SOLD") return `SOLD ${centsToDollars(ev.priceCents as string)}`;
    if (ev.kind === "PASSED") return "PASSED";
    return JSON.stringify(ev);
  }

  function send(payload: Record<string, unknown>) {
    ws.current?.send(JSON.stringify({ lotId: currentLot, ...payload }));
  }

  return (
    <main className="wrap">
      <header className="topbar">
        <h1>Ring control</h1>
        <span className="pill">{connected ? "● live" : "○ offline"}</span>
      </header>

      <section className="panel">
        <label>Current lot
          <select value={currentLot} onChange={(e) => setCurrentLot(e.target.value)}>
            {lots.map((l) => <option key={l.id} value={l.id}>Lot {l.lotNumber} — {l.bullName ?? "—"}</option>)}
          </select>
        </label>
        <div className="ringstate">
          <div><span className="muted">Standing</span><strong>{standing ? centsToDollars(standing) : "—"}</strong></div>
          <div><span className="muted">Ask</span><strong>{ask ? centsToDollars(ask) : "—"}</strong></div>
          <div><span className="muted">Status</span><strong>{status}</strong></div>
        </div>
        {highBidder && <p className="muted">High bidder: {highBidder.slice(0, 8)}…</p>}
      </section>

      <section className="panel">
        <h2>Auctioneer</h2>
        <div className="grid">
          <label>Set ask $<input value={newAsk} onChange={(e) => setNewAsk(e.target.value)} placeholder="1200.00" /></label>
        </div>
        <div className="row">
          <button onClick={() => { send({ type: "SET_ASK", askCents: dollarsToCents(newAsk) }); setNewAsk(""); }} disabled={!newAsk}>Set ask</button>
          <button onClick={() => send({ type: "HAMMER" })}>Hammer</button>
          <button className="link" onClick={() => send({ type: "PASS" })}>Pass</button>
        </div>
      </section>

      <section className="panel">
        <h2>Enter floor / phone bid</h2>
        <div className="grid">
          <label>Bidder user id<input value={floorBidder} onChange={(e) => setFloorBidder(e.target.value)} placeholder="registered buyer id" /></label>
        </div>
        <div className="row">
          <button onClick={() => send({ type: "TAKE_ASK", kind: "FLOOR", bidderId: floorBidder })} disabled={!floorBidder}>Floor takes ask</button>
          <button onClick={() => send({ type: "TAKE_ASK", kind: "PHONE", bidderId: floorBidder })} disabled={!floorBidder}>Phone takes ask</button>
        </div>
      </section>

      <section className="panel">
        <h2>Ring log</h2>
        <ul className="ringlog">{log.map((l, i) => <li key={i}>{l}</li>)}</ul>
      </section>
    </main>
  );
}
