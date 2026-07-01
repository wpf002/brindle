"use client";
import { useEffect, useRef, useState } from "react";
import { wsBase, getAuction } from "../../../lib/api";
import { getToken, getSession, onAuthChange, openSignIn } from "../../../lib/session";
import { formatCents } from "../../../lib/format";
import { LiveVideo } from "../../../components/LiveVideo";

function centsToDollars(c: string): string { return formatCents(c); }
function dollarsToCents(s: string): string {
  const clean = s.trim().replace(/[$,]/g, "");
  if (!clean) return "0";
  const [d, c = ""] = clean.split(".");
  return (BigInt(d || "0") * 100n + BigInt((c + "00").slice(0, 2))).toString();
}

export default function LiveRing({ params }: { params: { auctionId: string } }) {
  const { auctionId } = params;
  const [name, setName] = useState("Live ring");
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [isAuctioneer, setIsAuctioneer] = useState(false);
  const [lotId, setLotId] = useState<string | null>(null);
  const [ask, setAsk] = useState<string | null>(null);
  const [standing, setStanding] = useState<string | null>(null);
  const [status, setStatus] = useState("OPEN");
  const [connected, setConnected] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [newAsk, setNewAsk] = useState("");
  const [signedIn, setSignedIn] = useState(false);
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    const sync = () => setSignedIn(Boolean(getToken()));
    sync();
    return onAuthChange(sync);
  }, []);

  useEffect(() => {
    void (async () => {
      const [a, s] = await Promise.all([getAuction(auctionId), getSession()]);
      if (a) { setName(a.name); setStreamUrl(a.streamUrl); if (s && s.userId === a.sellerId) setIsAuctioneer(true); }
    })();
  }, [auctionId, signedIn]);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    const socket = new WebSocket(`${wsBase()}/auctions/${auctionId}/ring?token=${token}`);
    ws.current = socket;
    socket.onopen = () => setConnected(true);
    socket.onclose = () => setConnected(false);
    socket.onmessage = (e) => {
      const ev = JSON.parse(e.data);
      setLog((l) => [describe(ev), ...l].slice(0, 14));
      if (!ev.ok) return;
      if (ev.lotId) setLotId(ev.lotId);
      if (ev.kind === "ASK_SET") { setAsk(ev.askCents); setStatus("OPEN"); }
      if (ev.kind === "TAKEN") { setStanding(ev.priceCents); setAsk(ev.nextAskCents); }
      if (ev.kind === "SOLD") { setStanding(ev.priceCents); setStatus("SOLD"); }
      if (ev.kind === "PASSED") setStatus("PASSED");
    };
    return () => socket.close();
  }, [auctionId, signedIn]);

  function describe(ev: Record<string, unknown>): string {
    if (!ev.ok) return `✗ ${ev.reason}`;
    if (ev.kind === "ASK_SET") return `ask → ${centsToDollars(ev.askCents as string)}`;
    if (ev.kind === "TAKEN") return `taken ${centsToDollars(ev.priceCents as string)} (${ev.bidKind})`;
    if (ev.kind === "SOLD") return `SOLD ${centsToDollars(ev.priceCents as string)}`;
    if (ev.kind === "PASSED") return "passed";
    return "";
  }
  function send(p: Record<string, unknown>) { ws.current?.send(JSON.stringify({ lotId, ...p })); }

  return (
    <div className="ring-theater">
      <div className="wrap ring-grid">
        <div>
          <div className="eyebrow" style={{ color: "var(--gold)" }}>Live sale</div>
          <h1 style={{ color: "#f1ece3", fontSize: 30, margin: "8px 0 18px" }}>{name}</h1>
          <div className="ring-video"><LiveVideo streamUrl={streamUrl} /></div>
          <ul className="ring-log">{log.map((l, i) => <li key={i}>{l}</li>)}</ul>
        </div>

        <div className="ring-panel">
          <div className="ring-standing">
            <div className="k">Standing bid</div>
            <div className="big tabular">{standing ? centsToDollars(standing) : "—"}</div>
            <div style={{ fontSize: 12.5, color: "#9a8f80", marginTop: 6 }}>
              <span className={connected ? "dotlive" : "dotoff"} style={{ display: "inline-block", marginRight: 6 }} />
              {connected ? "Live" : "Connecting…"} · {status}
            </div>
          </div>
          <div className="ring-ask">
            <div className="k">Auctioneer asks</div>
            <div className="big tabular">{ask ? centsToDollars(ask) : "—"}</div>
          </div>

          <div style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 10 }}>
            {!signedIn ? (
              <button className="btn btn-primary btn-lg" onClick={openSignIn}>Sign in to join</button>
            ) : isAuctioneer ? (
              <>
                <div className="field"><span className="label" style={{ color: "#9a8f80" }}>Set ask $</span>
                  <input className="input" style={{ background: "#14110d", borderColor: "#2f2820", color: "#f1ece3" }}
                    value={newAsk} onChange={(e) => setNewAsk(e.target.value)} placeholder="1200.00" /></div>
                <button className="btn btn-forest btn-lg" onClick={() => { send({ type: "SET_ASK", askCents: dollarsToCents(newAsk) }); setNewAsk(""); }} disabled={!newAsk || !lotId}>Set ask</button>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => send({ type: "HAMMER" })} disabled={!lotId}>Hammer</button>
                  <button className="btn btn-ghost" onClick={() => send({ type: "PASS" })} disabled={!lotId}>Pass</button>
                </div>
                <p style={{ fontSize: 12, color: "#6b6157" }}>You are the auctioneer for this sale.</p>
              </>
            ) : (
              <button className="btn btn-forest btn-lg" onClick={() => send({ type: "TAKE_ASK", kind: "ONLINE" })}
                disabled={!ask || status !== "OPEN" || !lotId}>
                Take the ask{ask ? ` — ${centsToDollars(ask)}` : ""}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
