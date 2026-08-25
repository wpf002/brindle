"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { authed, isSignedIn, onAuthChange, openSignIn, humanizeError } from "../../lib/session";
import { formatCents } from "../../lib/format";

// The order buyer's book.
//
// An order buyer is filling a mandate for someone else across many lots and
// many barns. What they need on screen is not a bid button — it's how much of
// each order is still open and what they can pay for the rest without pushing
// the order's average past the client's ceiling.

interface Fill {
  id: string;
  headCount: number;
  priceCents: string;
  lot: { id: string; lotNumber: number; bullName: string | null; category: string };
}

interface Order {
  id: string;
  clientName: string;
  category: string;
  minWeightLbs: number | null;
  maxWeightLbs: number | null;
  targetHead: number;
  maxPriceCents: string;
  region: string | null;
  notes: string | null;
  status: string;
  fills: Fill[];
  filledHead: number;
  remainingHead: number;
  avgPaidCents: number | null;
  headroomCents: number | null;
}

const CLASSES = ["STEERS", "HEIFERS", "CALVES", "COWS", "PAIRS", "BRED_HEIFERS", "BULLS"];

function label(raw: string): string {
  return raw.toLowerCase().split("_").map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ");
}

function dollarsToCents(s: string): string {
  const clean = s.trim().replace(/[$,]/g, "");
  if (!clean) return "0";
  const [d, c = ""] = clean.split(".");
  return (BigInt(d || "0") * 100n + BigInt((c + "00").slice(0, 2))).toString();
}

export default function OrdersPage() {
  const [signedIn, setSignedIn] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [msg, setMsg] = useState("");

  const [client, setClient] = useState("");
  const [category, setCategory] = useState("STEERS");
  const [head, setHead] = useState("");
  const [ceiling, setCeiling] = useState("");
  const [minW, setMinW] = useState("");
  const [maxW, setMaxW] = useState("");

  const load = useCallback(async () => {
    if (!(await isSignedIn())) { setSignedIn(false); setLoaded(true); return; }
    setSignedIn(true);
    try {
      setOrders((await authed<{ orders: Order[] }>("/orders")).orders);
    } catch { setOrders([]); }
    setLoaded(true);
  }, []);

  useEffect(() => { void load(); return onAuthChange(() => void load()); }, [load]);

  async function create() {
    try {
      await authed("/orders", { method: "POST", body: JSON.stringify({
        clientName: client, category, targetHead: Number(head),
        maxPriceCents: dollarsToCents(ceiling),
        minWeightLbs: minW ? Number(minW) : undefined,
        maxWeightLbs: maxW ? Number(maxW) : undefined,
      }) });
      setClient(""); setHead(""); setCeiling(""); setMinW(""); setMaxW("");
      setMsg("Order added"); await load();
    } catch (e) { setMsg(humanizeError(e)); }
  }

  async function cancel(id: string) {
    try { await authed(`/orders/${id}/cancel`, { method: "POST" }); await load(); }
    catch (e) { setMsg(humanizeError(e)); }
  }

  if (!loaded) return <div className="wrap section"><p className="muted">Loading…</p></div>;

  if (!signedIn) {
    return (
      <div className="signin-wrap">
        <h1>Buying Orders</h1>
        <div className="signin-card">
          <p className="muted" style={{ margin: 0 }}>
            Sign in to keep your client orders and see which lots fill them.
          </p>
          <button className="btn btn-primary btn-lg" onClick={openSignIn}>Sign In</button>
        </div>
      </div>
    );
  }

  const open = orders.filter((o) => o.status === "OPEN");
  const closed = orders.filter((o) => o.status !== "OPEN");

  return (
    <main className="wrap section">
      <div className="eyebrow">Order Desk</div>
      <h1 style={{ fontSize: 34, margin: "10px 0 6px" }}>Buying Orders</h1>
      <p className="muted" style={{ maxWidth: "62ch", marginTop: 0 }}>
        What you&rsquo;re filling, for whom, and what&rsquo;s left. Headroom is the most you can
        pay for the remaining head and still land at or under the client&rsquo;s ceiling on
        average — not the ceiling itself, once you&rsquo;ve paid up for an early lot.
      </p>

      <div className="card-form" style={{ marginTop: 24 }}>
        <h2>New Order</h2>
        <div className="form-grid">
          <label className="field"><span className="label">Client</span>
            <input className="input" value={client} onChange={(e) => setClient(e.target.value)} placeholder="Sandhill Feeders" /></label>
          <label className="field"><span className="label">Class</span>
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
              {CLASSES.map((c) => <option key={c} value={c}>{label(c)}</option>)}
            </select></label>
          <label className="field"><span className="label">Head Wanted</span>
            <input className="input" value={head} onChange={(e) => setHead(e.target.value)} placeholder="500" /></label>
          <label className="field"><span className="label">Ceiling $/cwt</span>
            <input className="input" value={ceiling} onChange={(e) => setCeiling(e.target.value)} placeholder="225.00" /></label>
          <label className="field"><span className="label">Min Weight (lb)</span>
            <input className="input" value={minW} onChange={(e) => setMinW(e.target.value)} placeholder="500" /></label>
          <label className="field"><span className="label">Max Weight (lb)</span>
            <input className="input" value={maxW} onChange={(e) => setMaxW(e.target.value)} placeholder="650" /></label>
        </div>
        {msg && <div className="statusmsg info" style={{ marginBottom: 12 }}>{msg}</div>}
        <button className="btn btn-primary" onClick={create} disabled={!client || !head || !ceiling}>
          Add Order
        </button>
      </div>

      {open.length === 0 && closed.length === 0 ? (
        <div className="empty" style={{ marginTop: 26 }}>No orders yet.</div>
      ) : (
        <div style={{ marginTop: 26 }}>
          {[...open, ...closed].map((o) => <OrderRow key={o.id} order={o} onCancel={cancel} />)}
        </div>
      )}
    </main>
  );
}

function OrderRow({ order, onCancel }: { order: Order; onCancel: (id: string) => void }) {
  const pct = Math.min(100, Math.round((order.filledHead / order.targetHead) * 100));
  const overCeiling =
    order.avgPaidCents != null && order.avgPaidCents > Number(order.maxPriceCents);

  return (
    <div className="card-form" style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>{order.clientName}</h2>
        <span className="muted">
          {order.targetHead} head {label(order.category)}
          {order.minWeightLbs && order.maxWeightLbs ? ` · ${order.minWeightLbs}-${order.maxWeightLbs} lb` : ""}
        </span>
        {order.status !== "OPEN" && <span className="pill">{label(order.status)}</span>}
        {order.status === "OPEN" && (
          <button className="btn-link" style={{ marginLeft: "auto" }} onClick={() => onCancel(order.id)}>
            Cancel
          </button>
        )}
      </div>

      <div className="epd-track" style={{ margin: "12px 0 6px" }}>
        <div className="epd-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="muted" style={{ fontSize: 13 }}>
        {order.filledHead} of {order.targetHead} head · {order.remainingHead} to go
      </div>

      <dl className="import-grid" style={{ marginTop: 12 }}>
        <dt>Ceiling</dt><dd className="tabular">{formatCents(order.maxPriceCents)}/cwt</dd>
        <dt>Average Paid</dt>
        <dd className="tabular" style={overCeiling ? { color: "var(--danger)" } : undefined}>
          {order.avgPaidCents != null ? `${formatCents(String(order.avgPaidCents))}/cwt` : "—"}
        </dd>
        <dt>Headroom</dt>
        <dd className="tabular">
          {order.headroomCents != null ? `${formatCents(String(order.headroomCents))}/cwt` : "—"}
        </dd>
      </dl>

      {order.fills.length > 0 && (
        <ul className="lotlist" style={{ marginTop: 10 }}>
          {order.fills.map((f) => (
            <li key={f.id}>
              <Link href={`/lots/${f.lot.id}`}>Lot {f.lot.lotNumber}</Link>
              <span className="dim">{f.headCount} head at {formatCents(f.priceCents)}/cwt</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
