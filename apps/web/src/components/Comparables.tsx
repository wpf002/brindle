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

// Market context inline at the bid box: "comparable lots sold at $X/cwt." Renders
// nothing when no comparable AMS sales match the lot's class + weight.
export function Comparables({ category, weightLbs }: { category: string; weightLbs: number }) {
  const [data, setData] = useState<Comps | null>(null);
  useEffect(() => {
    fetch(`${API}/market/comparables?category=${encodeURIComponent(category)}&weight=${weightLbs}`)
      .then((r) => (r.ok ? r.json() : null)).then(setData).catch(() => setData(null));
  }, [category, weightLbs]);

  if (!data || data.weightedAvgCentsPerCwt === null) return null;
  return (
    <div className="comps">
      <div className="k">Comparable AMS sales</div>
      <div className="comps-avg tabular">{formatCents(String(data.weightedAvgCentsPerCwt))}/cwt</div>
      <div className="comps-range">
        {formatCents(String(data.lowCentsPerCwt))}–{formatCents(String(data.highCentsPerCwt))} · {data.totalHead.toLocaleString()} head
        {data.latestReportDate ? ` · as of ${data.latestReportDate}` : ""}
      </div>
    </div>
  );
}
