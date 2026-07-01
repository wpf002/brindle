"use client";
import { useEffect, useRef, useState } from "react";
import { wsBase } from "../lib/api";
import { getToken, devSignIn } from "../lib/session";
import { formatCents } from "../lib/format";

// Parse a dollars string to integer cents without ever letting a float touch the
// value (no *100 on a Number).
function dollarsToCents(input: string): bigint {
  const clean = input.trim().replace(/[$,]/g, "");
  if (!clean) return 0n;
  const [d, c = ""] = clean.split(".");
  const cents = (c + "00").slice(0, 2);
  return BigInt(d || "0") * 100n + BigInt(cents || "0");
}

interface Props {
  auctionId: string;
  lotId: string;
  initialPriceCents: string;
  incrementCents: string;
}

type Status = { kind: "idle" | "leading" | "outbid" | "rejected" | "info"; text: string };

export function BidBox({ auctionId, lotId, initialPriceCents, incrementCents }: Props) {
  const [price, setPrice] = useState<string>(initialPriceCents);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle", text: "" });
  const [maxBid, setMaxBid] = useState("");
  const [email, setEmail] = useState("");
  const [hasToken, setHasToken] = useState(false);
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    setHasToken(Boolean(getToken()));
  }, []);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    const socket = new WebSocket(`${wsBase()}/auctions/${auctionId}/ws?token=${token}`);
    ws.current = socket;
    socket.onopen = () => setConnected(true);
    socket.onclose = () => setConnected(false);
    socket.onmessage = (e) => {
      const evt = JSON.parse(e.data);
      if (evt.lotId && evt.lotId !== lotId) return;
      if (evt.ok) {
        setPrice(evt.priceCents);
        setStatus(
          evt.leadChanged
            ? { kind: "info", text: `New high bid ${formatCents(evt.priceCents)}` }
            : { kind: "info", text: `Price now ${formatCents(evt.priceCents)}` },
        );
      } else if (evt.reason) {
        setStatus({ kind: "rejected", text: `Bid rejected: ${evt.reason}` });
      }
    };
    return () => socket.close();
  }, [auctionId, lotId, hasToken]);

  const nextMin = (BigInt(price) + BigInt(incrementCents)).toString();

  function placeBid() {
    if (!ws.current || ws.current.readyState !== WebSocket.OPEN) {
      setStatus({ kind: "rejected", text: "Not connected" });
      return;
    }
    const amount = BigInt(nextMin);
    const proxy = maxBid ? dollarsToCents(maxBid) : undefined;
    ws.current.send(
      JSON.stringify({
        lotId,
        amountCents: amount.toString(),
        ...(proxy && proxy > amount ? { proxyMaxCents: proxy.toString() } : {}),
      }),
    );
    setStatus({ kind: "info", text: "Bid sent…" });
  }

  async function signIn() {
    if (await devSignIn(email)) {
      setHasToken(true);
      setStatus({ kind: "info", text: "Signed in" });
    } else {
      setStatus({ kind: "rejected", text: "Sign-in failed (unknown email)" });
    }
  }

  return (
    <div className="bidbox">
      <div className="price">{formatCents(price)}</div>
      <div className="muted">
        {connected ? "● live" : "○ offline"} · next min {formatCents(nextMin)}
      </div>

      {hasToken ? (
        <>
          <button className="bid" onClick={placeBid}>
            Bid {formatCents(nextMin)}
          </button>
          <label className="field">
            <span>Max (proxy) bid — optional</span>
            <input
              value={maxBid}
              onChange={(e) => setMaxBid(e.target.value)}
              placeholder="e.g. 2500.00"
              inputMode="decimal"
            />
          </label>
        </>
      ) : (
        <div className="signin">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@ranch.com"
          />
          <button onClick={signIn}>Sign in to bid</button>
        </div>
      )}

      {status.text && <div className={`status ${status.kind}`}>{status.text}</div>}
    </div>
  );
}
