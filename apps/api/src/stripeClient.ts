import Stripe from "stripe";

let cached: Stripe | null | undefined;

/** The shared Stripe client, or null if no key is configured (local dev). */
export function makeStripeClient(): Stripe | null {
  if (cached !== undefined) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("STRIPE_SECRET_KEY is required in production");
    }
    cached = null;
    return cached;
  }
  cached = new Stripe(key);
  return cached;
}
