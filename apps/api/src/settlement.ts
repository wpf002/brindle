import {
  IntegratedPaymentService,
  StripePaymentGateway,
  FakePaymentGateway,
  type PaymentGateway,
} from "@brindle/settlement";
import { makeStripeClient } from "./stripeClient.js";
import { paymentsEnabled } from "./env.js";

// Build the INTEGRATED_PAYMENT service. Real Stripe when a key is present; an
// in-memory fake in local dev. Production MUST have a real key — a silent fake
// gateway in prod would "settle" money that never moves.
export function makePaymentService(): IntegratedPaymentService {
  // Reaching here with payments off is a bug in the caller, not a runtime
  // condition — routes are expected to refuse before they get this far.
  if (!paymentsEnabled()) {
    throw new Error("makePaymentService() called while PAYMENTS_ENABLED=false");
  }
  const stripe = makeStripeClient();
  const gateway: PaymentGateway = stripe ? new StripePaymentGateway(stripe) : new FakePaymentGateway();
  return new IntegratedPaymentService(gateway);
}

// Zero by default: Brindle licenses software to the sale barn (Model A) rather
// than taking a slice of cattle proceeds. A platform that skims livestock sale
// proceeds starts to look like a market agency under the Packers and Stockyards
// Act — bonding, custodial trust account, next-business-day payout. Only ever
// non-zero for INTEGRATED_PAYMENT genetics lots, where Brindle is the
// facilitator of record.
export const PLATFORM_FEE_BPS = Number(process.env.PLATFORM_FEE_BPS ?? 0);
