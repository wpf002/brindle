import Fastify from "fastify";
import websocket from "@fastify/websocket";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import cookie from "@fastify/cookie";
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
import { stripeWebhookRoutes } from "./routes/stripeWebhook.js";
import { identityRoutes } from "./routes/identity.js";
import { watchlistRoutes } from "./routes/watchlist.js";
import { notificationRoutes } from "./routes/notifications.js";
import { deliveryRoutes } from "./routes/delivery.js";
import { catalogImportRoutes } from "./routes/catalogImport.js";
import { adminRoutes } from "./routes/admin.js";
import { bidsRoutes } from "./routes/bids.js";
import { ringRoutes } from "./routes/ring.js";
import Redis from "ioredis";
import { prisma } from "@brindle/db";
import { closeExpiredLots } from "./lotCloser.js";
import { syncDataMart } from "./datamart.js";
import { generateMarketReports } from "./marketReport.js";
import { initObservability } from "./observability.js";
import { withLock } from "./lock.js";
import { makeStripeClient } from "./stripeClient.js";
import { deployEnv, activeDevFallbacks } from "./env.js";

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
// a sweep to notice. Guarded by a Redis lock so exactly one instance sweeps per
// tick: without it every replica would fire its own duplicate close
// notifications to the same buyers and sellers.
const CLOSE_SWEEP_MS = Number(process.env.LOT_CLOSE_SWEEP_MS ?? 30_000);
const lockRedis = new Redis(redisUrl);
const closeSweep = setInterval(() => {
  void withLock(lockRedis, "brindle:lock:close-expired", CLOSE_SWEEP_MS * 2, () =>
    closeExpiredLots(sequencer),
  ).catch((err) => app.log.error({ err }, "lot close sweep failed"));
}, CLOSE_SWEEP_MS);
closeSweep.unref(); // never hold the process open on this alone

// Expired session rows are dead weight; prune them hourly (also lock-guarded).
const sessionSweep = setInterval(() => {
  void withLock(lockRedis, "brindle:lock:prune-sessions", 3600_000, async () => {
    const { count } = await prisma.session.deleteMany({
      where: { expiresAt: { lt: new Date(Date.now() - 7 * 24 * 3600_000) } },
    });
    if (count > 0) app.log.info({ count }, "pruned expired sessions");
  }).catch((err) => app.log.error({ err }, "session prune failed"));
}, 3600_000);
sessionSweep.unref();

// Pull the day's USDA prices and write them up. Runs every 6 hours rather than
// daily: AMS publishes once per business day but not at a fixed hour, and both
// halves are idempotent — the price upsert is keyed on the report's natural key
// and the post's slug is derived from its date, so a repeat run rewrites rather
// than duplicates. The lease means only one instance does the work.
//
// Set MARKET_SYNC_MS=0 to turn it off and drive the sync from an external
// scheduler against /admin/market/sync instead.
const MARKET_SYNC_MS = Number(process.env.MARKET_SYNC_MS ?? 6 * 3600_000);
const marketSync = MARKET_SYNC_MS > 0
  ? setInterval(() => {
      void withLock(lockRedis, "brindle:lock:market-sync", MARKET_SYNC_MS, async () => {
        const results = await syncDataMart(2);
        const posts = await generateMarketReports(2);
        app.log.info(
          { results, published: posts.filter((p) => p.published).map((p) => p.slug) },
          "market sync complete",
        );
      }).catch((err) => app.log.error({ err }, "market sync failed"));
    }, MARKET_SYNC_MS)
  : null;
marketSync?.unref();

app.addHook("onClose", async () => {
  clearInterval(closeSweep);
  clearInterval(sessionSweep);
  if (marketSync) clearInterval(marketSync);
  lockRedis.disconnect();
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

// Session cookies are httpOnly, so the browser sends them automatically and
// page JS never sees the token.
await app.register(cookie);

await app.register(cors, {
  origin: (process.env.CORS_ORIGINS ?? "http://localhost:3010").split(","),
  credentials: true, // required for the session cookie to ride along
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
// Registered as its own plugin so its raw-body parser stays encapsulated —
// every other route keeps normal JSON parsing.
await app.register(stripeWebhookRoutes);
await app.register(identityRoutes);
await app.register(watchlistRoutes);
await app.register(notificationRoutes);
await app.register(deliveryRoutes);
await app.register(catalogImportRoutes);
await app.register(adminRoutes);
await app.register(bidsRoutes);
await app.register(ringRoutes);

// Build the Stripe client eagerly. Every other adapter is constructed during
// registration, so a deployment missing real keys already fails here; Stripe's
// is lazy, and finding out at the first checkout is far too late.
makeStripeClient();

const fallbacks = activeDevFallbacks();
if (fallbacks.length > 0) {
  app.log.warn({ env: deployEnv(), fallbacks }, "running on development stubs — not real integrations");
}

const port = Number(process.env.PORT ?? 3001);
app
  .listen({ port, host: "0.0.0.0" })
  .then(() => app.log.info({ env: deployEnv() }, `brindle api on :${port}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
