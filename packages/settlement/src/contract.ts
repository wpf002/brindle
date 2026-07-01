import { type Cents, totalFromCwt, applyBps } from "@brindle/core";

// CONTRACT settlement for load lots / breeding stock. At hammer we generate a
// Livestock Forward Contract; the buyer pays the seller on delivery and Brindle
// invoices only its tech fee — no proceeds ever touch Brindle (keeps us clear of
// Packers & Stockyards market-agency custody).
//
// Cattle contracts price on a base weight with a slide and a pencil shrink:
//   pay weight  = scale weight * (1 - shrink%)          — deduct pencil shrink
//   slide       = price/cwt drops `slideCentsPerLb` for each lb the average pay
//                 weight runs OVER the contracted base weight (down slide only)
// Final value settles against the actual delivered weight, not the estimate.

export interface ForwardContractTerms {
  basePriceCentsPerCwt: Cents; // hammer price
  baseWeightLbs: number; // contracted average weight per head
  slideCentsPerLb: number; // cents/cwt reduction per lb over base
  shrinkPct: number; // pencil shrink, e.g. 2.0
  head: number;
  buyerPremiumBps: number;
  techFeeCents: Cents; // Brindle's flat tech fee, invoiced separately
  deliveryWindow: { start: string; end: string };
}

export interface ContractSettlement {
  payWeightPerHeadLbs: number;
  adjustedPriceCentsPerCwt: Cents;
  subtotalCents: Cents; // seller proceeds before buyer premium
  buyerPremiumCents: Cents;
  buyerPayableCents: Cents; // what the buyer pays the seller on delivery
  platformTechFeeCents: Cents; // Brindle invoices this to... whoever the deal assigns
}

/** Estimated contract value at the base weight (shown at hammer / e-sign). */
export function estimateContract(terms: ForwardContractTerms): ContractSettlement {
  return settleContractAtDelivery(terms, terms.baseWeightLbs);
}

/** Final settlement once the cattle are weighed at delivery. */
export function settleContractAtDelivery(
  terms: ForwardContractTerms,
  actualScaleAvgLbs: number,
): ContractSettlement {
  const payWeightPerHeadLbs = actualScaleAvgLbs * (1 - terms.shrinkPct / 100);
  const deviationLbs = Math.max(0, payWeightPerHeadLbs - terms.baseWeightLbs);
  const reductionCentsPerCwt = BigInt(Math.round(terms.slideCentsPerLb * deviationLbs));

  let adjustedPriceCentsPerCwt = terms.basePriceCentsPerCwt - reductionCentsPerCwt;
  if (adjustedPriceCentsPerCwt < 0n) adjustedPriceCentsPerCwt = 0n;

  const subtotalCents = totalFromCwt(adjustedPriceCentsPerCwt, payWeightPerHeadLbs, terms.head);
  const buyerPremiumCents = applyBps(subtotalCents, terms.buyerPremiumBps);

  return {
    payWeightPerHeadLbs,
    adjustedPriceCentsPerCwt,
    subtotalCents,
    buyerPremiumCents,
    buyerPayableCents: subtotalCents + buyerPremiumCents,
    platformTechFeeCents: terms.techFeeCents,
  };
}
