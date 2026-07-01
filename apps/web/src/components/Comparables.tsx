"use client";
import { useEffect, useState } from "react";
import { API } from "../lib/api";
import { formatCents } from "../lib/format";

interface Comps {
  weightedAvgCentsPerCwt: number | null;
  lowCentsPerCwt: number | null;
  highCentsPerCwt: number | null;
  totalHead: number;
  latestReportDate: string | null;
}

// Market context inline at the bid box: "comparable lots sold at $X/cwt." Gives a
// buyer a reason to bid on Brindle instead of guessing. Renders nothing when no
// comparable AMS sales match the lot's class + weight.
export function Comparables({ category, weightLbs }: { category: string; weightLbs: number }) {
  const [data, setData] = useState<Comps | null>(null);

  useEffect(() => {
    const url = `${API}/market/comparables?category=${encodeURIComponent(category)}&weight=${weightLbs}`;
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => setData(null));
  }, [category, weightLbs]);

  if (!data || data.weightedAvgCentsPerCwt === null) return null;

  return (
    <div className="comps">
      <span className="muted">Comparable AMS sales</span>
      <div className="comps-avg">{formatCents(String(data.weightedAvgCentsPerCwt))}/cwt</div>
      <div className="muted comps-range">
        range {formatCents(String(data.lowCentsPerCwt))}–{formatCents(String(data.highCentsPerCwt))} ·{" "}
        {data.totalHead.toLocaleString()} head
        {data.latestReportDate ? ` · as of ${data.latestReportDate}` : ""}
      </div>
    </div>
  );
}
