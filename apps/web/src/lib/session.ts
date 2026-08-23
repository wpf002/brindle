"use client";
import { API } from "./api";

// Client-side session state.
//
// The session token itself lives in an httpOnly cookie the API sets — page JS
// can't read it, so an XSS bug can't lift a session and replay it elsewhere.
// The cost is that "am I signed in?" is no longer a synchronous localStorage
// read; it's whatever /auth/me last told us. So we cache that answer here,
// dedupe concurrent loads, and invalidate on sign-in/sign-out.
//
// Every request goes out with `credentials: "include"` so the cookie rides
// along cross-origin (the API and web app share a registrable domain, which is
// what makes the SameSite=Lax cookie work).

const EVENT = "brindle-auth";

export interface Session {
  userId: string;
  type: string;
  buyerNumber: string | null;
  creditApproved: boolean;
}

/** Live account state from /auth/me — verification and onboarding progress. */
export interface Account {
  email: string;
  legalName: string;
  businessName: string | null;
  sellerVerified: boolean;
  emailVerified: boolean;
  identityVerified: boolean;
  stripeConnected: boolean;
  stripeOnboarded: boolean;
  twoFactorEnabled: boolean;
  adminRole: string | null;
}

export interface Me {
  session: Session;
  account: Account;
}

// `undefined` means "not loaded yet", `null` means "loaded, signed out".
let cached: Me | null | undefined;
let inFlight: Promise<Me | null> | null = null;

function invalidate(): void {
  cached = undefined;
  inFlight = null;
  window.dispatchEvent(new Event(EVENT));
}

export function onAuthChange(fn: () => void): () => void {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}

/**
 * The current account, from cache when we have it. Concurrent callers share
 * one request — several components mount at once and would otherwise each fire
 * their own /auth/me.
 */
export async function getMe(): Promise<Me | null> {
  if (cached !== undefined) return cached;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const r = await fetch(`${API}/auth/me`, { credentials: "include" });
      cached = r.ok ? ((await r.json()) as Me) : null;
    } catch {
      cached = null;
    } finally {
      inFlight = null;
    }
    return cached;
  })();

  return inFlight;
}

/** Force a re-read — after verifying email, connecting Stripe, enabling 2FA. */
export async function refreshMe(): Promise<Me | null> {
  cached = undefined;
  inFlight = null;
  return getMe();
}

export async function getSession(): Promise<Session | null> {
  return (await getMe())?.session ?? null;
}

/** Is anyone signed in? Async now that the token is out of reach of JS. */
export async function isSignedIn(): Promise<boolean> {
  return (await getMe()) != null;
}

/** Authenticated JSON request. The session cookie is sent automatically. */
export async function authed<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${API}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      // Only claim a JSON body when we're actually sending one — Fastify
      // rejects an empty payload that declares content-type: application/json,
      // which broke every bodyless POST (verify identity, mark-read, watch).
      ...(init.body != null ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${r.status}`);
  }
  return r.json();
}

const ERROR_TEXT: Record<string, string> = {
  INVALID_CREDENTIALS: "That email and password don't match an account.",
  EMAIL_ALREADY_REGISTERED: "There's already an account with that email — try signing in.",
  PASSWORD_TOO_SHORT: "Use at least 8 characters for your password.",
  VALID_EMAIL_REQUIRED: "Enter a valid email address.",
  LEGAL_NAME_REQUIRED: "Enter your name or ranch name.",
  EMAIL_AND_PASSWORD_REQUIRED: "Enter both your email and password.",
  ACCOUNT_LOCKED: "Too many failed sign-ins. Try again in about 15 minutes.",
  TOO_MANY_ATTEMPTS: "Too many attempts from here. Give it a few minutes and try again.",
  TOTP_REQUIRED: "Enter the six-digit code from your authenticator app.",
  INVALID_TOTP: "That code didn't work. Codes change every 30 seconds — try the current one.",
  TOTP_ALREADY_ENABLED: "Two-factor is already on for this account.",
  TOTP_NOT_STARTED: "Start the two-factor setup again to get a fresh code.",
  TOKEN_REQUIRED: "That link is missing its confirmation code.",
  INVALID_OR_EXPIRED_TOKEN: "That link has expired or was already used. Request a new one.",
  TOKEN_AND_PASSWORD_REQUIRED: "Enter a new password.",
  BOTH_PASSWORDS_REQUIRED: "Enter your current password and the new one.",
  ALREADY_VERIFIED: "Your email is already confirmed.",
  CONTENT_MISMATCH: "That file isn't the format it claims to be — re-export it and try again.",
  STRIPE_NOT_CONFIGURED: "Payouts aren't configured on this environment yet.",
  CSV_REQUIRED: "Paste your catalog CSV first.",
  NOT_A_PARTY_TO_THIS_LOT: "Only the buyer and seller of this lot can see its delivery details.",
  NAME_AND_START_REQUIRED: "Give the auction a name and a start time.",
  MISSING_REQUIRED_LOT_FIELDS: "Fill in the lot number, category, price unit, and opening bid.",
  NOT_AUCTION_SELLER: "That auction belongs to a different seller account.",
  AUCTION_NOT_FOUND: "That auction doesn't exist anymore — refresh and try again.",
  NAME_LOCATION_DESCRIPTION_REQUIRED: "Give the operation a name, location, and short description.",
  OPERATION_NOT_FOUND: "That operation was already removed.",
  NOT_YOUR_OPERATION: "That operation belongs to a different seller account.",
  LOT_NOT_FOUND: "That lot doesn't exist anymore — refresh and try again.",
  NOT_LOT_SELLER: "That lot belongs to a different seller account.",
  SELLER_NOT_FOUND: "We couldn't find that seller.",
  UNAUTHENTICATED: "Sign in to do that.",
};

/** Turn a thrown error (often a raw API error code) into copy a seller can act on. */
export function humanizeError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return ERROR_TEXT[raw] ?? "Something went wrong — please try again.";
}

const OPEN_SIGNIN_EVENT = "brindle-open-signin";

/** Ask the nav to open its sign-in modal (used by in-page "sign in to bid" CTAs). */
export function openSignIn(): void {
  window.dispatchEvent(new Event(OPEN_SIGNIN_EVENT));
}

export function onOpenSignIn(fn: () => void): () => void {
  window.addEventListener(OPEN_SIGNIN_EVENT, fn);
  return () => window.removeEventListener(OPEN_SIGNIN_EVENT, fn);
}

async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
  const r = await fetch(`${API}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const parsed = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new Error((parsed.error as string) ?? `HTTP ${r.status}`);
  return parsed;
}

/**
 * Sign in. Throws the API's error code, which the caller maps to copy —
 * `TOTP_REQUIRED` in particular is a prompt, not a failure: the form re-submits
 * with the code filled in.
 */
export async function login(email: string, password: string, totp?: string): Promise<void> {
  await post("/auth/login", { email, password, totp: totp || undefined });
  invalidate();
}

export interface RegisterInput {
  email: string;
  password: string;
  legalName: string;
  businessName?: string;
  type?: string;
  state?: string;
}

export async function register(input: RegisterInput): Promise<void> {
  await post("/auth/register", input);
  invalidate();
}

export async function signOut(): Promise<void> {
  await post("/auth/logout", {}).catch(() => undefined); // clear locally regardless
  cached = null;
  inFlight = null;
  window.dispatchEvent(new Event(EVENT));
}

/** Dev-only convenience sign-in; the API disables this outside development. */
export async function devSignIn(email: string): Promise<boolean> {
  try {
    await post("/auth/dev-login", { email });
  } catch {
    return false;
  }
  invalidate();
  return true;
}
