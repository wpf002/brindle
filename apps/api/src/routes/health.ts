import type { FastifyInstance } from "fastify";
import { prisma } from "@brindle/db";
import {
  deployEnv, activeDevFallbacks, paymentsEnabled, identityVerificationEnabled, emailEnabled,
} from "../env.js";

export async function health(app: FastifyInstance) {
  // Liveness: is the process up? Deliberately dependency-free so a database
  // blip doesn't cause an orchestrator to kill an otherwise-healthy process.
  app.get("/health", async () => ({ ok: true, service: "brindle-api" }));

  /**
   * What this deployment can actually do. Public and unauthenticated — the web
   * app reads it on load so it can hide flows that would dead-end.
   *
   * Without it the UI offers buttons that always fail: a "Connect Payouts" step
   * on a deployment with payments off, a photo picker with nowhere to upload to.
   * A feature that isn't there should be absent, not broken.
   */
  app.get("/config", async () => ({
    features: {
      payments: paymentsEnabled(),
      identityVerification: identityVerificationEnabled(),
      email: emailEnabled(),
      // Uploads go straight to object storage; without a bucket there is
      // nowhere for them to go.
      mediaUploads: Boolean(process.env.S3_BUCKET),
    },
  }));

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
      // Features switched off for this deployment. Distinct from devFallbacks:
      // these are absent on purpose, not stubbed.
      disabled: [
        ...(paymentsEnabled() ? [] : ["payments"]),
        ...(identityVerificationEnabled() ? [] : ["identity"]),
        ...(emailEnabled() ? [] : ["email"]),
      ],
    });
  });
}
