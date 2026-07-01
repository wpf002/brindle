// A lot's EPDs rendered as a genetics report: labeled rows, a desirability track
// (higher = better whatever the trait), and the breed percentile. The comparison
// math lives in @brindle/genetics; this is presentation.
import { ANGUS_TRAITS, type EpdSet } from "@brindle/genetics";

function barFromPercentile(p: number): number {
  return Math.min(100, Math.max(4, 100 - p));
}

export function EpdTable({ epd }: { epd: EpdSet }) {
  const rows = ANGUS_TRAITS.filter((t) => epd[t.key]);
  if (rows.length === 0) return <p className="dim">No EPD data published for this lot.</p>;

  return (
    <div className="epd">
      {rows.map((t) => {
        const cell = epd[t.key]!;
        const bar = cell.percentile != null ? barFromPercentile(cell.percentile) : 50;
        const top = cell.percentile != null && cell.percentile <= 10;
        return (
          <div className="epd-row" key={t.key}>
            <div className="t">{t.key}<small>{t.label}</small></div>
            <div className="v">{cell.value}</div>
            <div className="epd-track"><div className="epd-fill" style={{ width: `${bar}%` }} /></div>
            <div className="epd-pct">
              {cell.percentile != null ? <span className={top ? "top" : ""}>{cell.percentile}%</span> : <span className="dim">—</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
