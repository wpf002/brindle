export * from "./fees.js";
export * from "./gateway.js";
export * from "./integratedPayment.js";
export * from "./stripeGateway.js";

import type { FeeBreakdown } from "./fees.js";

// Adapters live behind this interface; INTEGRATED_PAYMENT is implemented
// (integratedPayment.ts); CONTRACT lands in Phase 2.
export interface SettlementAdapter {
  mode: "CONTRACT" | "INTEGRATED_PAYMENT";
  settle(input: { lotId: string; fees: FeeBreakdown }): Promise<{ ref: string }>;
}
