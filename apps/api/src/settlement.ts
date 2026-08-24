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

export const PLATFORM_FEE_BPS = Number(process.env.PLATFORM_FEE_BPS ?? 800); // 8% default
