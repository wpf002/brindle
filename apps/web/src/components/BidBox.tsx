"use client";
import { useEffect, useRef, useState } from "react";
import { wsBase } from "../lib/api";
import { getToken, onAuthChange } from "../lib/session";
import { formatCents } from "../lib/format";

function dollarsToCents(input: string): bigint {
  const clean = input.trim().replace(/[$,]/g, "");
  if (!clean) return 0n;
  const [d, c = ""] = clean.split(".");
  return BigInt(d || "0") * 100n + BigInt((c + "00").slice(0, 2));
}

interface Props {
  auctionId: string;
  lotId: string;
  initialPriceCents: string;
  incrementCents: string;
  unit: string;
}

type Status = { kind: "idle" | "info" | "rejected"; text: string };

export function BidBox({ auctionId, lotId, initialPriceCents, incrementCents, unit }: Props) {
  const [price, setPrice] = useState(initialPriceCents);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle", text: "" });
  const [maxBid, setMaxBid] = useState("");
  const [signedIn, setSignedIn] = useState(false);
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    const sync = () => setSignedIn(Boolean(getToken()));
    sync();
    return onAuthChange(sync);
  }, []);

  useEffect(() => {
    const token = getToken();
    if (!token) { setConnected(false); return; }
    const socket = new WebSocket(`${wsBase()}/auctions/${auctionId}/ws?token=${token}`);
    ws.current = socket;
    socket.onopen = () => setConnected(true);
    socket.onclose = () => setConnected(false);
    socket.onmessage = (e) => {
      const evt = JSON.parse(e.data);
      if (evt.lotId && evt.lotId !== lotId) return;
      if (evt.ok) {
        setPrice(evt.priceCents);
        setStatus({ kind: "info", text: evt.leadChanged ? "You're the high bidder" : `Price now ${formatCents(evt.priceCents)}` });
      } else if (evt.reason) {
        setStatus({ kind: "rejected", text: humanReason(evt.reason) });
      }
    };
    return () => socket.close();
  }, [auctionId, lotId, signedIn]);

  const nextMin = (BigInt(price) + BigInt(incrementCents)).toString();

  function placeBid() {
    if (!ws.current || ws.current.readyState !== WebSocket.OPEN) {
      setStatus({ kind: "rejected", text: "Reconnecting…" });
      return;
    }
    const amount = BigInt(nextMin);
    const proxy = maxBid ? dollarsToCents(maxBid) : undefined;
    ws.current.send(JSON.stringify({
      lotId, amountCents: amount.toString(),
      ...(proxy && proxy > amount ? { proxyMaxCents: proxy.toString() } : {}),
    }));
    setStatus({ kind: "info", text: "Bid placed" });
  }

  return (
    <aside className="panel">
      <div className="panel-head">
        <div className="k">Current bid</div>
        <div className="panel-price tabular">{formatCents(price)}<span className="u">{unit}</span></div>
        <div className="panel-status">
          <span className={connected ? "dotlive" : "dotoff"} />
          {connected ? "Live" : "Offline"} · next bid {formatCents(nextMin)}
        </div>
      </div>
      <div className="panel-body">
        {signedIn ? (
          <>
            <button className="btn btn-primary btn-lg" onClick={placeBid}>
              Bid {formatCents(nextMin)}
            </button>
            <div className="field">
              <span className="label">Set a max bid (optional)</span>
              <input className="input tabular" value={maxBid} onChange={(e) => setMaxBid(e.target.value)}
                placeholder="e.g. 250.00" inputMode="decimal" />
            </div>
            <div className="watchline"><span>Proxy bidding — we bid up to your max</span></div>
          </>
        ) : (
          <SignInInline />
        )}
        {status.text && <div className={`statusmsg ${status.kind}`}>{status.text}</div>}
      </div>
    </aside>
  );
}

function SignInInline() {
  return (
    <p className="muted" style={{ fontSize: 14 }}>
      <button className="btn btn-primary btn-lg" onClick={() => document.querySelector<HTMLButtonElement>(".nav-user .btn-primary")?.click()}>
        Sign in to bid
      </button>
    </p>
  );
}

function humanReason(reason: string): string {
  switch (reason) {
    case "BELOW_MIN_INCREMENT": return "Someone just outbid that amount — try again";
    case "NOT_CREDIT_APPROVED": return "Your buyer credit isn't approved yet";
    case "SELF_BID": return "You can't bid on your own lot";
    case "LOT_CLOSED": return "This lot has closed";
    default: return `Bid rejected (${reason})`;
  }
}
