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
  app.get("/auctions/:auctionId/ws", { websocket: true }, (socket, req) => {
    // Authenticated bidders only — the session is populated by authPlugin from
    // the `?token=` query param on the upgrade request.
    if (!req.session) {
      socket.send(JSON.stringify({ ok: false, reason: "UNAUTHENTICATED" }));
      socket.close();
      return;
    }

    socket.on("message", (raw: Buffer) => {
      // TODO Phase 1: push to Redis stream auction:{id}:bids; the single
      // sequencer consumer calls resolveBid and persists+broadcasts.
      // Inline resolve so the scaffold is runnable end-to-end until then.
      try {
        const msg = JSON.parse(raw.toString());
        const state: LotState = msg.state;
        const result = resolveBid(state, { ...msg.bid, receivedAt: Date.now() });
        socket.send(JSON.stringify(result));
      } catch {
        socket.send(JSON.stringify({ ok: false, reason: "BAD_MESSAGE" }));
      }
    });
  });
}
