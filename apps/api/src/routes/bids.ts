import type { FastifyInstance } from "fastify";
import { prisma, AuctionStatus } from "@brindle/db";
import type { IncomingBid } from "@brindle/auction";

// Gateway for live bidding. The socket NEVER resolves a bid itself — it stamps
// trusted fields from the session and appends to the room's ingest stream, then
// forwards the single sequencer's results back. One authoritative sequencer per
// room; the gateway is stateless and horizontally scalable.
export async function bidsRoutes(app: FastifyInstance) {
  app.get<{ Params: { auctionId: string } }>(
    "/auctions/:auctionId/ws",
    { websocket: true },
    (socket, req) => {
      const roomId = req.params.auctionId;

      // Attach the message listener SYNCHRONOUSLY, before any await, so a bid the
      // client fires immediately on open isn't dropped during async setup. Buffer
      // until the auction context is loaded and the event subscription is live.
      let ready = false;
      let sellerId = "";
      let unsubscribe: (() => Promise<void>) | null = null;
      const pending: Buffer[] = [];

      function handle(raw: Buffer) {
        let msg: { lotId?: string; amountCents?: string | number; proxyMaxCents?: string | number };
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          socket.send(JSON.stringify({ ok: false, reason: "BAD_MESSAGE" }));
          return;
        }
        if (!msg.lotId || msg.amountCents == null) {
          socket.send(JSON.stringify({ ok: false, reason: "BAD_MESSAGE" }));
          return;
        }
        const bid: IncomingBid = {
          lotId: msg.lotId,
          bidderId: req.session!.userId,
          amountCents: BigInt(msg.amountCents),
          proxyMaxCents: msg.proxyMaxCents != null ? BigInt(msg.proxyMaxCents) : undefined,
          creditApproved: req.session!.creditApproved,
          sellerId,
          receivedAt: Date.now(),
        };
        void app.sequencer.submit(roomId, bid);
      }

      socket.on("message", (raw: Buffer) => {
        if (ready) handle(raw);
        else pending.push(raw);
      });
      socket.on("close", () => {
        if (unsubscribe) void unsubscribe();
      });

      // Async setup: authenticate, load the auction, subscribe to its events.
      void (async () => {
        if (!req.session) {
          socket.send(JSON.stringify({ ok: false, reason: "UNAUTHENTICATED" }));
          socket.close();
          return;
        }
        const auction = await prisma.auction.findUnique({
          where: { id: roomId },
          select: { sellerId: true, status: true },
        });
        if (
          !auction ||
          auction.status === AuctionStatus.CLOSED ||
          auction.status === AuctionStatus.CANCELLED
        ) {
          socket.send(JSON.stringify({ ok: false, reason: "AUCTION_UNAVAILABLE" }));
          socket.close();
          return;
        }
        sellerId = auction.sellerId;

        unsubscribe = await app.sequencer.subscribe(roomId, (event) => {
          socket.send(
            JSON.stringify(event, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
          );
        });

        ready = true;
        for (const raw of pending) handle(raw);
        pending.length = 0;
      })();
    },
  );
}
