import { describe, it, expect } from "vitest";
import { IntegratedPaymentService } from "./integratedPayment.js";
import { FakePaymentGateway } from "./gateway.js";
import { computeFees } from "./fees.js";

function setup() {
  const gateway = new FakePaymentGateway();
  const service = new IntegratedPaymentService(gateway);
  return { gateway, service };
}

const HAMMER = 500_00n; // $500.00 for a semen lot
const input = {
  lotId: "lot-1",
  buyerId: "buyer-1",
  sellerId: "seller-1",
  sellerAccountId: "acct_seller",
  hammerCents: HAMMER,
  buyerPremiumBps: 500, // 5%
  platformFeeBps: 800, // 8%
};

describe("computeFees", () => {
  it("adds buyer premium to the buyer total and keeps the platform fee separate", () => {
    const f = computeFees(HAMMER, 500, 800);
    expect(f.buyerPremiumCents).toBe(2_500n); // 5% of $500
    expect(f.platformFeeCents).toBe(4_000n); // 8% of $500
    expect(f.buyerTotalCents).toBe(525_00n); // $500 + $25 premium
  });
});

describe("IntegratedPaymentService — hold at hammer", () => {
  it("authorizes the buyer total as a destination charge with the platform fee", async () => {
    const { gateway, service } = setup();
    const rec = await service.holdAtHammer(input);

    expect(rec.status).toBe("HELD");
    expect(rec.amountCents).toBe(525_00n);
    expect(rec.platformFeeCents).toBe(4_000n);

    const held = gateway.records.get(rec.gatewayRef)!;
    expect(held.state).toBe("HELD");
    expect(held.buyerTotalCents).toBe(525_00n);
    expect(held.sellerAccountId).toBe("acct_seller");
  });

  it("is idempotent per lot — a retried hammer doesn't double-charge", async () => {
    const { gateway, service } = setup();
    const a = await service.holdAtHammer(input);
    const b = await service.holdAtHammer(input);
    expect(a.gatewayRef).toBe(b.gatewayRef);
    expect(gateway.records.size).toBe(1);
  });
});

describe("IntegratedPaymentService — lifecycle transitions", () => {
  it("captures a held payment on seller confirmation", async () => {
    const { gateway, service } = setup();
    const rec = await service.holdAtHammer(input);
    const status = await service.captureOnConfirm(input.lotId, rec.gatewayRef);
    expect(status).toBe("CAPTURED");
    expect(gateway.records.get(rec.gatewayRef)!.state).toBe("CAPTURED");
  });

  it("voids a hold for a lot that never settles", async () => {
    const { gateway, service } = setup();
    const rec = await service.holdAtHammer(input);
    const status = await service.voidHold(input.lotId, rec.gatewayRef);
    expect(status).toBe("CANCELLED");
    expect(gateway.records.get(rec.gatewayRef)!.state).toBe("CANCELLED");
  });

  it("refuses to capture a voided hold", async () => {
    const { service } = setup();
    const rec = await service.holdAtHammer(input);
    await service.voidHold(input.lotId, rec.gatewayRef);
    await expect(service.captureOnConfirm(input.lotId, rec.gatewayRef)).rejects.toThrow();
  });

  it("refunds only after capture", async () => {
    const { service } = setup();
    const rec = await service.holdAtHammer(input);
    await expect(service.refund(input.lotId, rec.gatewayRef, null)).rejects.toThrow();

    await service.captureOnConfirm(input.lotId, rec.gatewayRef);
    const status = await service.refund(input.lotId, rec.gatewayRef, null);
    expect(status).toBe("REFUNDED");
  });

  it("rejects a partial refund larger than the captured amount", async () => {
    const { service } = setup();
    const rec = await service.holdAtHammer(input);
    await service.captureOnConfirm(input.lotId, rec.gatewayRef);
    await expect(
      service.refund(input.lotId, rec.gatewayRef, 999_00n),
    ).rejects.toThrow(/exceeds/);
  });
});
