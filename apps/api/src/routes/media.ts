import type { FastifyInstance } from "fastify";
import { requireAuth } from "../auth.js";
import { presignUpload } from "../media.js";

export async function mediaRoutes(app: FastifyInstance) {
  // Hand the client a short-lived presigned PUT it uploads directly to.
  app.post<{ Body: { contentType?: string; contentLength?: number; prefix?: string } }>(
    "/media/presign",
    { preHandler: requireAuth },
    async (req, reply) => {
      const contentType = req.body?.contentType;
      const contentLength = req.body?.contentLength;
      if (!contentType) {
        return reply.code(400).send({ error: "CONTENT_TYPE_REQUIRED" });
      }
      if (contentLength == null) {
        return reply.code(400).send({ error: "CONTENT_LENGTH_REQUIRED" });
      }
      try {
        return await presignUpload({ contentType, contentLength, prefix: req.body?.prefix });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "PRESIGN_FAILED";
        const code = msg.startsWith("UNSUPPORTED_CONTENT_TYPE")
          ? 415
          : msg.startsWith("FILE_TOO_LARGE")
            ? 413
            : 400;
        return reply.code(code).send({ error: msg });
      }
    },
  );
}
