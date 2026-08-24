import Stripe from "stripe";
import { useDevFallback, paymentsEnabled } from "./env.js";

let cached: Stripe | null | undefined;

/**
 * The shared Stripe client, or null when there isn't one.
 *
 * Null means one of two different things, and callers must not confuse them:
 * payments are switched off for this deployment (`PAYMENTS_ENABLED=false`), or
 * we're on a dev box with no key. Check {@link paymentsEnabled} to tell them
 * apart — a payment route should refuse outright in the first case.
 */
export function makeStripeClient(): Stripe | null {
  if (cached !== undefined) return cached;

  // Deliberately off. Not a missing key, so nothing to warn about.
  if (!paymentsEnabled()) {
    cached = null;
    return cached;
  }

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    // A fake gateway "settles" money that never moves — never outside local
    // dev. Set PAYMENTS_ENABLED=false to run without payments on purpose.
    useDevFallback("payments", ["STRIPE_SECRET_KEY"]);
    cached = null;
    return cached;
  }
  cached = new Stripe(key);
  return cached;
}
