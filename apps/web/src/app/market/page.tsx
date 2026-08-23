import { API } from "../../lib/api";
import { formatCents } from "../../lib/format";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Cattle market prices",
  description: "Live USDA-reported cattle prices, updated from AMS Livestock Mandatory Price Reporting.",
};

interface MarketRow {
  reportDate: string;
  region: string;
  category: string;
  wtLowLbs: number;
  wtHighLbs: number;
  avgCentsPerCwt: number;
  headCount: number;
  source: string;
}

async function getLatest(): Promise<{ rows: MarketRow[]; asOf: string | null }> {
  try {
    const r = await fetch(`${API}/market/latest`, { cache: "no-store" });
    if (!r.ok) return { rows: [], asOf: null };
    return r.json();
  } catch {
    return { rows: [], asOf: null };
  }
}

export default async function MarketPage() {
  const { rows, asOf } = await getLatest();

  return (
    <main className="wrap section">
      <div className="eyebrow">Market data</div>
      <h1 style={{ fontSize: 34, margin: "10px 0 8px" }}>Cattle prices</h1>
      <p className="muted" style={{ maxWidth: "60ch", marginBottom: 26 }}>
        Negotiated slaughter cattle prices as reported to USDA under Livestock Mandatory
        Price Reporting. These are packer-reported fed cattle trades — useful market
        context, not a substitute for feeder-calf sale-barn averages.
      </p>

      {rows.length === 0 ? (
        <div className="empty">
          No market data loaded yet. An administrator can pull the latest USDA reports
          from the back office.
        </div>
      ) : (
        <>
          <table className="market-table">
            <thead>
              <tr>
                <th>Class</th>
                <th>Weight range</th>
                <th className="num">Head</th>
                <th className="num">Weighted avg</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.source}-${row.category}-${row.wtLowLbs}-${row.wtHighLbs}`}>
                  <td>{row.category}</td>
                  <td className="tabular">
                    {row.wtLowLbs.toLocaleString()}–{row.wtHighLbs.toLocaleString()} lb
                  </td>
                  <td className="num tabular">{row.headCount.toLocaleString()}</td>
                  <td className="num tabular">
                    <strong>{formatCents(String(row.avgCentsPerCwt))}</strong>
                    <span className="dim">/cwt</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="source-note">
            Source: USDA Agricultural Marketing Service, Livestock Mandatory Price Reporting
            {asOf ? ` · report date ${asOf}` : ""}.
          </p>
        </>
      )}
    </main>
  );
}
