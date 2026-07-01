// Renders a lot's EPDs as labeled percentile bars — the buyer-facing genetics
// panel. Pure display; the comparison math is done by @brindle/genetics via the
// API. Bars are already 0–100 desirability (higher = better) whatever the trait.
import { ANGUS_TRAITS, type EpdSet } from "@brindle/genetics";

function barFromPercentile(p: number): number {
  return Math.min(100, Math.max(0, 100 - p));
}

export function EpdTable({ epd }: { epd: EpdSet }) {
  const rows = ANGUS_TRAITS.filter((t) => epd[t.key]);
  if (rows.length === 0) return <p className="muted">No EPD data published for this lot.</p>;

  return (
    <table className="epd">
      <tbody>
        {rows.map((t) => {
          const cell = epd[t.key]!;
          const bar = cell.percentile != null ? barFromPercentile(cell.percentile) : 50;
          return (
            <tr key={t.key}>
              <th title={t.label}>{t.key}</th>
              <td className="val">{cell.value}</td>
              <td className="barcell">
                <span className="bar" style={{ width: `${bar}%` }} />
              </td>
              <td className="pct">{cell.percentile != null ? `${cell.percentile}%` : "—"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
