import type { FastifyRequest } from "fastify";
import { prisma, Prisma } from "@brindle/db";

// Append-only trail of privileged actions. The shared admin token had no
// notion of *who* approved a credit line or resolved a dispute; every
// back-office mutation now names a person.
export async function audit(
  req: FastifyRequest,
  action: string,
  target?: { type: string; id: string },
  detail?: Record<string, unknown>,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: req.session?.userId ?? null,
        action,
        targetType: target?.type ?? null,
        targetId: target?.id ?? null,
        detail: (detail ?? undefined) as Prisma.InputJsonValue | undefined,
        ip: req.ip,
      },
    });
  } catch {
    // Never let audit logging break the action it's recording. A failure here
    // is itself captured by the global error reporter via the request log.
  }
}
