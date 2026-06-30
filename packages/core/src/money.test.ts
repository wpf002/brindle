import { describe, it, expect } from "vitest";
import { divRound, applyBps, formatCents } from "./money.js";

describe("divRound — round half up, integer bigint division", () => {
  it("rounds a half up", () => {
    expect(divRound(6n, 4n)).toBe(2n); // 1.5 -> 2
    expect(divRound(10n, 4n)).toBe(3n); // 2.5 -> 3
  });

  it("rounds below half down", () => {
    expect(divRound(9n, 4n)).toBe(2n); // 2.25 -> 2
  });

  it("rounds above half up", () => {
    expect(divRound(11n, 4n)).toBe(3n); // 2.75 -> 3
  });

  it("is exact when evenly divisible", () => {
    expect(divRound(8n, 4n)).toBe(2n);
    expect(divRound(0n, 4n)).toBe(0n);
  });
});

describe("applyBps — basis-point fees in integer cents", () => {
  it("computes a clean percentage", () => {
    expect(applyBps(10_000n, 250)).toBe(250n); // 2.5% of $100.00
  });

  it("rounds the fractional cent half up", () => {
    expect(applyBps(100n, 250)).toBe(3n); // 2.5% of $1.00 = 2.5c -> 3c
  });

  it("returns zero for a zero rate", () => {
    expect(applyBps(99_999n, 0)).toBe(0n);
  });
});

describe("formatCents — display only, never used for math", () => {
  it("formats whole and fractional cents", () => {
    expect(formatCents(99_999n)).toBe("$999.99");
    expect(formatCents(50n)).toBe("$0.50");
    expect(formatCents(0n)).toBe("$0.00");
  });

  it("pads single-digit cents", () => {
    expect(formatCents(105n)).toBe("$1.05");
  });

  it("handles negatives (refunds)", () => {
    expect(formatCents(-12_345n)).toBe("-$123.45");
  });
});
