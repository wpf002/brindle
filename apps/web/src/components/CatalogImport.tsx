"use client";
import { useRef, useState } from "react";
import { authed, humanizeError } from "../lib/session";
import { formatCents } from "../lib/format";

interface LotDraft {
  lotNumber: number;
  category: string;
  priceUnit: string;
  startingBidCents: string;
  bullName?: string;
  bullRegId?: string;
  dosesAvailable?: number;
  epd?: Record<string, { value: number }>;
}
interface RowError { row: number; message: string }
interface Preview {
  columns: Record<string, string>;
  epdColumns: Record<string, string>;
  lots: LotDraft[];
  errors: RowError[];
  summary: { parsed: number; failed: number };
}

/** Bulk-create lots from an existing sale catalog CSV. Preview, then commit. */
export function CatalogImport({ auctions, onImported }: {
  auctions: { id: string; name: string }[];
  onImported: () => void;
}) {
  const [csv, setCsv] = useState("");
  const [filename, setFilename] = useState("");
  const [auctionId, setAuctionId] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFilename(file.name);
    setCsv(await file.text());
    setPreview(null);
    setMsg("");
    setError("");
  }

  async function runPreview() {
    setBusy(true); setError(""); setMsg("");
    try {
      setPreview(await authed<Preview>("/console/catalog/preview", {
        method: "POST",
        body: JSON.stringify({ csv }),
      }));
    } catch (e) {
      setError(humanizeError(e));
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    setBusy(true); setError(""); setMsg("");
    try {
      const r = await authed<{ created: number; errors: RowError[] }>(
        `/console/auctions/${auctionId}/catalog/commit`,
        { method: "POST", body: JSON.stringify({ csv, filename: filename || "catalog.csv" }) },
      );
      setMsg(
        `Created ${r.created} lot${r.created === 1 ? "" : "s"}` +
        (r.errors.length ? ` · ${r.errors.length} row${r.errors.length === 1 ? "" : "s"} skipped` : ""),
      );
      setPreview(null);
      setCsv("");
      setFilename("");
      if (fileRef.current) fileRef.current.value = "";
      onImported();
    } catch (e) {
      setError(humanizeError(e));
    } finally {
      setBusy(false);
    }
  }

  const detected = preview ? Object.entries(preview.columns) : [];

  return (
    <div className="card-form">
      <h2>Import a sale catalog</h2>
      <p className="block-note" style={{ marginTop: -10 }}>
        Upload the CSV your sale-management software already exports. We&rsquo;ll match
        your column names automatically — no reformatting needed.
      </p>

      <div className="form-grid">
        <label className="field">
          <span className="label">Catalog file (.csv)</span>
          <input ref={fileRef} className="input" type="file" accept=".csv,text/csv" onChange={onFile} />
        </label>
        <label className="field">
          <span className="label">Add lots to</span>
          <select className="input" value={auctionId} onChange={(e) => setAuctionId(e.target.value)}>
            <option value="">Select a sale…</option>
            {auctions.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
      </div>

      <label className="field" style={{ marginBottom: 14 }}>
        <span className="label">…or paste the catalog directly</span>
        <textarea className="input" rows={4} value={csv} placeholder="Lot #,Bull Name,Registration Number,Opening Bid,Doses,CED,BW"
          onChange={(e) => { setCsv(e.target.value); setPreview(null); }} />
      </label>

      {error && <div className="statusmsg rejected" style={{ marginBottom: 12 }}>{error}</div>}
      {msg && <div className="statusmsg info" style={{ marginBottom: 12 }}>{msg}</div>}

      <div style={{ display: "flex", gap: 10 }}>
        <button className="btn btn-ghost" onClick={runPreview} disabled={busy || !csv.trim()}>
          {busy ? "Reading…" : "Preview"}
        </button>
        {preview && preview.lots.length > 0 && (
          <button className="btn btn-primary" onClick={commit} disabled={busy || !auctionId}>
            Create {preview.lots.length} lot{preview.lots.length === 1 ? "" : "s"}
          </button>
        )}
      </div>

      {preview && (
        <div style={{ marginTop: 18 }}>
          <dl className="import-grid">
            <dt>Rows ready</dt><dd className="tabular">{preview.summary.parsed}</dd>
            <dt>Rows skipped</dt><dd className="tabular">{preview.summary.failed}</dd>
            <dt>Columns matched</dt>
            <dd>{detected.length ? detected.map(([f, c]) => `${c} → ${f}`).join(", ") : "none"}</dd>
            {Object.keys(preview.epdColumns).length > 0 && (
              <>
                <dt>EPD traits</dt>
                <dd>{Object.keys(preview.epdColumns).join(", ")}</dd>
              </>
            )}
          </dl>

          {preview.lots.length > 0 && (
            <table className="market-table" style={{ marginTop: 12 }}>
              <thead>
                <tr><th>Lot</th><th>Name</th><th>Registration</th><th className="num">Opening</th></tr>
              </thead>
              <tbody>
                {preview.lots.slice(0, 8).map((l) => (
                  <tr key={l.lotNumber}>
                    <td className="tabular">{l.lotNumber}</td>
                    <td>{l.bullName ?? l.category}</td>
                    <td className="tabular">{l.bullRegId ?? "—"}</td>
                    <td className="num tabular">{formatCents(l.startingBidCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {preview.lots.length > 8 && (
            <p className="dim" style={{ fontSize: 12.5, marginTop: 8 }}>
              …and {preview.lots.length - 8} more.
            </p>
          )}

          {preview.errors.length > 0 && (
            <ul className="row-errors">
              {preview.errors.slice(0, 6).map((e, i) => (
                <li key={i}>Row {e.row}: {e.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
