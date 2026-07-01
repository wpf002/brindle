// Dispute resolution for INTEGRATED_PAYMENT lots. While a dispute is open, the
// payment stays HELD (never captured); resolution either refunds the buyer or
// releases funds to the seller. Pure state machine — the API drives the payment
// side effects off the resulting transition.

export type DisputeStatus =
  | "OPEN"
  | "UNDER_REVIEW"
  | "RESOLVED_REFUND"
  | "RESOLVED_RELEASE"
  | "WITHDRAWN";

export type DisputeAction = "REVIEW" | "RESOLVE_REFUND" | "RESOLVE_RELEASE" | "WITHDRAW";

export type DisputeClaim =
  | "NOT_AS_DESCRIBED"
  | "DELIVERY"
  | "WEIGHT_VARIANCE"
  | "GENETICS_QUALITY";

export type DisputeTransition =
  | { ok: true; next: DisputeStatus; capturesFunds: boolean; refundsFunds: boolean }
  | { ok: false; reason: "INVALID_TRANSITION" };

const TERMINAL: ReadonlySet<DisputeStatus> = new Set([
  "RESOLVED_REFUND",
  "RESOLVED_RELEASE",
  "WITHDRAWN",
]);

export function isTerminal(status: DisputeStatus): boolean {
  return TERMINAL.has(status);
}

export function disputeTransition(status: DisputeStatus, action: DisputeAction): DisputeTransition {
  const invalid = { ok: false, reason: "INVALID_TRANSITION" } as const;
  const move = (next: DisputeStatus, opts: { capture?: boolean; refund?: boolean } = {}) =>
    ({ ok: true, next, capturesFunds: !!opts.capture, refundsFunds: !!opts.refund } as const);

  switch (status) {
    case "OPEN":
      if (action === "REVIEW") return move("UNDER_REVIEW");
      if (action === "WITHDRAW") return move("WITHDRAWN", { capture: true }); // seller keeps the sale
      return invalid;
    case "UNDER_REVIEW":
      if (action === "RESOLVE_REFUND") return move("RESOLVED_REFUND", { refund: true });
      if (action === "RESOLVE_RELEASE") return move("RESOLVED_RELEASE", { capture: true });
      if (action === "WITHDRAW") return move("WITHDRAWN", { capture: true });
      return invalid;
    default:
      return invalid; // terminal states accept nothing
  }
}
