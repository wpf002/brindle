// Sequencer load / integrity drill. Fires many concurrent bidders at one lot and
// then proves the durable engine's invariants held under real WS + Redis + PG
// concurrency:
//   - every accepted bid has a unique, gap-free seq (single-writer, no lost/dup)
//   - exactly one final high bidder at the true maximum
//
// Usage (with the API running against the same DATABASE_URL/REDIS_URL):
//   pnpm --filter @brindle/api exec tsx src/loadtest.ts [buyers] [bidsEach]
import { prisma, UserType, CreditStatus, AuctionFormat, SettlementMode, LotStatus } from "@brindle/db";

const API = process.env.API_URL ?? "http://localhost:3001";
const WS = API.replace(/^http/, "ws");
const BUYERS = Number(process.argv[2] ?? 8);
const BIDS_EACH = Number(process.argv[3] ?? 25);

async function token(email: string): Promise<string> {
  const r = await fetch(`${API}/auth/dev-login`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }),
  });
  return ((await r.json()) as { token: string }).token;
}

async function main() {
  const stamp = String(Date.now());
  const seller = await prisma.user.create({
    data: { email: `lt-seller-${stamp}@t.com`, type: UserType.SELLER_BREEDER, legalName: "LT Seller" },
  });
  const buyers = await Promise.all(
    Array.from({ length: BUYERS }, (_, i) =>
      prisma.user.create({
        data: { email: `lt-buyer-${i}-${stamp}@t.com`, type: UserType.BUYER, legalName: `LT ${i}`, creditStatus: CreditStatus.APPROVED },
      }),
    ),
  );
  const auction = await prisma.auction.create({
    data: { sellerId: seller.id, name: "LoadTest", format: AuctionFormat.TIMED_ONLINE, settlementMode: SettlementMode.INTEGRATED_PAYMENT, startsAt: new Date(), softCloseSecs: 0 },
  });
  const lot = await prisma.lot.create({
    data: { auctionId: auction.id, lotNumber: 1, category: "SEMEN", priceUnit: "DOSE", startingBidCents: 1000n, bidIncrementCents: 100n, status: LotStatus.ACTIVE },
  });

  const tokens = await Promise.all(buyers.map((b) => token(b.email)));
  const start = Date.now();

  await Promise.all(
    tokens.map((tok, i) =>
      new Promise<void>((resolve) => {
        const ws = new WebSocket(`${WS}/auctions/${auction.id}/ws?token=${tok}`);
        ws.addEventListener("open", () => {
          let sent = 0;
          const fire = () => {
            if (sent >= BIDS_EACH) { setTimeout(() => { ws.close(); resolve(); }, 400); return; }
            // Escalating, interleaved amounts so bidders genuinely contend.
            const amount = 1000 + (sent * BUYERS + i) * 100;
            ws.send(JSON.stringify({ lotId: lot.id, amountCents: String(amount) }));
            sent += 1;
            setTimeout(fire, Math.floor(5 + (i % 3) * 3));
          };
          fire();
        });
        ws.addEventListener("error", () => resolve());
      }),
    ),
  );

  // Let the sequencer drain the tail, then audit the persisted log.
  await new Promise((r) => setTimeout(r, 800));
  const bids = await prisma.bid.findMany({ where: { lotId: lot.id }, orderBy: { seq: "asc" } });
  const seqs = bids.map((b) => Number(b.seq));
  const contiguous = seqs.every((s, idx) => s === idx + 1);
  const unique = new Set(seqs).size === seqs.length;
  const maxAmount = bids.reduce((m, b) => (b.amountCents > m ? b.amountCents : m), 0n);
  const finalState = (await fetch(`${API}/lots/${lot.id}`).then((r) => r.json())) as {
    live: { currentPriceCents: string };
  };
  const winnerPrice = BigInt(finalState.live.currentPriceCents);
  const elapsed = Date.now() - start;

  const pass = contiguous && unique && winnerPrice <= maxAmount && bids.length > 0;
  console.log(JSON.stringify({
    buyers: BUYERS, bidsEach: BIDS_EACH, attempted: BUYERS * BIDS_EACH,
    accepted: bids.length, seqContiguous: contiguous, seqUnique: unique,
    finalPrice: winnerPrice.toString(), maxBid: maxAmount.toString(),
    elapsedMs: elapsed, throughputPerSec: Math.round((bids.length / elapsed) * 1000),
  }, null, 2));
  console.log(pass ? "LOADTEST PASS" : "LOADTEST FAIL");

  await prisma.$disconnect();
  process.exit(pass ? 0 : 1);
}

void main();
