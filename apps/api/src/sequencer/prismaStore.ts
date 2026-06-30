import {
  prisma,
  Prisma,
  BidKind,
  LotStatus,
  type PriceUnit,
} from "@brindle/db";
import {
  resolveBid,
  type AcceptedBid,
  type IncomingBid,
  type LotState,
  type LotStateStore,
} from "@brindle/auction";

// Durable lot state backed by Postgres. The bid log is authoritative: current
// state is reconstructed by replaying a lot's accepted bids through the same pure
// resolver the live path uses, so there is exactly one definition of "the price."
// persistAccepted writes a single immutable Bid row — inherently atomic — and is
// idempotent on (lotId, streamId), so a redelivered stream entry can't double-post.
export class PrismaLotStateStore implements LotStateStore {
  private readonly priceUnits = new Map<string, PriceUnit>();

  async load(lotId: string): Promise<LotState | null> {
    const lot = await prisma.lot.findUnique({
      where: { id: lotId },
      include: {
        auction: { select: { sellerId: true, softCloseSecs: true } },
        bids: { orderBy: { seq: "asc" } },
      },
    });
    if (!lot) return null;

    this.priceUnits.set(lotId, lot.priceUnit);

    let state: LotState = {
      lotId,
      highBidderId: null,
      highBidCents: lot.startingBidCents,
      proxyMaxCents: null,
      reserveCents: lot.reserveCents,
      minIncrementCents: lot.bidIncrementCents,
      endsAt: lot.endsAt ? lot.endsAt.getTime() : 0,
      softCloseSecs: lot.auction.softCloseSecs,
      seq: 0n,
      closed: lot.status !== LotStatus.ACTIVE,
    };

    // Replay the accepted bid log to the current state. These were accepted once,
    // so they re-accept; resolveBid stays the single source of pricing truth.
    for (const b of lot.bids) {
      const replay: IncomingBid = {
        lotId,
        bidderId: b.bidderId,
        amountCents: b.amountCents,
        proxyMaxCents: b.proxyMaxCents ?? undefined,
        creditApproved: true,
        sellerId: lot.auction.sellerId,
        receivedAt: b.createdAt.getTime(),
      };
      // Replay against an open copy so historical bids re-apply even if the lot
      // has since closed; restore the real closed flag afterward.
      const result = resolveBid({ ...state, closed: false }, replay);
      if (result.ok) state = { ...result.state, closed: state.closed };
    }

    return state;
  }

  async persistAccepted(state: LotState, accepted: AcceptedBid): Promise<void> {
    const priceUnit =
      this.priceUnits.get(state.lotId) ?? (await this.lookupPriceUnit(state.lotId));
    try {
      await prisma.bid.create({
        data: {
          lotId: state.lotId,
          bidderId: accepted.bid.bidderId,
          amountCents: accepted.bid.amountCents,
          priceUnit,
          kind: accepted.bid.proxyMaxCents != null ? BidKind.PROXY : BidKind.MANUAL,
          proxyMaxCents: accepted.bid.proxyMaxCents ?? null,
          seq: accepted.seq,
          streamId: accepted.streamId,
        },
      });
    } catch (e) {
      // Idempotent redelivery: this stream entry (or seq) is already persisted.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return;
      throw e;
    }
  }

  private async lookupPriceUnit(lotId: string): Promise<PriceUnit> {
    const lot = await prisma.lot.findUniqueOrThrow({
      where: { id: lotId },
      select: { priceUnit: true },
    });
    this.priceUnits.set(lotId, lot.priceUnit);
    return lot.priceUnit;
  }
}
