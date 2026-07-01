import { createHash, randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "@brindle/db";

// API keys for third-party integrations + the standalone buyer-intelligence
// surface. Only the hash is stored; the raw key is returned once at creation.
export function hashKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function generateApiKey(): { raw: string; hash: string } {
  const raw = `bk_${randomBytes(24).toString("hex")}`;
  return { raw, hash: hashKey(raw) };
}

/** preHandler factory: gate a route on an active API key carrying `scope`. */
export function requireApiKey(scope: string) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const raw = req.headers["x-api-key"];
    if (typeof raw !== "string") {
      await reply.code(401).send({ error: "API_KEY_REQUIRED" });
      return;
    }
    const key = await prisma.apiKey.findUnique({ where: { keyHash: hashKey(raw) } });
    if (!key || !key.active || !key.scopes.includes(scope)) {
      await reply.code(403).send({ error: "FORBIDDEN" });
      return;
    }
    void prisma.apiKey.update({ where: { id: key.id }, data: { lastUsed: new Date() } }).catch(() => {});
  };
}
