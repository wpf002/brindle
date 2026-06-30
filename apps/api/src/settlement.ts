import Stripe from "stripe";
import {
  IntegratedPaymentService,
  StripePaymentGateway,
  FakePaymentGateway,
  type PaymentGateway,
} from "@brindle/settlement";

// Build the INTEGRATED_PAYMENT service. Real Stripe when a key is present; an
// in-memory fake in local dev. Production MUST have a real key — a silent fake
// gateway in prod would "settle" money that never moves.
export function makePaymentService(): IntegratedPaymentService {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("STRIPE_SECRET_KEY is required in production");
    }
    return new IntegratedPaymentService(new FakePaymentGateway());
  }
  const gateway: PaymentGateway = new StripePaymentGateway(new Stripe(key));
  return new IntegratedPaymentService(gateway);
}

export const PLATFORM_FEE_BPS = Number(process.env.PLATFORM_FEE_BPS ?? 800); // 8% default
