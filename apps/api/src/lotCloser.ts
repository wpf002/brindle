import { prisma, LotStatus, AuctionFormat, NotificationType } from "@brindle/db";
import { reserveMet } from "@brindle/auction";
import type { SequencerManager } from "./sequencer/manager.js";
import { PrismaLotStateStore } from "./sequencer/prismaStore.js";
import { notify, lotContext } from "./notify.js";

// Time-driven close for TIMED_ONLINE lots. Soft-close extension already lives in
// the pure resolver and is correctly reconstructed on every `store.load()` by
// replaying the bid log — but nothing ever notices that time ran out for a lot
// that receives no further bids. This sweep is that missing piece.
//
// Lot.endsAt is filtered as a NECESSARY (not sufficient) pre-condition in SQL:
// soft-close only ever pushes the live end time forward, so live endsAt is
// always >= the static seed value. Every candidate then gets its true,
// replay-reconstructed endsAt checked before being closed.
const store = new PrismaLotStateStore();

export async function closeExpiredLots(sequencer: SequencerManager): Promise<number> {
  const now = Date.now();
  const candidates = await prisma.lot.findMany({
    where: {
      status: LotStatus.ACTIVE,
      endsAt: { lte: new Date(now) },
      auction: { format: AuctionFormat.TIMED_ONLINE },
    },
    select: { id: true, auctionId: true },
  });

  let closed = 0;
  for (const candidate of candidates) {
    const state = await store.load(candidate.id);
    if (!state || state.endsAt <= 0 || state.endsAt > now) continue; // extended past `now`, not actually done

    const sold = state.highBidderId != null && reserveMet(state);
    await prisma.lot.update({
      where: { id: candidate.id },
      data: { status: sold ? LotStatus.SOLD : LotStatus.PASSED },
    });
    // Belt-and-suspenders: evict from the live worker's cache in case it's warm.
    sequencer.closeLot(candidate.auctionId, candidate.id);
    closed += 1;

    await fireCloseNotifications(candidate.id, sold, state.highBidderId);
  }
  return closed;
}

async function fireCloseNotifications(
  lotId: string,
  sold: boolean,
  highBidderId: string | null,
): Promise<void> {
  const ctx = await lotContext(lotId);
  if (!ctx) return;

  if (sold && highBidderId) {
    await Promise.all([
      notify(highBidderId, NotificationType.LOT_WON, `You won ${ctx.label}`,
        `Your bid on ${ctx.label} in ${ctx.auctionName} was the winner. Complete checkout to settle the sale.`, ctx.href),
      notify(ctx.sellerId, NotificationType.LOT_SOLD, `${ctx.label} sold`,
        `${ctx.label} sold in ${ctx.auctionName}. Confirm the sale in your seller console to release funds.`, ctx.href),
    ]);
  } else {
    await notify(ctx.sellerId, NotificationType.SYSTEM, `${ctx.label} closed with no sale`,
      `${ctx.label} in ${ctx.auctionName} closed without a winning bid that met reserve.`, ctx.href);
  }
}
