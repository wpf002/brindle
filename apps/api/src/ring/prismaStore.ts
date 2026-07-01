import {
  prisma, Prisma, BidKind, LotStatus, SettlementMode, ContractStatus, type PriceUnit,
} from "@brindle/db";
import { estimateContract } from "@brindle/settlement";
import type { RingLotState, RingStateStore, RingPersist, RingBidKind } from "@brindle/auction";

const bidKindFor = (k: RingBidKind): BidKind =>
  k === "FLOOR" ? BidKind.FLOOR : k === "PHONE" ? BidKind.PHONE : BidKind.MANUAL;

// Durable ring state on Postgres. State is reconstructed by replaying the lot's
// accepted ring bids; a HAMMER flips the lot to SOLD and, for CONTRACT-mode lots,
// generates a Livestock Forward Contract at the hammer price.
export class PrismaRingStore implements RingStateStore {
  private readonly units = new Map<string, PriceUnit>();

  async load(lotId: string): Promise<RingLotState | null> {
    const lot = await prisma.lot.findUnique({
      where: { id: lotId },
      include: { bids: { orderBy: { seq: "asc" } } },
    });
    if (!lot) return null;
    this.units.set(lotId, lot.priceUnit);

    const inc = lot.bidIncrementCents;
    let state: RingLotState = {
      lotId,
      highBidderId: null,
      highBidCents: lot.startingBidCents,
      askCents: lot.startingBidCents + inc,
      minIncrementCents: inc,
      seq: 0n,
      status:
        lot.status === LotStatus.SOLD ? "SOLD"
        : lot.status === LotStatus.PASSED || lot.status === LotStatus.WITHDRAWN ? "PASSED"
        : "OPEN",
    };
    for (const b of lot.bids) {
      state = {
        ...state,
        highBidderId: b.bidderId,
        highBidCents: b.amountCents,
        askCents: b.amountCents + inc,
        seq: b.seq,
      };
    }
    return state;
  }

  async persist(state: RingLotState, persist: RingPersist): Promise<void> {
    const ev = persist.result.event;
    if (ev.kind === "TAKEN") {
      try {
        await prisma.bid.create({
          data: {
            lotId: state.lotId,
            bidderId: ev.bidderId,
            amountCents: ev.priceCents,
            priceUnit: this.units.get(state.lotId) ?? (await this.lookupUnit(state.lotId)),
            kind: bidKindFor(ev.bidKind),
            seq: persist.result.seq,
            streamId: persist.streamId,
          },
        });
      } catch (e) {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
      }
      return;
    }
    if (ev.kind === "SOLD") {
      await prisma.lot.update({ where: { id: state.lotId }, data: { status: LotStatus.SOLD } });
      if (ev.bidderId) await this.maybeGenerateContract(state.lotId, ev.bidderId, ev.priceCents);
      return;
    }
    if (ev.kind === "PASSED") {
      await prisma.lot.update({ where: { id: state.lotId }, data: { status: LotStatus.PASSED } });
    }
  }

  private async maybeGenerateContract(lotId: string, buyerId: string, hammerCents: bigint): Promise<void> {
    const lot = await prisma.lot.findUnique({
      where: { id: lotId },
      include: { auction: { select: { sellerId: true, buyerPremiumBps: true, settlementMode: true } } },
    });
    if (!lot || lot.auction.settlementMode !== SettlementMode.CONTRACT) return;
    if (await prisma.contract.findUnique({ where: { lotId } })) return; // idempotent

    const baseWeightLbs = Number(lot.baseWeightLbs ?? lot.avgWeightLbs ?? 0);
    const est = estimateContract({
      basePriceCentsPerCwt: hammerCents,
      baseWeightLbs,
      slideCentsPerLb: lot.slideCents ?? 0,
      shrinkPct: Number(lot.shrinkPct ?? 0),
      head: lot.headCount ?? 1,
      buyerPremiumBps: lot.auction.buyerPremiumBps,
      techFeeCents: 25_000n,
      deliveryWindow: { start: "", end: "" },
    });

    await prisma.contract.create({
      data: {
        lotId,
        buyerId,
        sellerId: lot.auction.sellerId,
        hammerCents,
        buyerPremiumCents: est.buyerPremiumCents,
        platformFeeCents: est.platformTechFeeCents,
        baseWeightLbs: new Prisma.Decimal(baseWeightLbs),
        slideCents: lot.slideCents ?? 0,
        shrinkPct: new Prisma.Decimal(Number(lot.shrinkPct ?? 0)),
        deliveryWindow: { start: null, end: null },
        status: ContractStatus.DRAFT,
      },
    });
  }

  private async lookupUnit(lotId: string): Promise<PriceUnit> {
    const lot = await prisma.lot.findUniqueOrThrow({ where: { id: lotId }, select: { priceUnit: true } });
    this.units.set(lotId, lot.priceUnit);
    return lot.priceUnit;
  }
}
