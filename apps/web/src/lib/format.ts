// Display-only. Money stays integer cents on the wire (as strings); we only ever
// format for the eye, never compute here.
export function formatCents(cents: string | number | bigint): string {
  const v = BigInt(cents);
  const neg = v < 0n;
  const a = neg ? -v : v;
  const dollars = (a / 100n).toLocaleString();
  const rem = (a % 100n).toString().padStart(2, "0");
  return `${neg ? "-" : ""}$${dollars}.${rem}`;
}

export function priceUnitLabel(unit: string): string {
  switch (unit) {
    case "CWT": return "/cwt";
    case "HEAD": return "/head";
    case "DOSE": return "/dose";
    case "EMBRYO": return "/embryo";
    default: return "";
  }
}
