import type { FastifyInstance } from "fastify";
import { requireAuth } from "../auth.js";
import { presignUpload, verifyUpload } from "../media.js";

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

  // Call after the PUT completes. The presigned URL signs the declared type,
  // not the bytes, so this is where we find out whether the file is actually a
  // photo. A key that hasn't passed here should never be attached to a lot.
  app.post<{ Body: { key?: string; contentType?: string } }>(
    "/media/confirm",
    { preHandler: requireAuth },
    async (req, reply) => {
      const { key, contentType } = req.body ?? {};
      if (!key) return reply.code(400).send({ error: "KEY_REQUIRED" });
      if (!contentType) return reply.code(400).send({ error: "CONTENT_TYPE_REQUIRED" });

      try {
        const result = await verifyUpload(key, contentType);
        if (!result.ok) {
          // The object is already deleted; tell the client plainly.
          return reply.code(415).send({ error: "CONTENT_MISMATCH", detected: result.contentType });
        }
        return { key: result.key, contentType: result.contentType, verified: true };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "VERIFY_FAILED";
        const code = msg.startsWith("UNSUPPORTED_CONTENT_TYPE")
          ? 415
          : msg === "OBJECT_NOT_FOUND"
            ? 404
            : 400;
        return reply.code(code).send({ error: msg });
      }
    },
  );
}
