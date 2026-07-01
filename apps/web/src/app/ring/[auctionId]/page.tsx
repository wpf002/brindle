"use client";
import { useEffect, useRef, useState } from "react";
import { wsBase, getAuction } from "../../../lib/api";
import { getToken, devSignIn } from "../../../lib/session";
import { formatCents } from "../../../lib/format";
import { LiveVideo } from "../../../components/LiveVideo";

// Buyer's live-ring view: watch the auctioneer's current lot, see the ask and the
// standing bid update in real time, and take the ask with one tap.
export default function LiveRing({ params }: { params: { auctionId: string } }) {
  const { auctionId } = params;
  const [ask, setAsk] = useState<string | null>(null);
  const [standing, setStanding] = useState<string | null>(null);
  const [lotId, setLotId] = useState<string | null>(null);
  const [status, setStatus] = useState("OPEN");
  const [connected, setConnected] = useState(false);
  const [note, setNote] = useState("");
  const [email, setEmail] = useState("");
  const [hasToken, setHasToken] = useState(false);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [auctionName, setAuctionName] = useState("Live ring");
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => setHasToken(Boolean(getToken())), []);
  useEffect(() => {
    void getAuction(auctionId).then((a) => {
      if (a) { setStreamUrl(a.streamUrl); setAuctionName(a.name); }
    });
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
      if (!ev.ok) { setNote(`✗ ${ev.reason}`); return; }
      if (ev.lotId) setLotId(ev.lotId);
      if (ev.kind === "ASK_SET") { setAsk(ev.askCents); setStatus("OPEN"); }
      if (ev.kind === "TAKEN") { setStanding(ev.priceCents); setAsk(ev.nextAskCents); setNote(`Taken at ${formatCents(ev.priceCents)}`); }
      if (ev.kind === "SOLD") { setStanding(ev.priceCents); setStatus("SOLD"); setNote(`Sold at ${formatCents(ev.priceCents)}`); }
      if (ev.kind === "PASSED") setStatus("PASSED");
    };
    return () => socket.close();
  }, [auctionId, hasToken]);

  function takeAsk() {
    if (!lotId) return;
    ws.current?.send(JSON.stringify({ lotId, type: "TAKE_ASK", kind: "ONLINE" }));
  }

  async function signIn() {
    if (await devSignIn(email)) setHasToken(true);
    else setNote("Sign-in failed");
  }

  return (
    <main className="wrap detail">
      <h1>{auctionName}</h1>
      <LiveVideo streamUrl={streamUrl} />
      <div className="bidbox">
        <div className="muted">{connected ? "● live" : "○ connecting…"} · {status}</div>
        <div className="ring-standing">
          <span className="muted">Standing bid</span>
          <div className="price">{standing ? formatCents(standing) : "—"}</div>
        </div>
        <div className="ring-ask">
          <span className="muted">Auctioneer asks</span>
          <div className="askprice">{ask ? formatCents(ask) : "—"}</div>
        </div>

        {hasToken ? (
          <button className="bid" onClick={takeAsk} disabled={!ask || status !== "OPEN"}>
            Take the ask{ask ? ` — ${formatCents(ask)}` : ""}
          </button>
        ) : (
          <div className="signin">
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@ranch.com" />
            <button onClick={signIn}>Sign in to bid</button>
          </div>
        )}
        {note && <div className="status info">{note}</div>}
      </div>
    </main>
  );
}
