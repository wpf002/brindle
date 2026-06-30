import type { Cents } from "@brindle/core";
import { computeFees, type FeeBreakdown } from "./fees.js";
import type { PaymentGateway, PaymentState } from "./gateway.js";

// The INTEGRATED_PAYMENT money state machine for genetics / small lots. Flow:
//   hammer -> authorize hold -> (seller confirms) capture -> payout to seller
//                            \-> (voided) cancel
//   captured -> refund (full/partial) on dispute resolution
//
// Brindle is the marketplace facilitator here: the charge is a destination charge
// to the seller's connected account with Brindle's platform fee as the application
// fee. We never hold proceeds in our own balance.

export interface HammerInput {
  lotId: string;
  buyerId: string;
  sellerId: string;
  sellerAccountId: string;
  hammerCents: Cents;
  buyerPremiumBps: number;
  platformFeeBps: number;
  buyerCustomerId?: string;
}

export interface PaymentRecord {
  lotId: string;
  buyerId: string;
  sellerId: string;
  amountCents: Cents; // buyer total held/charged
  platformFeeCents: Cents;
  gatewayRef: string;
  status: PaymentState;
  fees: FeeBreakdown;
}

export class IntegratedPaymentService {
  constructor(private readonly gateway: PaymentGateway) {}

  /** Place the authorization hold the moment the hammer falls. */
  async holdAtHammer(input: HammerInput): Promise<PaymentRecord> {
    const fees = computeFees(input.hammerCents, input.buyerPremiumBps, input.platformFeeBps);
    const { gatewayRef, status } = await this.gateway.authorizeHold({
      buyerTotalCents: fees.buyerTotalCents,
      platformFeeCents: fees.platformFeeCents,
      sellerAccountId: input.sellerAccountId,
      buyerCustomerId: input.buyerCustomerId,
      idempotencyKey: `hold:${input.lotId}`,
      metadata: { lotId: input.lotId, buyerId: input.buyerId },
    });
    return {
      lotId: input.lotId,
      buyerId: input.buyerId,
      sellerId: input.sellerId,
      amountCents: fees.buyerTotalCents,
      platformFeeCents: fees.platformFeeCents,
      gatewayRef,
      status,
      fees,
    };
  }

  /** Capture once the seller confirms the lot ships. */
  async captureOnConfirm(lotId: string, gatewayRef: string): Promise<PaymentState> {
    const { status } = await this.gateway.capture(gatewayRef, `capture:${lotId}`);
    return status;
  }

  /** Release a hold for a lot that never settled. */
  async voidHold(lotId: string, gatewayRef: string): Promise<PaymentState> {
    const { status } = await this.gateway.cancel(gatewayRef, `cancel:${lotId}`);
    return status;
  }

  /** Refund after capture (dispute resolution). Null amount = full refund. */
  async refund(lotId: string, gatewayRef: string, amountCents: Cents | null): Promise<PaymentState> {
    const { status } = await this.gateway.refund(gatewayRef, amountCents, `refund:${lotId}`);
    return status;
  }
}
