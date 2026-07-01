import { describe, it, expect } from "vitest";
import { disputeTransition, isTerminal, type DisputeStatus } from "./dispute.js";

describe("disputeTransition", () => {
  it("moves OPEN to UNDER_REVIEW", () => {
    expect(disputeTransition("OPEN", "REVIEW")).toMatchObject({ ok: true, next: "UNDER_REVIEW" });
  });

  it("refunds the buyer on RESOLVE_REFUND from review", () => {
    const t = disputeTransition("UNDER_REVIEW", "RESOLVE_REFUND");
    expect(t).toMatchObject({ ok: true, next: "RESOLVED_REFUND", refundsFunds: true, capturesFunds: false });
  });

  it("releases funds to the seller on RESOLVE_RELEASE", () => {
    const t = disputeTransition("UNDER_REVIEW", "RESOLVE_RELEASE");
    expect(t).toMatchObject({ ok: true, next: "RESOLVED_RELEASE", capturesFunds: true, refundsFunds: false });
  });

  it("captures on withdraw (buyer drops the claim, sale stands)", () => {
    expect(disputeTransition("OPEN", "WITHDRAW")).toMatchObject({ ok: true, next: "WITHDRAWN", capturesFunds: true });
  });

  it("rejects resolving straight from OPEN without review", () => {
    expect(disputeTransition("OPEN", "RESOLVE_REFUND")).toEqual({ ok: false, reason: "INVALID_TRANSITION" });
  });

  it("rejects any action on a terminal dispute", () => {
    const terminal: DisputeStatus[] = ["RESOLVED_REFUND", "RESOLVED_RELEASE", "WITHDRAWN"];
    for (const s of terminal) {
      expect(disputeTransition(s, "REVIEW")).toEqual({ ok: false, reason: "INVALID_TRANSITION" });
      expect(isTerminal(s)).toBe(true);
    }
  });

  it("marks non-terminal states correctly", () => {
    expect(isTerminal("OPEN")).toBe(false);
    expect(isTerminal("UNDER_REVIEW")).toBe(false);
  });
});
