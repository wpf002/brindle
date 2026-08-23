import type { FastifyInstance } from "fastify";
import { prisma } from "@brindle/db";
import { requireAuth } from "../auth.js";

export async function notificationRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { unreadOnly?: string } }>("/notifications", { preHandler: requireAuth }, async (req) => {
    const unreadOnly = req.query.unreadOnly === "true";
    const [items, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: req.session!.userId, ...(unreadOnly ? { readAt: null } : {}) },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      prisma.notification.count({ where: { userId: req.session!.userId, readAt: null } }),
    ]);
    return { notifications: items, unreadCount };
  });

  app.post<{ Params: { id: string } }>("/notifications/:id/read", { preHandler: requireAuth }, async (req, reply) => {
    const n = await prisma.notification.findUnique({ where: { id: req.params.id } });
    if (!n) return reply.code(404).send({ error: "NOTIFICATION_NOT_FOUND" });
    if (n.userId !== req.session!.userId) return reply.code(403).send({ error: "NOT_YOUR_NOTIFICATION" });
    await prisma.notification.update({ where: { id: n.id }, data: { readAt: new Date() } });
    return { read: true };
  });

  app.post("/notifications/read-all", { preHandler: requireAuth }, async (req) => {
    const { count } = await prisma.notification.updateMany({
      where: { userId: req.session!.userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { markedRead: count };
  });
}
