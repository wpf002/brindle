import type { FastifyInstance } from "fastify";
import crypto from "node:crypto";
import { prisma } from "@brindle/db";
import { requireAuth } from "../auth.js";
import { makeIdentityProvider } from "../identity.js";

export async function identityRoutes(app: FastifyInstance) {
  const provider = makeIdentityProvider();

  app.post("/identity/start", { preHandler: requireAuth }, async (req) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.session!.userId } });
    const { inquiryUrl, ref } = await provider.startInquiry(user.id, user.email);
    await prisma.user.update({ where: { id: user.id }, data: { identityRef: ref } });
    return { inquiryUrl, ref };
  });

  // Dev-only: simulates the user completing Persona's hosted flow. Never
  // available in production — real verification only ever completes via the
  // signed webhook below.
  app.post<{ Querystring: { ref?: string } }>("/identity/dev-approve", { preHandler: requireAuth }, async (req, reply) => {
    if (process.env.NODE_ENV === "production") return reply.code(404).send({ error: "NOT_FOUND" });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.session!.userId } });
    if (!req.query.ref || user.identityRef !== req.query.ref) {
      return reply.code(400).send({ error: "REF_MISMATCH" });
    }
    await prisma.user.update({ where: { id: user.id }, data: { idVerifiedAt: new Date() } });
    return { verified: true };
  });

  // Persona's real webhook. Verifies the HMAC signature against
  // PERSONA_WEBHOOK_SECRET before trusting the payload — an unsigned or
  // misconfigured webhook is refused rather than silently accepted.
  app.post("/identity/webhook", async (req, reply) => {
    const secret = process.env.PERSONA_WEBHOOK_SECRET;
    if (!secret) return reply.code(503).send({ error: "WEBHOOK_NOT_CONFIGURED" });

    const signatureHeader = req.headers["persona-signature"];
    const raw = JSON.stringify(req.body);
    const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex");
    const provided = typeof signatureHeader === "string" ? signatureHeader : "";
    const valid =
      provided.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
    if (!valid) return reply.code(401).send({ error: "INVALID_SIGNATURE" });

    const body = req.body as {
      data?: { attributes?: { payload?: { data?: { id?: string; attributes?: { status?: string } } } } };
    };
    const inquiry = body.data?.attributes?.payload?.data;
    if (inquiry?.attributes?.status === "completed" && inquiry.id) {
      await prisma.user.updateMany({
        where: { identityRef: inquiry.id },
        data: { idVerifiedAt: new Date() },
      });
    }
    return { received: true };
  });
}
