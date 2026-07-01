import Fastify from "fastify";
import websocket from "@fastify/websocket";
import cors from "@fastify/cors";
import { authPlugin } from "./auth.js";
import { SequencerManager } from "./sequencer/manager.js";
import { PrismaLotStateStore } from "./sequencer/prismaStore.js";
import { health } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { buyerRoutes } from "./routes/buyers.js";
import { mediaRoutes } from "./routes/media.js";
import { geneticsRoutes } from "./routes/genetics.js";
import { settlementRoutes } from "./routes/settlement.js";
import { catalogRoutes } from "./routes/catalog.js";
import { consoleRoutes } from "./routes/console.js";
import { bidsRoutes } from "./routes/bids.js";

declare module "fastify" {
  interface FastifyInstance {
    sequencer: SequencerManager;
  }
}

const app = Fastify({ logger: true });

const sequencer = new SequencerManager(
  process.env.REDIS_URL ?? "redis://localhost:6379",
  new PrismaLotStateStore(),
);
app.decorate("sequencer", sequencer);
app.addHook("onClose", async () => sequencer.shutdown());

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
await app.register(bidsRoutes);

const port = Number(process.env.PORT ?? 3001);
app
  .listen({ port, host: "0.0.0.0" })
  .then(() => app.log.info(`brindle api on :${port}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
