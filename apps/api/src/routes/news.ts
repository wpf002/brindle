import type { FastifyInstance } from "fastify";
import { prisma } from "@brindle/db";
import { requireAdmin } from "../auth.js";

// Editorial content — market reports, sale recaps, ranch news. Platform-authored
// (same admin gate as market-data ingest); read side is public.
export async function newsRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { category?: string; limit?: string } }>("/news", async (req) => {
    const { category, limit } = req.query;
    const posts = await prisma.newsPost.findMany({
      where: category ? { category } : undefined,
      orderBy: { publishedAt: "desc" },
      take: limit ? Math.min(Number(limit), 50) : 30,
      select: { slug: true, title: true, dek: true, category: true, authorName: true, publishedAt: true },
    });
    return { posts };
  });

  app.get<{ Params: { slug: string } }>("/news/:slug", async (req, reply) => {
    const post = await prisma.newsPost.findUnique({ where: { slug: req.params.slug } });
    if (!post) return reply.code(404).send({ error: "POST_NOT_FOUND" });
    return { post };
  });

  app.post<{
    Body: {
      slug?: string; title?: string; dek?: string; body?: string; category?: string;
      authorName?: string; authorTitle?: string; sellerId?: string; publishedAt?: string;
    };
  }>("/news", { preHandler: requireAdmin }, async (req, reply) => {
    const b = req.body ?? {};
    if (!b.slug || !b.title || !b.dek || !b.body || !b.category || !b.authorName) {
      return reply.code(400).send({ error: "MISSING_REQUIRED_FIELDS" });
    }
    const post = await prisma.newsPost.create({
      data: {
        slug: b.slug, title: b.title, dek: b.dek, body: b.body, category: b.category,
        authorName: b.authorName, authorTitle: b.authorTitle, sellerId: b.sellerId,
        publishedAt: b.publishedAt ? new Date(b.publishedAt) : undefined,
      },
    });
    return { post };
  });
}
