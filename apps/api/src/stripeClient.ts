import Stripe from "stripe";
import { useDevFallback } from "./env.js";

let cached: Stripe | null | undefined;

/** The shared Stripe client, or null if no key is configured (local dev). */
export function makeStripeClient(): Stripe | null {
  if (cached !== undefined) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    // A fake gateway "settles" money that never moves — never outside local dev.
    useDevFallback("payments", ["STRIPE_SECRET_KEY"]);
    cached = null;
    return cached;
  }
  cached = new Stripe(key);
  return cached;
}
