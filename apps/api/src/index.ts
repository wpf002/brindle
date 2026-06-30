import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { authPlugin } from "./auth.js";
import { health } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { mediaRoutes } from "./routes/media.js";
import { bidsRoutes } from "./routes/bids.js";

const app = Fastify({ logger: true });

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
