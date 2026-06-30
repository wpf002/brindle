import { SignJWT, jwtVerify } from "jose";
import fp from "fastify-plugin";
import type { FastifyReply, FastifyRequest } from "fastify";

// JWT-backed sessions. Identity verification (Persona / Stripe Identity) and the
// credit gate are Phase 1; this layer is the session plumbing they hang off of.
// One signing secret, HS256, short-lived tokens. No refresh tokens yet — buyers
// re-auth rather than us holding a long-lived credential before identity is real.

const SESSION_TTL = "12h";

export interface Session {
  userId: string;
  type: string; // UserType — kept loose here so the API needn't import the Prisma enum
  buyerNumber: string | null;
  creditApproved: boolean;
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

export async function signSession(session: Session): Promise<string> {
  return new SignJWT({ ...session })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.userId)
    .setIssuedAt()
    .setExpirationTime(SESSION_TTL)
    .sign(secret());
}

export async function verifySession(token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    return {
      userId: String(payload.sub),
      type: String(payload.type ?? ""),
      buyerNumber: (payload.buyerNumber as string | null) ?? null,
      creditApproved: Boolean(payload.creditApproved),
    };
  } catch {
    return null;
  }
}

// Pull a token from the Authorization header (REST) or the `token` query param
// (WebSocket handshakes can't set headers from the browser).
function extractToken(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7);
  const q = (req.query as Record<string, unknown> | undefined)?.token;
  return typeof q === "string" ? q : null;
}

declare module "fastify" {
  interface FastifyRequest {
    session: Session | null;
  }
}

// Decorates every request with `session` (null when unauthenticated) and exposes
// a `requireAuth` preHandler for protected routes.
export const authPlugin = fp(async (app) => {
  app.decorateRequest("session", null);

  app.addHook("onRequest", async (req) => {
    const token = extractToken(req);
    req.session = token ? await verifySession(token) : null;
  });
});

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  if (!req.session) {
    await reply.code(401).send({ error: "UNAUTHENTICATED" });
  }
}
