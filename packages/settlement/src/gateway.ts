import type { Cents } from "@brindle/core";

// The payment gateway port. The settlement service drives this; a real Stripe
// implementation and an in-memory fake both satisfy it, so the money state
// machine is unit-testable without touching Stripe. Amounts are integer cents.

export type PaymentState = "HELD" | "CAPTURED" | "CANCELLED" | "REFUNDED";

export interface HoldParams {
  /** Total authorized on the buyer's card (hammer + buyer premium). */
  buyerTotalCents: Cents;
  /** Brindle's application fee, deducted from the destination transfer. */
  platformFeeCents: Cents;
  /** Seller's Stripe Connect account — the destination of the charge. */
  sellerAccountId: string;
  buyerCustomerId?: string;
  currency?: string; // default "usd"
  metadata?: Record<string, string>;
  /** Required: makes the authorize call safe to retry. */
  idempotencyKey: string;
}

export interface PaymentGateway {
  /** Place a manual-capture authorization (a hold), not yet a charge. */
  authorizeHold(params: HoldParams): Promise<{ gatewayRef: string; status: "HELD" }>;
  /** Capture a prior hold once the seller confirms the lot. */
  capture(gatewayRef: string, idempotencyKey: string): Promise<{ status: "CAPTURED" }>;
  /** Release an uncaptured hold (lot voided before confirmation). */
  cancel(gatewayRef: string, idempotencyKey: string): Promise<{ status: "CANCELLED" }>;
  /** Refund a captured charge, in full (null) or in part. */
  refund(
    gatewayRef: string,
    amountCents: Cents | null,
    idempotencyKey: string,
  ): Promise<{ status: "REFUNDED" }>;
}

interface FakeRecord {
  state: PaymentState;
  buyerTotalCents: Cents;
  platformFeeCents: Cents;
  sellerAccountId: string;
  refundedCents: Cents;
}

/**
 * Deterministic in-memory gateway for tests. Enforces the legal transitions
 * (can't capture a cancelled hold, can't refund before capture) so the service's
 * state machine is exercised honestly.
 */
export class FakePaymentGateway implements PaymentGateway {
  readonly records = new Map<string, FakeRecord>();
  readonly calls: Array<{ op: string; ref: string; idempotencyKey: string }> = [];
  private seq = 0;

  async authorizeHold(params: HoldParams) {
    // Idempotency: same key returns the same ref instead of a duplicate hold.
    for (const [ref, rec] of this.records) {
      if (this.keyFor(ref) === params.idempotencyKey && rec.state === "HELD") {
        return { gatewayRef: ref, status: "HELD" as const };
      }
    }
    const gatewayRef = `pi_fake_${++this.seq}`;
    this.keys.set(gatewayRef, params.idempotencyKey);
    this.records.set(gatewayRef, {
      state: "HELD",
      buyerTotalCents: params.buyerTotalCents,
      platformFeeCents: params.platformFeeCents,
      sellerAccountId: params.sellerAccountId,
      refundedCents: 0n,
    });
    this.calls.push({ op: "authorizeHold", ref: gatewayRef, idempotencyKey: params.idempotencyKey });
    return { gatewayRef, status: "HELD" as const };
  }

  async capture(gatewayRef: string, idempotencyKey: string) {
    const rec = this.require(gatewayRef);
    if (rec.state === "CAPTURED") return { status: "CAPTURED" as const }; // idempotent
    if (rec.state !== "HELD") throw new Error(`cannot capture a ${rec.state} payment`);
    rec.state = "CAPTURED";
    this.calls.push({ op: "capture", ref: gatewayRef, idempotencyKey });
    return { status: "CAPTURED" as const };
  }

  async cancel(gatewayRef: string, idempotencyKey: string) {
    const rec = this.require(gatewayRef);
    if (rec.state === "CANCELLED") return { status: "CANCELLED" as const };
    if (rec.state !== "HELD") throw new Error(`cannot cancel a ${rec.state} payment`);
    rec.state = "CANCELLED";
    this.calls.push({ op: "cancel", ref: gatewayRef, idempotencyKey });
    return { status: "CANCELLED" as const };
  }

  async refund(gatewayRef: string, amountCents: Cents | null, idempotencyKey: string) {
    const rec = this.require(gatewayRef);
    if (rec.state !== "CAPTURED" && rec.state !== "REFUNDED") {
      throw new Error(`cannot refund a ${rec.state} payment`);
    }
    const amount = amountCents ?? rec.buyerTotalCents - rec.refundedCents;
    if (amount > rec.buyerTotalCents - rec.refundedCents) {
      throw new Error("refund exceeds captured amount");
    }
    rec.refundedCents += amount;
    rec.state = "REFUNDED";
    this.calls.push({ op: "refund", ref: gatewayRef, idempotencyKey });
    return { status: "REFUNDED" as const };
  }

  private require(ref: string): FakeRecord {
    const rec = this.records.get(ref);
    if (!rec) throw new Error(`unknown payment ${ref}`);
    return rec;
  }

  private readonly keys = new Map<string, string>();
  private keyFor(ref: string): string | undefined {
    return this.keys.get(ref);
  }
}
