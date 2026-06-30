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
    async (socket, req) => {
      if (!req.session) {
        socket.send(JSON.stringify({ ok: false, reason: "UNAUTHENTICATED" }));
        socket.close();
        return;
      }
      const session = req.session;
      const roomId = req.params.auctionId;

      const auction = await prisma.auction.findUnique({
        where: { id: roomId },
        select: { sellerId: true, status: true },
      });
      if (!auction || auction.status === AuctionStatus.CLOSED || auction.status === AuctionStatus.CANCELLED) {
        socket.send(JSON.stringify({ ok: false, reason: "AUCTION_UNAVAILABLE" }));
        socket.close();
        return;
      }

      // Stream this room's sequencer events down to the client.
      const unsubscribe = await app.sequencer.subscribe(roomId, (event) => {
        socket.send(JSON.stringify(event, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
      });

      socket.on("message", async (raw: Buffer) => {
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

        // Trusted fields come from the session and the auction, never the client.
        const bid: IncomingBid = {
          lotId: msg.lotId,
          bidderId: session.userId,
          amountCents: BigInt(msg.amountCents),
          proxyMaxCents: msg.proxyMaxCents != null ? BigInt(msg.proxyMaxCents) : undefined,
          creditApproved: session.creditApproved,
          sellerId: auction.sellerId,
          receivedAt: Date.now(),
        };
        await app.sequencer.submit(roomId, bid);
      });

      socket.on("close", () => {
        void unsubscribe();
      });
    },
  );
}
