import type { FastifyInstance } from "fastify";
import { prisma } from "@brindle/db";
import { requireAdmin } from "../auth.js";
import { generateApiKey, requireApiKey } from "../apikey.js";
import { queryComparables } from "../marketQuery.js";

// Public API — the standalone buyer-intelligence surface, sellable on its own
// even to buyers who transact elsewhere (the Furlong-for-cattle valuation layer).
export async function publicRoutes(app: FastifyInstance) {
  // Mint an API key (admin). Raw key is shown exactly once.
  app.post<{ Body: { label?: string; scopes?: string[] } }>(
    "/admin/api-keys",
    { preHandler: requireAdmin },
    async (req, reply) => {
      const { label, scopes } = req.body ?? {};
      if (!label || !Array.isArray(scopes) || scopes.length === 0) {
        return reply.code(400).send({ error: "LABEL_AND_SCOPES_REQUIRED" });
      }
      const { raw, hash } = generateApiKey();
      const key = await prisma.apiKey.create({ data: { keyHash: hash, label, scopes } });
      return { id: key.id, apiKey: raw, scopes: key.scopes }; // raw shown once
    },
  );

  // Public comparables — the valuation layer, API-key gated.
  app.get<{ Querystring: { category?: string; weight?: string; region?: string; asOf?: string; head?: string } }>(
    "/public/comparables",
    { preHandler: requireApiKey("comparables") },
    async (req, reply) => {
      const { category, weight, region, asOf, head } = req.query;
      if (!category || !weight) return reply.code(400).send({ error: "CATEGORY_AND_WEIGHT_REQUIRED" });
      return queryComparables({
        category, weightLbs: Number(weight), region, asOf, head: head != null ? Number(head) : undefined,
      });
    },
  );
}
