import Fastify from "fastify";
import websocket from "@fastify/websocket";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { authPlugin } from "./auth.js";
import { SequencerManager } from "./sequencer/manager.js";
import { PrismaLotStateStore } from "./sequencer/prismaStore.js";
import { RingManager } from "./ring/manager.js";
import { PrismaRingStore } from "./ring/prismaStore.js";
import { health } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { buyerRoutes } from "./routes/buyers.js";
import { mediaRoutes } from "./routes/media.js";
import { geneticsRoutes } from "./routes/genetics.js";
import { settlementRoutes } from "./routes/settlement.js";
import { catalogRoutes } from "./routes/catalog.js";
import { consoleRoutes } from "./routes/console.js";
import { marketRoutes } from "./routes/market.js";
import { disputeRoutes } from "./routes/disputes.js";
import { trustRoutes } from "./routes/trust.js";
import { publicRoutes } from "./routes/public.js";
import { sellerRoutes } from "./routes/sellers.js";
import { newsRoutes } from "./routes/news.js";
import { stripeConnectRoutes } from "./routes/stripeConnect.js";
import { identityRoutes } from "./routes/identity.js";
import { watchlistRoutes } from "./routes/watchlist.js";
import { notificationRoutes } from "./routes/notifications.js";
import { deliveryRoutes } from "./routes/delivery.js";
import { catalogImportRoutes } from "./routes/catalogImport.js";
import { adminRoutes } from "./routes/admin.js";
import { bidsRoutes } from "./routes/bids.js";
import { ringRoutes } from "./routes/ring.js";
import { closeExpiredLots } from "./lotCloser.js";
import { initObservability } from "./observability.js";

declare module "fastify" {
  interface FastifyInstance {
    sequencer: SequencerManager;
    ring: RingManager;
  }
}

const app = Fastify({ logger: true, trustProxy: true });

// Install the error handler and crash hooks before anything else registers.
initObservability(app);

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const sequencer = new SequencerManager(redisUrl, new PrismaLotStateStore());
const ring = new RingManager(redisUrl, new PrismaRingStore());
app.decorate("sequencer", sequencer);
app.decorate("ring", ring);

// Timed lots don't close themselves — soft-close extension lives in the pure
// resolver, but a lot that simply runs out the clock with no further bids needs
// a sweep to notice. Runs in-process; a multi-instance deploy should move this
// behind a leader election or an external scheduler so it runs exactly once.
const CLOSE_SWEEP_MS = Number(process.env.LOT_CLOSE_SWEEP_MS ?? 30_000);
const closeSweep = setInterval(() => {
  void closeExpiredLots(sequencer).catch((err) => app.log.error({ err }, "lot close sweep failed"));
}, CLOSE_SWEEP_MS);
closeSweep.unref(); // never hold the process open on this alone

app.addHook("onClose", async () => {
  clearInterval(closeSweep);
  await sequencer.shutdown();
  await ring.shutdown();
});

// Security headers. CSP is disabled — this is a pure JSON/WS API, no HTML
// responses to protect, and a default CSP breaks the WS upgrade in some proxies.
await app.register(helmet, { contentSecurityPolicy: false });

// Generous global ceiling against abuse/scraping; auth-sensitive routes below
// get their own tighter limits.
await app.register(rateLimit, {
  global: true,
  max: 300,
  timeWindow: "1 minute",
});

await app.register(cors, {
  origin: (process.env.CORS_ORIGINS ?? "http://localhost:3000,http://localhost:3002").split(","),
  credentials: true,
});
await app.register(websocket);
await app.register(authPlugin);
await app.register(health);
await app.register(authRoutes);
await app.register(buyerRoutes);
await app.register(mediaRoutes);
await app.register(geneticsRoutes);
await app.register(settlementRoutes);
await app.register(catalogRoutes);
await app.register(consoleRoutes);
await app.register(marketRoutes);
await app.register(disputeRoutes);
await app.register(trustRoutes);
await app.register(publicRoutes);
await app.register(sellerRoutes);
await app.register(newsRoutes);
await app.register(stripeConnectRoutes);
await app.register(identityRoutes);
await app.register(watchlistRoutes);
await app.register(notificationRoutes);
await app.register(deliveryRoutes);
await app.register(catalogImportRoutes);
await app.register(adminRoutes);
await app.register(bidsRoutes);
await app.register(ringRoutes);

const port = Number(process.env.PORT ?? 3001);
app
  .listen({ port, host: "0.0.0.0" })
  .then(() => app.log.info(`brindle api on :${port}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
