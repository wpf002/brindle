import type { FastifyInstance } from "fastify";
import { requireAuth } from "../auth.js";
import { presignUpload } from "../media.js";

export async function mediaRoutes(app: FastifyInstance) {
  // Hand the client a short-lived presigned PUT it uploads directly to.
  app.post<{ Body: { contentType?: string; prefix?: string } }>(
    "/media/presign",
    { preHandler: requireAuth },
    async (req, reply) => {
      const contentType = req.body?.contentType;
      if (!contentType) {
        return reply.code(400).send({ error: "CONTENT_TYPE_REQUIRED" });
      }
      try {
        return await presignUpload({ contentType, prefix: req.body?.prefix });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "PRESIGN_FAILED";
        const code = msg.startsWith("UNSUPPORTED_CONTENT_TYPE") ? 415 : 400;
        return reply.code(code).send({ error: msg });
      }
    },
  );
}
