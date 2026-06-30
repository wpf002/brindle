import type Stripe from "stripe";
import type { Cents } from "@brindle/core";
import type { HoldParams, PaymentGateway } from "./gateway.js";

// Stripe Connect implementation of the payment gateway. Destination charge with a
// manual capture (the hold) and Brindle's platform fee as the application fee, so
// proceeds land in the seller's connected account and never in Brindle's balance.

function toAmount(cents: Cents): number {
  // Stripe amounts are integer JS numbers. Convert at the boundary only, and
  // refuse anything that wouldn't survive the round-trip exactly.
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("amount exceeds Stripe's safe integer range");
  }
  return Number(cents);
}

export class StripePaymentGateway implements PaymentGateway {
  constructor(private readonly stripe: Stripe) {}

  async authorizeHold(p: HoldParams): Promise<{ gatewayRef: string; status: "HELD" }> {
    const pi = await this.stripe.paymentIntents.create(
      {
        amount: toAmount(p.buyerTotalCents),
        currency: p.currency ?? "usd",
        capture_method: "manual",
        application_fee_amount: toAmount(p.platformFeeCents),
        transfer_data: { destination: p.sellerAccountId },
        ...(p.buyerCustomerId ? { customer: p.buyerCustomerId } : {}),
        ...(p.metadata ? { metadata: p.metadata } : {}),
      },
      { idempotencyKey: p.idempotencyKey },
    );
    return { gatewayRef: pi.id, status: "HELD" };
  }

  async capture(gatewayRef: string, idempotencyKey: string): Promise<{ status: "CAPTURED" }> {
    await this.stripe.paymentIntents.capture(gatewayRef, undefined, { idempotencyKey });
    return { status: "CAPTURED" };
  }

  async cancel(gatewayRef: string, idempotencyKey: string): Promise<{ status: "CANCELLED" }> {
    await this.stripe.paymentIntents.cancel(gatewayRef, undefined, { idempotencyKey });
    return { status: "CANCELLED" };
  }

  async refund(
    gatewayRef: string,
    amountCents: Cents | null,
    idempotencyKey: string,
  ): Promise<{ status: "REFUNDED" }> {
    await this.stripe.refunds.create(
      {
        payment_intent: gatewayRef,
        ...(amountCents !== null ? { amount: toAmount(amountCents) } : {}),
      },
      { idempotencyKey },
    );
    return { status: "REFUNDED" };
  }
}
