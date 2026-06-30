import { type Cents, applyBps } from "@brindle/core";

// Settlement mode is chosen by lot type, not by checkout flow.
//  - CONTRACT: load lots / breeding stock. Generates a forward contract,
//    payment settles buyer->seller on delivery. Brindle charges a tech fee
//    and never custodies cattle proceeds (keeps us out of P&S market-agency status).
//  - INTEGRATED_PAYMENT: genetics / small lots. Stripe Connect facilitator flow.

export interface FeeBreakdown {
  hammerCents: Cents;
  buyerPremiumCents: Cents;
  platformFeeCents: Cents;
  buyerTotalCents: Cents;
}

export function computeFees(
  hammerCents: Cents,
  buyerPremiumBps: number,
  platformFeeBps: number,
): FeeBreakdown {
  const buyerPremiumCents = applyBps(hammerCents, buyerPremiumBps);
  const platformFeeCents = applyBps(hammerCents, platformFeeBps);
  return {
    hammerCents,
    buyerPremiumCents,
    platformFeeCents,
    buyerTotalCents: hammerCents + buyerPremiumCents,
  };
}

// Adapters live behind these interfaces; implement in Phase 1 (stripe) / Phase 2 (contract).
export interface SettlementAdapter {
  mode: "CONTRACT" | "INTEGRATED_PAYMENT";
  settle(input: { lotId: string; fees: FeeBreakdown }): Promise<{ ref: string }>;
}
