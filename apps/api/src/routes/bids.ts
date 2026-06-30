import type { FastifyInstance } from "fastify";
import { resolveBid, type LotState } from "@brindle/auction";

/**
 * WS entrypoint for live bidding. In production each auction room has ONE
 * sequencer consumer reading a Redis stream (auction:{id}:bids) so bid
 * resolution is single-threaded and race-free. This route is the gateway:
 * it validates, stamps receivedAt, and pushes onto the stream. The handler
 * below shows the resolve step inline for scaffolding clarity.
 */
export async function bidsRoutes(app: FastifyInstance) {
  app.get("/auctions/:auctionId/ws", { websocket: true }, (socket /*, req */) => {
    socket.on("message", (raw: Buffer) => {
      // TODO Phase 2: push to Redis stream; sequencer worker calls resolveBid.
      // Inline demo so the scaffold is runnable end-to-end:
      try {
        const msg = JSON.parse(raw.toString());
        const state: LotState = msg.state;
        const result = resolveBid(state, { ...msg.bid, receivedAt: Date.now() });
        socket.send(JSON.stringify(result));
      } catch (e) {
        socket.send(JSON.stringify({ ok: false, reason: "BAD_MESSAGE" }));
      }
    });
  });
}
