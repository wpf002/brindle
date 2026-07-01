import type { FastifyInstance } from "fastify";
import { prisma, AuctionStatus, AuctionFormat } from "@brindle/db";
import type { RingAction, RingActionEnvelope, RingBidKind } from "@brindle/auction";

// Live-ring gateway. Auctioneer control (set ask / hammer / pass) and take-the-ask
// (online / floor / phone) flow through the room's single ring sequencer. The
// gateway stamps auctioneer authority from the session — the client can't claim it.
export async function ringRoutes(app: FastifyInstance) {
  app.get<{ Params: { auctionId: string } }>(
    "/auctions/:auctionId/ring",
    { websocket: true },
    (socket, req) => {
      const roomId = req.params.auctionId;
      let ready = false;
      let isAuctioneer = false;
      let unsubscribe: (() => Promise<void>) | null = null;
      const pending: Buffer[] = [];

      function fail(reason: string) {
        socket.send(JSON.stringify({ ok: false, reason }));
      }

      function handle(raw: Buffer) {
        let msg: {
          lotId?: string;
          type?: string;
          askCents?: string | number;
          kind?: RingBidKind;
          bidderId?: string;
        };
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return fail("BAD_MESSAGE");
        }
        if (!msg.lotId || !msg.type) return fail("BAD_MESSAGE");

        let action: RingAction;
        switch (msg.type) {
          case "SET_ASK":
            if (msg.askCents == null) return fail("ASK_REQUIRED");
            action = { type: "SET_ASK", askCents: BigInt(msg.askCents) };
            break;
          case "HAMMER":
            action = { type: "HAMMER" };
            break;
          case "PASS":
            action = { type: "PASS" };
            break;
          case "TAKE_ASK": {
            const kind: RingBidKind = msg.kind ?? "ONLINE";
            // Floor/phone bids are entered by the clerk (auctioneer) on a
            // registered bidder's behalf; online bids are the bidder themselves.
            let bidderId: string;
            if (kind === "ONLINE") {
              bidderId = req.session!.userId;
            } else {
              if (!isAuctioneer) return fail("ONLY_CLERK_ENTERS_FLOOR_PHONE");
              if (!msg.bidderId) return fail("BIDDER_ID_REQUIRED");
              bidderId = msg.bidderId;
            }
            action = { type: "TAKE_ASK", bidderId, kind };
            break;
          }
          default:
            return fail("UNKNOWN_ACTION");
        }

        const envelope: RingActionEnvelope = {
          lotId: msg.lotId,
          action,
          isAuctioneer,
          actorId: req.session!.userId,
        };
        void app.ring.submit(roomId, envelope);
      }

      socket.on("message", (raw: Buffer) => (ready ? handle(raw) : pending.push(raw)));
      socket.on("close", () => {
        if (unsubscribe) void unsubscribe();
      });

      void (async () => {
        if (!req.session) {
          fail("UNAUTHENTICATED");
          socket.close();
          return;
        }
        const auction = await prisma.auction.findUnique({
          where: { id: roomId },
          select: { sellerId: true, status: true, format: true },
        });
        if (
          !auction ||
          auction.format !== AuctionFormat.LIVE_RING ||
          auction.status === AuctionStatus.CLOSED ||
          auction.status === AuctionStatus.CANCELLED
        ) {
          fail("RING_UNAVAILABLE");
          socket.close();
          return;
        }
        isAuctioneer = req.session.userId === auction.sellerId;

        unsubscribe = await app.ring.subscribe(roomId, (event) => {
          socket.send(JSON.stringify(event, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
        });
        ready = true;
        for (const raw of pending) handle(raw);
        pending.length = 0;
      })();
    },
  );
}
