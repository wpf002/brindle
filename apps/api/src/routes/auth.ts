import type { FastifyInstance, FastifyRequest } from "fastify";
import { createHash, randomBytes } from "node:crypto";
import { prisma, CreditStatus, UserType, TokenPurpose, NotificationType } from "@brindle/db";
import {
  createSession, revokeSession, revokeAllSessions, requireAuth,
  setSessionCookie, clearSessionCookie, type Session,
} from "../auth.js";
import { hashPassword, verifyPassword, isPasswordStrongEnough } from "../password.js";
import { generateTotpSecret, verifyTotp, totpUri, generateRecoveryCode } from "../totp.js";
import { nextBuyerNumber } from "../buyers.js";
import { notify } from "../notify.js";
import { audit } from "../audit.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Per-account lockout, layered on top of the per-IP rate limit — that alone
// doesn't stop an attacker spreading guesses across many IPs.
const MAX_FAILED_LOGINS = 8;
const LOCKOUT_MINUTES = 15;

const EMAIL_TOKEN_TTL_HOURS = 24;
const RESET_TOKEN_TTL_MINUTES = 60;

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Issue a single-use token; only its hash is stored. */
async function issueToken(userId: string, purpose: TokenPurpose, ttlMs: number): Promise<string> {
  const raw = randomBytes(32).toString("hex");
  await prisma.authToken.create({
    data: {
      userId,
      purpose,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + ttlMs),
    },
  });
  return raw;
}

async function consumeToken(raw: string, purpose: TokenPurpose): Promise<string | null> {
  const row = await prisma.authToken.findUnique({ where: { tokenHash: hashToken(raw) } });
  if (!row || row.purpose !== purpose || row.usedAt || row.expiresAt.getTime() < Date.now()) {
    return null;
  }
  await prisma.authToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });
  return row.userId;
}

function clientMeta(req: FastifyRequest) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] };
}

async function sendVerificationEmail(userId: string, email: string): Promise<void> {
  const raw = await issueToken(userId, TokenPurpose.EMAIL_VERIFICATION, EMAIL_TOKEN_TTL_HOURS * 3600_000);
  const base = process.env.WEB_BASE_URL ?? "http://localhost:3010";
  await notify(
    userId,
    NotificationType.SYSTEM,
    "Confirm your email address",
    `Confirm ${email} to finish setting up your Brindle account:\n\n${base}/verify-email?token=${raw}\n\nThis link expires in ${EMAIL_TOKEN_TTL_HOURS} hours.`,
  );
}

export async function authRoutes(app: FastifyInstance) {
  // Rate limits on the credential endpoints, keyed on IP *and* the email being
  // attempted. A plain per-IP limit punishes shared connections — a sale barn
  // or ranch office where everyone is behind one address, and one person's
  // typos would lock out the room. Keying on the pair means an attacker still
  // can't grind a single account, and a busy office still works.
  //
  // This is the outer layer. The per-account lockout below is the one that
  // matters against an attacker spreading guesses across many IPs.
  const attemptKey = (req: FastifyRequest) => {
    const email = (req.body as { email?: string } | undefined)?.email?.trim().toLowerCase() ?? "";
    return `${req.ip}:${email}`;
  };
  const limitBody = () => ({ error: "TOO_MANY_ATTEMPTS" });

  const loginLimit = {
    config: {
      rateLimit: {
        max: 20,
        timeWindow: "10 minutes",
        keyGenerator: attemptKey,
        errorResponseBuilder: limitBody,
      },
    },
  };
  // Registration and reset are keyed on IP alone — there's no existing account
  // to scope them to, and both are cheap to abuse in bulk.
  const tightLimit = {
    config: { rateLimit: { max: 10, timeWindow: "10 minutes", errorResponseBuilder: limitBody } },
  };

  app.post<{
    Body: { email?: string; password?: string; legalName?: string; businessName?: string; type?: string; state?: string };
  }>("/auth/register", tightLimit, async (req, reply) => {
    const b = req.body ?? {};
    const email = b.email?.trim().toLowerCase();
    if (!email || !EMAIL_RE.test(email)) return reply.code(400).send({ error: "VALID_EMAIL_REQUIRED" });
    if (!b.password || !isPasswordStrongEnough(b.password)) {
      return reply.code(400).send({ error: "PASSWORD_TOO_SHORT" });
    }
    if (!b.legalName?.trim()) return reply.code(400).send({ error: "LEGAL_NAME_REQUIRED" });
    if (await prisma.user.findUnique({ where: { email } })) {
      return reply.code(409).send({ error: "EMAIL_ALREADY_REGISTERED" });
    }

    const allowed = ["BUYER", "SELLER_BREEDER", "GENETICS_PROVIDER", "RANCHER", "FEEDLOT", "ORDER_BUYER", "SALE_MANAGER"];
    const type = allowed.includes(b.type ?? "") ? (b.type as UserType) : UserType.BUYER;

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await hashPassword(b.password),
        type,
        legalName: b.legalName.trim(),
        businessName: b.businessName?.trim() || null,
        state: b.state?.trim() || null,
        creditStatus: CreditStatus.PENDING,
      },
    });

    await sendVerificationEmail(user.id, user.email);

    const { token, expiresAt } = await createSession(user.id, clientMeta(req));
    setSessionCookie(reply, token, expiresAt);
    return { token, emailVerificationSent: true };
  });

  app.post<{ Body: { email?: string; password?: string; totp?: string } }>(
    "/auth/login",
    loginLimit,
    async (req, reply) => {
      const email = req.body?.email?.trim().toLowerCase();
      const password = req.body?.password;
      if (!email || !password) return reply.code(400).send({ error: "EMAIL_AND_PASSWORD_REQUIRED" });

      const user = await prisma.user.findUnique({ where: { email } });

      // Uniform failure for unknown-user and wrong-password so the endpoint
      // can't be used to enumerate registered emails.
      if (!user?.passwordHash) return reply.code(401).send({ error: "INVALID_CREDENTIALS" });

      if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
        return reply.code(423).send({
          error: "ACCOUNT_LOCKED",
          retryAfterSeconds: Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000),
        });
      }

      if (!(await verifyPassword(password, user.passwordHash))) {
        const failed = user.failedLoginCount + 1;
        const lock = failed >= MAX_FAILED_LOGINS;
        await prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginCount: lock ? 0 : failed, // reset the counter when we lock
            lockedUntil: lock ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : user.lockedUntil,
          },
        });
        if (lock) {
          await notify(
            user.id,
            NotificationType.SYSTEM,
            "Too many failed sign-in attempts",
            `Your Brindle account was locked for ${LOCKOUT_MINUTES} minutes after repeated failed sign-ins. If that wasn't you, change your password.`,
          );
        }
        return reply.code(401).send({ error: "INVALID_CREDENTIALS" });
      }

      // Password is correct. If 2FA is on, the code is required in the same call.
      if (user.totpEnabledAt && user.totpSecret) {
        const submitted = req.body?.totp?.trim();
        if (!submitted) return reply.code(401).send({ error: "TOTP_REQUIRED" });

        const codeOk = verifyTotp(user.totpSecret, submitted);
        const recoveryOk =
          !codeOk && user.totpRecoveryHash
            ? await verifyPassword(submitted.toUpperCase(), user.totpRecoveryHash)
            : false;

        if (!codeOk && !recoveryOk) return reply.code(401).send({ error: "INVALID_TOTP" });

        if (recoveryOk) {
          // Recovery codes are single-use: burn it and turn 2FA off so the
          // user isn't locked out of an account they just proved they own.
          await prisma.user.update({
            where: { id: user.id },
            data: { totpRecoveryHash: null, totpEnabledAt: null, totpSecret: null },
          });
          await notify(
            user.id,
            NotificationType.SYSTEM,
            "Recovery code used — two-factor is now off",
            "You signed in with your recovery code, so two-factor authentication has been disabled. Set it up again from your account settings.",
          );
        }
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null },
      });

      const { token, expiresAt } = await createSession(user.id, clientMeta(req));
      setSessionCookie(reply, token, expiresAt);
      return { token };
    },
  );

  app.post("/auth/logout", async (req, reply) => {
    if (req.session) await revokeSession(req.session.sessionId);
    clearSessionCookie(reply);
    return { signedOut: true };
  });

  /** Sign out everywhere — the "I think my account is compromised" button. */
  app.post("/auth/logout-all", { preHandler: requireAuth }, async (req, reply) => {
    const revoked = await revokeAllSessions(req.session!.userId);
    clearSessionCookie(reply);
    return { revoked };
  });

  app.get("/auth/sessions", { preHandler: requireAuth }, async (req) => {
    const sessions = await prisma.session.findMany({
      where: { userId: req.session!.userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: "desc" },
      select: { id: true, createdAt: true, lastSeenAt: true, ip: true, userAgent: true },
    });
    return {
      sessions: sessions.map((s) => ({ ...s, current: s.id === req.session!.sessionId })),
    };
  });

  // ── email verification ───────────────────────────────────────
  app.post("/auth/resend-verification", { preHandler: requireAuth }, async (req, reply) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.session!.userId } });
    if (user.emailVerifiedAt) return reply.code(409).send({ error: "ALREADY_VERIFIED" });
    await sendVerificationEmail(user.id, user.email);
    return { sent: true };
  });

  app.post<{ Body: { token?: string } }>("/auth/verify-email", async (req, reply) => {
    const raw = req.body?.token;
    if (!raw) return reply.code(400).send({ error: "TOKEN_REQUIRED" });
    const userId = await consumeToken(raw, TokenPurpose.EMAIL_VERIFICATION);
    if (!userId) return reply.code(400).send({ error: "INVALID_OR_EXPIRED_TOKEN" });
    await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
    return { verified: true };
  });

  // ── password reset ───────────────────────────────────────────
  app.post<{ Body: { email?: string } }>("/auth/forgot-password", tightLimit, async (req) => {
    const email = req.body?.email?.trim().toLowerCase();
    if (email) {
      const user = await prisma.user.findUnique({ where: { email } });
      if (user) {
        const raw = await issueToken(user.id, TokenPurpose.PASSWORD_RESET, RESET_TOKEN_TTL_MINUTES * 60_000);
        const base = process.env.WEB_BASE_URL ?? "http://localhost:3010";
        await notify(
          user.id,
          NotificationType.SYSTEM,
          "Reset your Brindle password",
          `Reset your password here:\n\n${base}/reset-password?token=${raw}\n\nThis link expires in ${RESET_TOKEN_TTL_MINUTES} minutes. If you didn't ask for this, ignore it.`,
        );
      }
    }
    // Always the same response — never reveal whether an email is registered.
    return { sent: true };
  });

  app.post<{ Body: { token?: string; password?: string } }>("/auth/reset-password", tightLimit, async (req, reply) => {
    const { token: raw, password } = req.body ?? {};
    if (!raw || !password) return reply.code(400).send({ error: "TOKEN_AND_PASSWORD_REQUIRED" });
    if (!isPasswordStrongEnough(password)) return reply.code(400).send({ error: "PASSWORD_TOO_SHORT" });

    const userId = await consumeToken(raw, TokenPurpose.PASSWORD_RESET);
    if (!userId) return reply.code(400).send({ error: "INVALID_OR_EXPIRED_TOKEN" });

    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(password), failedLoginCount: 0, lockedUntil: null },
    });
    // A password change invalidates every existing session — that's the whole
    // point of being able to reset it.
    const revoked = await revokeAllSessions(userId);
    clearSessionCookie(reply);
    return { reset: true, sessionsRevoked: revoked };
  });

  app.post<{ Body: { currentPassword?: string; newPassword?: string } }>(
    "/auth/change-password",
    { preHandler: requireAuth },
    async (req, reply) => {
      const { currentPassword, newPassword } = req.body ?? {};
      if (!currentPassword || !newPassword) return reply.code(400).send({ error: "BOTH_PASSWORDS_REQUIRED" });
      if (!isPasswordStrongEnough(newPassword)) return reply.code(400).send({ error: "PASSWORD_TOO_SHORT" });

      const user = await prisma.user.findUniqueOrThrow({ where: { id: req.session!.userId } });
      if (!user.passwordHash || !(await verifyPassword(currentPassword, user.passwordHash))) {
        return reply.code(401).send({ error: "INVALID_CREDENTIALS" });
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(newPassword) },
      });
      await revokeAllSessions(user.id);

      // Keep the caller signed in on this device with a fresh session.
      const { token, expiresAt } = await createSession(user.id, clientMeta(req));
      setSessionCookie(reply, token, expiresAt);
      return { changed: true, token };
    },
  );

  // ── two-factor ───────────────────────────────────────────────
  app.post("/auth/2fa/start", { preHandler: requireAuth }, async (req, reply) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.session!.userId } });
    if (user.totpEnabledAt) return reply.code(409).send({ error: "TOTP_ALREADY_ENABLED" });

    // Stored but not yet active — enrollment only completes once the user
    // proves they can generate a code from it.
    const secret = generateTotpSecret();
    await prisma.user.update({ where: { id: user.id }, data: { totpSecret: secret } });
    return { secret, uri: totpUri(secret, user.email) };
  });

  app.post<{ Body: { code?: string } }>("/auth/2fa/confirm", { preHandler: requireAuth }, async (req, reply) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.session!.userId } });
    if (!user.totpSecret) return reply.code(409).send({ error: "TOTP_NOT_STARTED" });
    if (!req.body?.code || !verifyTotp(user.totpSecret, req.body.code)) {
      return reply.code(401).send({ error: "INVALID_TOTP" });
    }

    const recovery = generateRecoveryCode();
    await prisma.user.update({
      where: { id: user.id },
      data: { totpEnabledAt: new Date(), totpRecoveryHash: await hashPassword(recovery) },
    });
    await audit(req, "auth.2fa.enable", { type: "user", id: user.id });

    // Shown exactly once — we only keep the hash.
    return { enabled: true, recoveryCode: recovery };
  });

  app.post<{ Body: { password?: string } }>("/auth/2fa/disable", { preHandler: requireAuth }, async (req, reply) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.session!.userId } });
    if (!req.body?.password || !user.passwordHash || !(await verifyPassword(req.body.password, user.passwordHash))) {
      return reply.code(401).send({ error: "INVALID_CREDENTIALS" });
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { totpEnabledAt: null, totpSecret: null, totpRecoveryHash: null },
    });
    await audit(req, "auth.2fa.disable", { type: "user", id: user.id });
    return { disabled: true };
  });

  // ── dev-only convenience sign-in ─────────────────────────────
  app.post<{ Body: { email?: string; name?: string } }>("/auth/dev-login", async (req, reply) => {
    if (process.env.NODE_ENV === "production") return reply.code(404).send({ error: "NOT_FOUND" });

    const email = req.body?.email?.trim().toLowerCase();
    if (!email) return reply.code(400).send({ error: "EMAIL_REQUIRED" });

    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      const issued = await prisma.user.findMany({
        where: { buyerNumber: { not: null } },
        select: { buyerNumber: true },
      });
      const name = req.body?.name?.trim() || email.split("@")[0]!;
      user = await prisma.user.create({
        data: {
          email,
          type: UserType.BUYER,
          legalName: name,
          businessName: name,
          creditStatus: CreditStatus.APPROVED,
          creditLimitCents: 5_000_000n,
          emailVerifiedAt: new Date(),
          buyerNumber: nextBuyerNumber(issued.map((u) => u.buyerNumber).filter((n): n is string => n !== null)),
        },
      });
    }

    const { token, expiresAt } = await createSession(user.id, clientMeta(req));
    setSessionCookie(reply, token, expiresAt);
    return { token };
  });

  app.get("/auth/me", { preHandler: requireAuth }, async (req, reply) => {
    const user = await prisma.user.findUnique({
      where: { id: req.session!.userId },
      select: {
        id: true, type: true, email: true, legalName: true, businessName: true,
        buyerNumber: true, creditStatus: true, sellerVerified: true,
        emailVerifiedAt: true, idVerifiedAt: true, stripeOnboardedAt: true,
        stripeAccountId: true, totpEnabledAt: true, adminRole: true,
      },
    });
    if (!user) return reply.code(404).send({ error: "USER_NOT_FOUND" });

    const session: Session = req.session!;
    return {
      session,
      account: {
        email: user.email,
        legalName: user.legalName,
        businessName: user.businessName,
        sellerVerified: user.sellerVerified,
        emailVerified: user.emailVerifiedAt != null,
        identityVerified: user.idVerifiedAt != null,
        stripeConnected: user.stripeAccountId != null,
        stripeOnboarded: user.stripeOnboardedAt != null,
        twoFactorEnabled: user.totpEnabledAt != null,
        adminRole: user.adminRole,
      },
    };
  });
}
