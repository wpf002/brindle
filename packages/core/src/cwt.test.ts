import { describe, it, expect } from "vitest";
import {
  lbsToCentilbs,
  totalFromCwt,
  totalFromHead,
  totalFromDose,
} from "./cwt.js";

describe("lbsToCentilbs — exact weight as hundredths of a pound", () => {
  it("converts to integer centilbs", () => {
    expect(lbsToCentilbs(600)).toBe(60_000n);
    expect(lbsToCentilbs(123.45)).toBe(12_345n);
  });

  it("rounds at the centilb boundary", () => {
    expect(lbsToCentilbs(0.005)).toBe(1n); // half rounds away from zero via Math.round
  });
});

describe("totalFromCwt — per-hundredweight lots", () => {
  it("computes a representative load-lot total", () => {
    // $150.00/cwt, 600 lb avg, 10 head -> 6 cwt/head * $150 * 10 = $9,000.00
    expect(totalFromCwt(15_000n, 600, 10)).toBe(900_000n);
  });

  it("stays exact on fractional-weight inputs", () => {
    // $1.00/cwt, 50.5 lb, 1 head -> 0.505 cwt * 100c = 50.5c -> 51c (half up)
    expect(totalFromCwt(100n, 50.5, 1)).toBe(51n);
  });

  it("is zero for zero head", () => {
    expect(totalFromCwt(15_000n, 600, 0)).toBe(0n);
  });
});

describe("totalFromHead — per-head lots", () => {
  it("multiplies cents per head by head count", () => {
    expect(totalFromHead(250_000n, 5)).toBe(1_250_000n);
  });
});

describe("totalFromDose — per-dose genetics lots", () => {
  it("multiplies cents per dose by dose count", () => {
    expect(totalFromDose(5_000n, 20)).toBe(100_000n);
  });
});
