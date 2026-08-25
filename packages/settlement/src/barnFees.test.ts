import { describe, it, expect } from "vitest";
import {
  computeBarnSettlement, centsPerCwt, BEEF_CHECKOFF_CENTS_PER_HEAD,
} from "./barnFees.js";

// "300 head of 550-600 lb black steers" at $2.24/cwt — the shape of lot the
// memo describes as the volume of the business.
const LOAD_LOT = { head: 300, hammer: 37_800_00n }; // 300 hd x 575 lb x $2.19/cwt

describe("computeBarnSettlement", () => {
  it("charges the buyer's premium on top, so the seller's hammer is untouched by it", () => {
    const s = computeBarnSettlement(100_000n, 10, { buyerPremiumBps: 400 });
    expect(s.buyerPremiumCents).toBe(4_000n);
    expect(s.buyerTotalCents).toBe(104_000n);
    // Premium is the buyer's cost, never a seller deduction.
    expect(s.sellerDeductionsCents).toBe(0n);
    expect(s.sellerNetCents).toBe(100_000n);
  });

  it("takes commission, yardage, inspection and checkoff out of the seller's side", () => {
    const s = computeBarnSettlement(LOAD_LOT.hammer, LOAD_LOT.head, {
      commissionCentsPerHead: 1_500n,      // $15.00/head
      yardageCentsPerHead: 150n,           // $1.50/head
      brandInspectionCentsPerHead: 75n,    // $0.75/head
      checkoffApplies: true,               // $1.00/head
    });
    expect(s.commissionCents).toBe(450_000n);        // 300 x $15
    expect(s.yardageCents).toBe(45_000n);            // 300 x $1.50
    expect(s.brandInspectionCents).toBe(22_500n);    // 300 x $0.75
    expect(s.checkoffCents).toBe(30_000n);           // 300 x $1
    expect(s.sellerDeductionsCents).toBe(547_500n);
    expect(s.sellerNetCents).toBe(LOAD_LOT.hammer - 547_500n);
    // $18.25/head all-in, inside the $12-25 range barns actually post.
    expect(s.sellerDeductionsCents / BigInt(LOAD_LOT.head)).toBe(1_825n);
  });

  it("supports a percentage commission where a barn charges one", () => {
    const s = computeBarnSettlement(100_000n, 10, { commissionBps: 300 });
    expect(s.commissionCents).toBe(3_000n);
  });

  it("prefers the flat per-head rate when a barn has both configured", () => {
    const s = computeBarnSettlement(100_000n, 10, {
      commissionCentsPerHead: 1_500n,
      commissionBps: 300,
    });
    expect(s.commissionCents).toBe(15_000n); // per-head, not the 3%
  });

  it("applies the mandatory checkoff at exactly $1.00 per head", () => {
    expect(BEEF_CHECKOFF_CENTS_PER_HEAD).toBe(100n);
    const s = computeBarnSettlement(100_000n, 42, { checkoffApplies: true });
    expect(s.checkoffCents).toBe(4_200n);
  });

  // Semen and embryos are not head of cattle; the Beef Promotion and Research
  // Act assessment does not reach them.
  it("does not charge checkoff on genetics lots", () => {
    const s = computeBarnSettlement(100_000n, 40, { checkoffApplies: false });
    expect(s.checkoffCents).toBe(0n);
  });

  it("charges no per-head fee when a lot has no head count", () => {
    const s = computeBarnSettlement(100_000n, 0, {
      commissionCentsPerHead: 1_500n, yardageCentsPerHead: 150n, checkoffApplies: true,
    });
    expect(s.sellerDeductionsCents).toBe(0n);
  });

  // A thin lot really can settle with the seller owing the barn. Clamping to
  // zero would quietly hide the difference from both sides.
  it("lets a seller's net go negative rather than silently absorbing the shortfall", () => {
    const s = computeBarnSettlement(1_000n, 10, { commissionCentsPerHead: 1_500n });
    expect(s.sellerNetCents).toBe(-14_000n);
  });

  it("keeps every figure in integer cents", () => {
    const s = computeBarnSettlement(33_333n, 7, {
      commissionBps: 275, yardageCentsPerHead: 150n, checkoffApplies: true,
    });
    for (const v of Object.values(s)) {
      if (typeof v === "bigint") expect(Number.isInteger(Number(v))).toBe(true);
    }
    expect(s.commissionCents).toBe(917n); // 33_333 * 275 / 10_000, half-up
  });
});

describe("centsPerCwt", () => {
  it("converts a lot total to the per-hundredweight quote USDA uses", () => {
    // 300 head x 575 lb = 172,500 lb; $37,800 / 1,725 cwt = $21.91/cwt
    expect(centsPerCwt(37_800_00n, 172_500)).toBe(2_191n);
  });

  it("returns null rather than dividing by zero on an unweighed lot", () => {
    expect(centsPerCwt(100_000n, 0)).toBeNull();
  });
});
