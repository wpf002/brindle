import { SignJWT, jwtVerify } from "jose";
import fp from "fastify-plugin";
import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma, CreditStatus, AdminRole } from "@brindle/db";

// Sessions are server-side records; the JWT is only a signed pointer to one.
// That makes revocation real — signing out, changing a password, or being
// suspended takes effect on the very next request instead of waiting up to
// 12 hours for a self-contained token to expire.
//
// The token rides in an httpOnly cookie so page JavaScript can't read it (an
// XSS then can't exfiltrate a session). A Bearer header is still accepted for
// API clients and tooling.

export const SESSION_TTL_HOURS = 12;
export const SESSION_COOKIE = "brindle_session";

export interface Session {
  userId: string;
  sessionId: string;
  type: string;
  buyerNumber: string | null;
  creditApproved: boolean;
  adminRole: AdminRole | null;
  emailVerified: boolean;
  totpEnabled: boolean;
}

function secret(): Uint8Array {
  const s = process.env.JWT_SECRET;
  if (!s || s === "change-me-in-prod") {
    if (process.env.NODE_ENV === "production") {
      throw new Error("JWT_SECRET must be set to a real value in production");
    }
  }
  return new TextEncoder().encode(s ?? "dev-insecure-secret");
}

/** Create a session row and return the signed token that points at it. */
export async function createSession(
  userId: string,
  meta: { ip?: string; userAgent?: string } = {},
): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000);
  const row = await prisma.session.create({
    data: { userId, expiresAt, ip: meta.ip, userAgent: meta.userAgent?.slice(0, 500) },
  });

  const token = await new SignJWT({ sid: row.id })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_HOURS}h`)
    .sign(secret());

  return { token, sessionId: row.id, expiresAt };
}

export async function revokeSession(sessionId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Revoke every live session for a user — used on password change and suspension. */
export async function revokeAllSessions(userId: string): Promise<number> {
  const { count } = await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return count;
}

/**
 * Resolve a raw token to a live session. Returns null if the signature is bad,
 * the session row is gone, revoked, or expired — so any of those immediately
 * de-authenticates the caller.
 */
export async function resolveSession(token: string): Promise<Session | null> {
  let sessionId: string;
  try {
    const { payload } = await jwtVerify(token, secret());
    sessionId = String(payload.sid ?? "");
    if (!sessionId) return null;
  } catch {
    return null;
  }

  const row = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      user: {
        select: {
          id: true, type: true, buyerNumber: true, creditStatus: true,
          adminRole: true, emailVerifiedAt: true, totpEnabledAt: true,
        },
      },
    },
  });
  if (!row || row.revokedAt || row.expiresAt.getTime() < Date.now()) return null;

  return {
    userId: row.user.id,
    sessionId: row.id,
    type: row.user.type,
    // Read live from the user row every request, so credit approval and
    // suspension are never stale.
    buyerNumber: row.user.buyerNumber,
    creditApproved: row.user.creditStatus === CreditStatus.APPROVED,
    adminRole: row.user.adminRole,
    emailVerified: row.user.emailVerifiedAt != null,
    totpEnabled: row.user.totpEnabledAt != null,
  };
}

// Cookie first (browser), then Bearer (API clients), then the `token` query
// param — which only WebSocket upgrades from older clients should use.
function extractToken(req: FastifyRequest): string | null {
  const cookie = req.cookies?.[SESSION_COOKIE];
  if (cookie) return cookie;

  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7);

  const q = (req.query as Record<string, unknown> | undefined)?.token;
  return typeof q === "string" ? q : null;
}

export function sessionCookieOptions(expiresAt: Date) {
  const prod = process.env.NODE_ENV === "production";
  return {
    httpOnly: true, // page JS can never read it
    secure: prod, // HTTPS-only in production
    sameSite: "lax" as const, // API and web share a registrable domain
    path: "/",
    expires: expiresAt,
  };
}

export function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date): void {
  reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

declare module "fastify" {
  interface FastifyRequest {
    session: Session | null;
  }
}

export const authPlugin = fp(async (app) => {
  app.decorateRequest("session", null);

  app.addHook("onRequest", async (req) => {
    const token = extractToken(req);
    req.session = token ? await resolveSession(token) : null;
  });
});

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  if (!req.session) {
    await reply.code(401).send({ error: "UNAUTHENTICATED" });
  }
}

const ROLE_RANK: Record<AdminRole, number> = {
  [AdminRole.SUPPORT]: 1,
  [AdminRole.OPERATOR]: 2,
  [AdminRole.OWNER]: 3,
};

/**
 * Gate a route on a minimum back-office role. Replaces the single shared
 * ADMIN_API_TOKEN: every privileged action now belongs to a named human whose
 * id lands in the audit log.
 */
export function requireAdminRole(min: AdminRole) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const role = req.session?.adminRole;
    if (!role || ROLE_RANK[role] < ROLE_RANK[min]) {
      await reply.code(403).send({ error: "FORBIDDEN" });
    }
  };
}

/** Read-only back-office access. */
export const requireAdmin = requireAdminRole(AdminRole.SUPPORT);
/** Actions that change money or access. */
export const requireOperator = requireAdminRole(AdminRole.OPERATOR);
/** Managing other admins. */
export const requireOwner = requireAdminRole(AdminRole.OWNER);
