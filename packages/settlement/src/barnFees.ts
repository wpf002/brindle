import { type Cents, applyBps, divRound } from "@brindle/core";

// The sale barn's fee stack, as it actually works on sale day.
//
// This is the Model A shape: the barn is the market agency, it charges the
// seller commission and yardage out of the proceeds, and Brindle is software
// the barn licenses — Brindle takes no cut of cattle money and never touches
// the proceeds. That separation is not a business preference; a platform that
// takes a slice of livestock sale proceeds starts to look like a market agency
// under the Packers and Stockyards Act, which brings bonding, a custodial trust
// account, and next-business-day payout obligations with it.
//
// Everything here is per head or basis points on the hammer, integer cents
// throughout. Real-world ranges the defaults are drawn from: commission roughly
// $10–20/head flat (or a percentage, regionally), yardage $0.50–2.50/head,
// brand inspection $0.55–1.00/head where the state requires it.

/** The federal Beef Promotion and Research Act assessment: $1.00 per head. */
export const BEEF_CHECKOFF_CENTS_PER_HEAD = 100n;

export interface BarnFeeSchedule {
  /** Flat commission per head, in cents. Mutually exclusive with the bps rate. */
  commissionCentsPerHead?: Cents;
  /** Commission as basis points of the hammer price, where a barn charges a %. */
  commissionBps?: number;
  /** Penning, feeding, and handling, per head. */
  yardageCentsPerHead?: Cents;
  /** State brand-inspection fee, passed straight through. Brand states only. */
  brandInspectionCentsPerHead?: Cents;
  /** Buyer's premium on top of the hammer, in basis points. */
  buyerPremiumBps?: number;
  /**
   * Whether the mandatory $1/head checkoff applies. True for cattle and calves;
   * false for genetics lots (semen, embryos), which are not head of cattle.
   */
  checkoffApplies?: boolean;
}

export interface BarnSettlement {
  hammerCents: Cents;
  headCount: number;

  /** What the buyer owes: hammer plus any buyer's premium. */
  buyerPremiumCents: Cents;
  buyerTotalCents: Cents;

  /** Deducted from the seller's proceeds. */
  commissionCents: Cents;
  yardageCents: Cents;
  brandInspectionCents: Cents;
  checkoffCents: Cents;
  sellerDeductionsCents: Cents;

  /** What the barn owes the seller, due by the next business day. */
  sellerNetCents: Cents;
}

function perHead(rate: Cents | undefined, headCount: number): Cents {
  if (!rate || headCount <= 0) return 0n;
  return rate * BigInt(headCount);
}

/**
 * Split a hammer price into what the buyer pays and what the seller nets.
 *
 * Note which side each fee lands on. The buyer's premium is charged *on top* of
 * the hammer, so it never reduces what the seller was told they'd get.
 * Commission, yardage, inspection, and checkoff come *out of* the seller's
 * proceeds, which is why a seller's net is always below the hammer.
 */
export function computeBarnSettlement(
  hammerCents: Cents,
  headCount: number,
  schedule: BarnFeeSchedule,
): BarnSettlement {
  const buyerPremiumCents = applyBps(hammerCents, schedule.buyerPremiumBps ?? 0);

  // A barn charges one or the other, not both. Flat per-head wins if set, since
  // that's the more common posted structure.
  const commissionCents =
    schedule.commissionCentsPerHead != null
      ? perHead(schedule.commissionCentsPerHead, headCount)
      : applyBps(hammerCents, schedule.commissionBps ?? 0);

  const yardageCents = perHead(schedule.yardageCentsPerHead, headCount);
  const brandInspectionCents = perHead(schedule.brandInspectionCentsPerHead, headCount);
  const checkoffCents = schedule.checkoffApplies
    ? perHead(BEEF_CHECKOFF_CENTS_PER_HEAD, headCount)
    : 0n;

  const sellerDeductionsCents =
    commissionCents + yardageCents + brandInspectionCents + checkoffCents;

  return {
    hammerCents,
    headCount,
    buyerPremiumCents,
    buyerTotalCents: hammerCents + buyerPremiumCents,
    commissionCents,
    yardageCents,
    brandInspectionCents,
    checkoffCents,
    sellerDeductionsCents,
    // Deductions can exceed a very small hammer price on a thin lot; the seller
    // owing the barn is a real outcome, so this is allowed to go negative
    // rather than being clamped to zero and quietly losing the difference.
    sellerNetCents: hammerCents - sellerDeductionsCents,
  };
}

/**
 * Price per hundredweight from a lot total, for display against USDA
 * comparables — those are always quoted per cwt.
 */
export function centsPerCwt(totalCents: Cents, totalWeightLbs: number): Cents | null {
  if (totalWeightLbs <= 0) return null;
  return divRound(totalCents * 100n, BigInt(Math.round(totalWeightLbs)));
}
