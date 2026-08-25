"use client";
import { useEffect, useState } from "react";
import { API } from "../lib/api";
import { formatCents } from "../lib/format";

// What a lot should bring, per hundredweight.
//
// Deliberately shows its work. An estimate a buyer can't audit is one they
// either over-trust or ignore, so the confidence and the basis are as
// prominent as the number, and a thin basis renders as an explanation rather
// than a figure.

interface Range {
  lowCentsPerCwt: number;
  midCentsPerCwt: number;
  highCentsPerCwt: number;
  confidence: "low" | "moderate" | "good";
  basis: string;
  usdaComps: number;
  brindleComps: number;
}

const CONFIDENCE_COPY: Record<Range["confidence"], string> = {
  low: "Low confidence",
  moderate: "Moderate confidence",
  good: "Good confidence",
};

export function BidEstimate({ lotId }: { lotId: string }) {
  const [range, setRange] = useState<Range | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch(`${API}/lots/${lotId}/estimate`, { cache: "no-store" });
        if (r.ok) {
          const d = (await r.json()) as { range: Range | null; reason?: string };
          setRange(d.range);
          setReason(d.reason ?? null);
        }
      } catch {
        // A missing estimate is not an error worth showing — the panel just
        // doesn't render.
      } finally {
        setLoaded(true);
      }
    })();
  }, [lotId]);

  if (!loaded || (!range && !reason)) return null;

  return (
    <div className="card-form" style={{ marginTop: 22 }}>
      <h2 className="block-title" style={{ marginTop: 0 }}>Estimated Range</h2>

      {range ? (
        <>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <span className="tabular" style={{ fontFamily: "var(--font-display)", fontSize: 28 }}>
              {formatCents(String(range.lowCentsPerCwt))} – {formatCents(String(range.highCentsPerCwt))}
            </span>
            <span className="dim" style={{ fontSize: 13 }}>/cwt</span>
            <span className="pill" style={{ marginLeft: 6 }}>{CONFIDENCE_COPY[range.confidence]}</span>
          </div>
          <p className="muted" style={{ fontSize: 13.5, margin: "8px 0 0" }}>
            Midpoint {formatCents(String(range.midCentsPerCwt))}/cwt. {range.basis}
          </p>
        </>
      ) : (
        <p className="muted" style={{ fontSize: 13.5, margin: 0 }}>{reason}</p>
      )}

      <p className="dim" style={{ fontSize: 12, margin: "10px 0 0" }}>
        An estimate from comparable sales, not a valuation or an appraisal. Cattle sell on
        things a model can&rsquo;t see &mdash; flesh, fill, how they load.
      </p>
    </div>
  );
}
