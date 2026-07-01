import { describe, it, expect } from "vitest";
import {
  RingWorker,
  InMemoryRingStream,
  InMemoryRingStore,
  type RingBroadcaster,
  type RingBroadcastEvent,
} from "./ring-worker.js";
import type { RingLotState } from "./ring.js";

function ringLot(overrides: Partial<RingLotState> = {}): RingLotState {
  return {
    lotId: "lot-1",
    highBidderId: null,
    highBidCents: 100_000n,
    askCents: 110_000n,
    minIncrementCents: 10_000n,
    seq: 0n,
    status: "OPEN",
    ...overrides,
  };
}

class Capture implements RingBroadcaster {
  events: RingBroadcastEvent[] = [];
  async publish(_room: string, e: RingBroadcastEvent) {
    this.events.push(e);
  }
}

function harness(seed: RingLotState[]) {
  const stream = new InMemoryRingStream();
  const store = new InMemoryRingStore(seed);
  const broadcaster = new Capture();
  const worker = new RingWorker({ stream, store, broadcaster, blockMs: 0 });
  return { stream, store, broadcaster, worker };
}

describe("RingWorker — durable auctioneer-driven ring", () => {
  it("runs a full lot: ask, two takes, hammer", async () => {
    const { stream, store, broadcaster, worker } = harness([ringLot()]);

    await stream.add("auction-1", { lotId: "lot-1", action: { type: "SET_ASK", askCents: 110_000n }, isAuctioneer: true, actorId: "auctioneer" });
    await stream.add("auction-1", { lotId: "lot-1", action: { type: "TAKE_ASK", bidderId: "A", kind: "ONLINE" }, isAuctioneer: false, actorId: "A" });
    await stream.add("auction-1", { lotId: "lot-1", action: { type: "TAKE_ASK", bidderId: "B", kind: "FLOOR" }, isAuctioneer: false, actorId: "clerk" });
    await stream.add("auction-1", { lotId: "lot-1", action: { type: "HAMMER" }, isAuctioneer: true, actorId: "auctioneer" });

    await worker.drain("auction-1", "0");

    const final = store.states.get("lot-1")!;
    expect(final.status).toBe("SOLD");
    expect(final.highBidderId).toBe("B");
    expect(final.highBidCents).toBe(120_000n); // B took the advanced ask
    expect(store.persisted).toHaveLength(4);

    const last = broadcaster.events.at(-1);
    expect(last).toMatchObject({ ok: true, kind: "SOLD", bidderId: "B", priceCents: 120_000n });
  });

  it("rejects a non-auctioneer hammer without mutating state", async () => {
    const { stream, store, broadcaster, worker } = harness([
      ringLot({ highBidderId: "A", highBidCents: 110_000n }),
    ]);
    await stream.add("auction-1", { lotId: "lot-1", action: { type: "HAMMER" }, isAuctioneer: false, actorId: "A" });
    await worker.drain("auction-1", "0");

    expect(store.states.get("lot-1")!.status).toBe("OPEN");
    expect(store.persisted).toHaveLength(0);
    expect(broadcaster.events[0]).toMatchObject({ ok: false, reason: "NOT_AUCTIONEER" });
  });

  it("rejects actions for an unknown lot", async () => {
    const { stream, broadcaster, worker } = harness([]);
    await stream.add("auction-1", { lotId: "ghost", action: { type: "PASS" }, isAuctioneer: true, actorId: "x" });
    await worker.drain("auction-1", "0");
    expect(broadcaster.events[0]).toMatchObject({ ok: false, reason: "UNKNOWN_LOT" });
  });
});
