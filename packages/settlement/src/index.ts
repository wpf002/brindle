export { computeFees, type FeeBreakdown } from "./fees.js";
export {
  FakePaymentGateway,
  type PaymentGateway,
  type PaymentState,
  type HoldParams,
} from "./gateway.js";
export {
  IntegratedPaymentService,
  type HammerInput,
  type PaymentRecord,
} from "./integratedPayment.js";
export { StripePaymentGateway } from "./stripeGateway.js";
export {
  estimateContract,
  settleContractAtDelivery,
  type ForwardContractTerms,
  type ContractSettlement,
} from "./contract.js";
export {
  disputeTransition,
  isTerminal,
  type DisputeStatus,
  type DisputeAction,
  type DisputeClaim,
  type DisputeTransition,
} from "./dispute.js";

import type { FeeBreakdown } from "./fees.js";

// Adapters live behind this interface; INTEGRATED_PAYMENT is implemented
// (integratedPayment.ts); CONTRACT lands in Phase 2.
export interface SettlementAdapter {
  mode: "CONTRACT" | "INTEGRATED_PAYMENT";
  settle(input: { lotId: string; fees: FeeBreakdown }): Promise<{ ref: string }>;
}
