import type { FastifyInstance } from "fastify";
import { prisma } from "@brindle/db";
import { deployEnv, activeDevFallbacks } from "../env.js";

export async function health(app: FastifyInstance) {
  // Liveness: is the process up? Deliberately dependency-free so a database
  // blip doesn't cause an orchestrator to kill an otherwise-healthy process.
  app.get("/health", async () => ({ ok: true, service: "brindle-api" }));

  // Readiness: can this instance actually serve traffic? Checks the database
  // and Redis, and reports 503 if either is unreachable, so a load balancer
  // routes around a broken instance instead of failing user requests.
  app.get("/ready", async (_req, reply) => {
    const checks: Record<string, "ok" | "fail"> = {};

    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.database = "ok";
    } catch {
      checks.database = "fail";
    }

    try {
      await app.sequencer.ping();
      checks.redis = "ok";
    } catch {
      checks.redis = "fail";
    }

    const ready = Object.values(checks).every((v) => v === "ok");
    // Report any subsystem on a stub, so nobody has to guess whether identity
    // checks or payments on this box are real. Only ever non-empty locally —
    // useDevFallback() refuses to boot a real deployment on stubs.
    return reply.code(ready ? 200 : 503).send({
      ready,
      checks,
      env: deployEnv(),
      devFallbacks: activeDevFallbacks(),
    });
  });
}
