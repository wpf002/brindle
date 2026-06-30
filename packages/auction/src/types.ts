import type { Cents } from "@brindle/core";

export type LotId = string;
export type UserId = string;

export interface IncomingBid {
  lotId: LotId;
  bidderId: UserId;
  amountCents: Cents;     // bid in the lot's price unit
  proxyMaxCents?: Cents;  // optional hidden ceiling for proxy/max bidding
  creditApproved: boolean;
  sellerId: UserId;       // used to reject self-bidding
  receivedAt: number;     // ms epoch, stamped at ingest (drives FIFO + soft close)
}

export interface LotState {
  lotId: LotId;
  highBidderId: UserId | null;
  highBidCents: Cents;       // current standing (displayed) price
  proxyMaxCents: Cents | null; // resting high bidder's hidden ceiling
  reserveCents: Cents | null;
  minIncrementCents: Cents;
  endsAt: number;            // ms epoch; 0 for live ring (auctioneer-controlled)
  softCloseSecs: number;     // anti-snipe window; 0 disables
  seq: bigint;               // monotonic bid sequence for this lot
  closed: boolean;
}

export type RejectReason =
  | "NOT_CREDIT_APPROVED"
  | "SELF_BID"
  | "LOT_CLOSED"
  | "BELOW_MIN_INCREMENT";

export type BidResult =
  | {
      ok: true;
      state: LotState;     // fully-applied new state
      seq: bigint;
      highBidderId: UserId;
      priceCents: Cents;
      leadChanged: boolean; // did the standing high bidder change?
      reserveMet: boolean;
      extended: boolean;    // did soft-close push endsAt out?
    }
  | { ok: false; reason: RejectReason };
