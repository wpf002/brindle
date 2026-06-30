import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { authPlugin } from "./auth.js";
import { SequencerManager } from "./sequencer/manager.js";
import { PrismaLotStateStore } from "./sequencer/prismaStore.js";
import { health } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { mediaRoutes } from "./routes/media.js";
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

await app.register(websocket);
await app.register(authPlugin);
await app.register(health);
await app.register(authRoutes);
await app.register(mediaRoutes);
await app.register(bidsRoutes);

const port = Number(process.env.PORT ?? 3001);
app
  .listen({ port, host: "0.0.0.0" })
  .then(() => app.log.info(`brindle api on :${port}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
