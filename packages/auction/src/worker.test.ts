import { describe, it, expect } from "vitest";
import { SequencerWorker, type Broadcaster, type SequencerEvent } from "./worker.js";
import { InMemoryBidStream } from "./stream.js";
import { InMemoryLotStateStore } from "./store.js";
import type { IncomingBid, LotState } from "./types.js";

const NOW = 1_700_000_000_000;

function seedLot(overrides: Partial<LotState> = {}): LotState {
  return {
    lotId: "lot-1",
    highBidderId: null,
    highBidCents: 1_000n,
    proxyMaxCents: null,
    reserveCents: null,
    minIncrementCents: 100n,
    endsAt: 0,
    softCloseSecs: 0,
    seq: 0n,
    closed: false,
    ...overrides,
  };
}

function bid(overrides: Partial<IncomingBid> = {}): IncomingBid {
  return {
    lotId: "lot-1",
    bidderId: "buyer-A",
    amountCents: 1_000n,
    creditApproved: true,
    sellerId: "seller-Z",
    receivedAt: NOW,
    ...overrides,
  };
}

class CapturingBroadcaster implements Broadcaster {
  readonly events: SequencerEvent[] = [];
  async publish(_roomId: string, event: SequencerEvent): Promise<void> {
    this.events.push(event);
  }
}

function harness(seed: LotState[]) {
  const stream = new InMemoryBidStream();
  const store = new InMemoryLotStateStore(seed);
  const broadcaster = new CapturingBroadcaster();
  const worker = new SequencerWorker({ stream, store, broadcaster, blockMs: 0 });
  return { stream, store, broadcaster, worker };
}

describe("SequencerWorker — durable single-writer resolution", () => {
  it("resolves a two-bidder contest in stream order, persisting each accepted bid", async () => {
    const { stream, store, broadcaster, worker } = harness([seedLot()]);

    await stream.add("auction-1", bid({ bidderId: "buyer-A", proxyMaxCents: 5_000n }));
    await stream.add("auction-1", bid({ bidderId: "buyer-B", amountCents: 6_000n }));

    await worker.drain("auction-1", "0");

    // B outbids A's hidden ceiling of 5_000; price settles just over it.
    const final = store.states.get("lot-1")!;
    expect(final.highBidderId).toBe("buyer-B");
    expect(final.highBidCents).toBe(5_100n);
    expect(final.seq).toBe(2n);

    expect(store.log).toHaveLength(2); // both accepted bids are durable
    expect(store.log.map((b) => b.seq)).toEqual([1n, 2n]);

    const accepts = broadcaster.events.filter((e) => e.ok);
    expect(accepts).toHaveLength(2);
    expect(broadcaster.events.at(-1)).toMatchObject({
      ok: true,
      highBidderId: "buyer-B",
      priceCents: 5_100n,
      leadChanged: true,
    });
  });

  it("breaks a true race deterministically by stream order, not wall-clock", async () => {
    // Two challengers with identical receivedAt — only stream order decides.
    const { stream, store, worker } = harness([
      seedLot({ highBidderId: "buyer-A", highBidCents: 1_000n, proxyMaxCents: 2_000n }),
    ]);

    await stream.add("auction-1", bid({ bidderId: "buyer-B", amountCents: 3_000n, receivedAt: NOW }));
    await stream.add("auction-1", bid({ bidderId: "buyer-C", amountCents: 3_000n, receivedAt: NOW }));

    await worker.drain("auction-1", "0");

    // B arrives first and beats A's 2_000 ceiling -> B leads at 2_100.
    // C then ties B's 3_000 ceiling -> resting bid (B) holds.
    const final = store.states.get("lot-1")!;
    expect(final.highBidderId).toBe("buyer-B");
    expect(final.highBidCents).toBe(3_000n); // capped at C's matching ceiling
  });

  it("broadcasts rejections without persisting a bid", async () => {
    const { stream, store, broadcaster, worker } = harness([seedLot()]);

    await stream.add("auction-1", bid({ creditApproved: false }));

    await worker.drain("auction-1", "0");

    expect(store.log).toHaveLength(0);
    expect(broadcaster.events).toEqual([
      {
        ok: false,
        lotId: "lot-1",
        streamId: "000000000001",
        bidderId: "buyer-A",
        reason: "NOT_CREDIT_APPROVED",
      },
    ]);
  });

  it("rejects bids for a lot the store doesn't know", async () => {
    const { stream, broadcaster, worker } = harness([]); // no seeded lots

    await stream.add("auction-1", bid({ lotId: "ghost" }));
    await worker.drain("auction-1", "0");

    expect(broadcaster.events).toEqual([
      expect.objectContaining({ ok: false, reason: "UNKNOWN_LOT", lotId: "ghost" }),
    ]);
  });

  it("multiplexes independent lots on one room stream without crosstalk", async () => {
    const { stream, store, worker } = harness([
      seedLot({ lotId: "lot-1" }),
      seedLot({ lotId: "lot-2", highBidCents: 5_000n }),
    ]);

    await stream.add("auction-1", bid({ lotId: "lot-1", bidderId: "A", amountCents: 1_000n }));
    await stream.add("auction-1", bid({ lotId: "lot-2", bidderId: "B", amountCents: 5_000n }));
    await stream.add("auction-1", bid({ lotId: "lot-1", bidderId: "C", amountCents: 2_000n }));

    await worker.drain("auction-1", "0");

    expect(store.states.get("lot-1")!.highBidderId).toBe("C");
    expect(store.states.get("lot-1")!.seq).toBe(2n);
    expect(store.states.get("lot-2")!.highBidderId).toBe("B");
    expect(store.states.get("lot-2")!.seq).toBe(1n);
  });

  it("surfaces a soft-close extension on the broadcast", async () => {
    const { stream, broadcaster, worker } = harness([
      seedLot({ endsAt: NOW + 5_000, softCloseSecs: 120 }),
    ]);

    await stream.add("auction-1", bid({ receivedAt: NOW }));
    await worker.drain("auction-1", "0");

    const evt = broadcaster.events[0]!;
    expect(evt.ok).toBe(true);
    if (!evt.ok) return;
    expect(evt.extended).toBe(true);
    expect(evt.endsAt).toBe(NOW + 120_000);
  });

  it("replays a stream to the identical final state (deterministic recovery)", async () => {
    const bids = [
      bid({ bidderId: "A", proxyMaxCents: 4_000n }),
      bid({ bidderId: "B", amountCents: 2_000n }),
      bid({ bidderId: "B", amountCents: 5_000n }),
    ];

    async function runFresh() {
      const { stream, store, worker } = harness([seedLot()]);
      for (const b of bids) await stream.add("auction-1", b);
      await worker.drain("auction-1", "0");
      return store.states.get("lot-1")!;
    }

    const first = await runFresh();
    const second = await runFresh();
    expect(second).toEqual(first);
  });

  it("advances the cursor so a second drain reprocesses nothing", async () => {
    const { stream, store, worker } = harness([seedLot()]);

    await stream.add("auction-1", bid({ bidderId: "A", amountCents: 1_000n }));
    const cursor = await worker.drain("auction-1", "0");

    await worker.drain("auction-1", cursor); // no new entries
    expect(store.log).toHaveLength(1); // not double-applied
  });
});
