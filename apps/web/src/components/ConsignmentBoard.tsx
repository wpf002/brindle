"use client";
import { useCallback, useEffect, useState } from "react";
import { authed, humanizeError } from "../lib/session";

// The barn's arrivals board for one sale.
//
// Consignment comes before lots exist: a rancher says what's coming, it gets
// checked in and tagged, and only then does the barn sort it into uniform lots.
// The sort is the barn's actual craft — a straight load brings more than the
// same cattle sold mixed — so it's a deliberate step here, not an afterthought.

interface Consignment {
  id: string;
  headCount: number;
  category: string;
  estWeightLbs: number | null;
  primaryBreed: string | null;
  story: string | null;
  programCerts: string[];
  originState: string | null;
  backTagRange: string | null;
  brandInspected: boolean;
  cviOnFile: boolean;
  status: string;
  consignor: { id: string; legalName: string; businessName: string | null };
  lots: { id: string; lotNumber: number; headCount: number | null }[];
}

const NEXT_STEP: Record<string, { to: string; label: string }> = {
  SUBMITTED: { to: "CHECKED_IN", label: "Check In" },
  CHECKED_IN: { to: "TAGGED", label: "Tag In" },
};

function label(raw: string): string {
  return raw.toLowerCase().split("_").map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ");
}

export function ConsignmentBoard({ auctionId }: { auctionId: string }) {
  const [items, setItems] = useState<Consignment[]>([]);
  const [isBarn, setIsBarn] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await authed<{ consignments: Consignment[]; viewingAsBarn: boolean }>(
        `/auctions/${auctionId}/consignments`,
      );
      setItems(r.consignments);
      setIsBarn(r.viewingAsBarn);
    } catch { setItems([]); }
  }, [auctionId]);

  useEffect(() => { void load(); }, [load]);

  async function advance(id: string, to: string) {
    try {
      await authed(`/consignments/${id}/status`, { method: "POST", body: JSON.stringify({ status: to }) });
      await load();
    } catch (e) { setMsg(humanizeError(e)); }
  }

  async function sortIntoLots(c: Consignment) {
    // Simplest honest default: one uniform lot for the whole draft. A barn that
    // wants to split further does it lot by lot; what matters is that the head
    // always adds up, which the API enforces.
    const startingBid = window.prompt(
      `Opening bid per cwt for ${c.headCount} head? (e.g. 218.00)`, "218.00",
    );
    if (!startingBid) return;
    const cents = Math.round(Number(startingBid.replace(/[$,]/g, "")) * 100);
    if (!Number.isFinite(cents) || cents <= 0) { setMsg("That opening bid didn't look like a number."); return; }
    try {
      await authed(`/consignments/${c.id}/sort`, { method: "POST", body: JSON.stringify({
        lots: [{
          lotNumber: Math.floor(Date.now() / 1000) % 100000,
          headCount: c.headCount,
          avgWeightLbs: c.estWeightLbs ?? undefined,
          startingBidCents: cents,
        }],
      }) });
      setMsg("Sorted into lots"); await load();
    } catch (e) { setMsg(humanizeError(e)); }
  }

  if (items.length === 0) return null;

  return (
    <div className="card-form" style={{ marginTop: 22 }}>
      <h2>Consignments</h2>
      <p className="block-note" style={{ marginTop: -10 }}>
        {isBarn
          ? "What's coming to this sale. Check in on arrival, tag in once brand and health papers are done, then sort into uniform lots."
          : "What you've consigned to this sale and where it is in the barn's process."}
      </p>
      {msg && <div className="statusmsg info" style={{ marginBottom: 12 }}>{msg}</div>}

      <ul className="lotlist">
        {items.map((c) => {
          const step = NEXT_STEP[c.status];
          return (
            <li key={c.id} style={{ display: "grid", gap: 3 }}>
              <span>
                <strong>{c.headCount} head {label(c.category)}</strong>
                {c.estWeightLbs ? ` · ${c.estWeightLbs} lb est` : ""}
                {c.primaryBreed ? ` · ${c.primaryBreed}` : ""}
                <span className="pill" style={{ marginLeft: 8 }}>{label(c.status)}</span>
              </span>
              <span className="dim" style={{ fontSize: 12 }}>
                {c.consignor.businessName ?? c.consignor.legalName}
                {c.backTagRange ? ` · tags ${c.backTagRange}` : ""}
                {c.brandInspected ? " · brand inspected" : ""}
                {c.cviOnFile ? " · CVI on file" : ""}
                {c.lots.length > 0 ? ` · sorted into ${c.lots.length} lot${c.lots.length === 1 ? "" : "s"}` : ""}
              </span>
              {isBarn && (
                <span style={{ display: "flex", gap: 8, marginTop: 4 }}>
                  {step && (
                    <button className="btn btn-ghost btn-sm" onClick={() => advance(c.id, step.to)}>
                      {step.label}
                    </button>
                  )}
                  {c.status === "TAGGED" && (
                    <button className="btn btn-primary btn-sm" onClick={() => sortIntoLots(c)}>
                      Sort Into Lots
                    </button>
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
