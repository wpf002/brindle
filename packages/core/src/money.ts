// Money is ALWAYS integer cents (bigint). No floats ever touch money.
// This is a locked invariant, ported from Crossbar.
export type Cents = bigint;

/** Round-half-up integer division for bigints (a / b). */
export function divRound(a: bigint, b: bigint): bigint {
  const q = a / b;
  const r = a % b;
  // round half away from zero
  return r * 2n >= b ? q + 1n : q;
}

export function applyBps(amount: Cents, bps: number): Cents {
  return divRound(amount * BigInt(bps), 10_000n);
}

export function formatCents(c: Cents): string {
  const neg = c < 0n;
  const v = neg ? -c : c;
  const dollars = v / 100n;
  const cents = (v % 100n).toString().padStart(2, "0");
  return `${neg ? "-" : ""}$${dollars.toLocaleString()}.${cents}`;
}
