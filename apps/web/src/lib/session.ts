"use client";
import { API } from "./api";

// Client-side session: a JWT in localStorage. Dev sign-in mints (and provisions)
// an account via /auth/dev-login; real identity/credit onboarding replaces this.
const KEY = "brindle_token";
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
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(KEY);
}

export function setToken(token: string): void {
  window.localStorage.setItem(KEY, token);
  window.dispatchEvent(new Event(EVENT));
}

export function clearToken(): void {
  window.localStorage.removeItem(KEY);
  window.dispatchEvent(new Event(EVENT));
}

export function onAuthChange(fn: () => void): () => void {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}

export async function getSession(): Promise<Session | null> {
  const token = getToken();
  if (!token) return null;
  try {
    const r = await fetch(`${API}/auth/me`, { headers: { authorization: `Bearer ${token}` } });
    if (!r.ok) return null;
    return (await r.json()).session as Session;
  } catch {
    return null;
  }
}

/** Session plus live account/verification state in one round trip. */
export async function getMe(): Promise<{ session: Session; account: Account } | null> {
  const token = getToken();
  if (!token) return null;
  try {
    const r = await fetch(`${API}/auth/me`, { headers: { authorization: `Bearer ${token}` } });
    if (!r.ok) return null;
    return (await r.json()) as { session: Session; account: Account };
  } catch {
    return null;
  }
}

/** Authenticated JSON request using the stored token. */
export async function authed<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const r = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      // Only claim a JSON body when we're actually sending one — Fastify
      // rejects an empty payload that declares content-type: application/json,
      // which broke every bodyless POST (verify identity, mark-read, watch).
      ...(init.body != null ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
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

/** Sign in with real credentials. Throws an API error code on failure. */
export async function login(email: string, password: string): Promise<void> {
  const r = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${r.status}`);
  }
  setToken((await r.json()).token);
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
  const r = await fetch(`${API}/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${r.status}`);
  }
  setToken((await r.json()).token);
}

/** Dev-only convenience sign-in; the API disables this outside development. */
export async function devSignIn(email: string): Promise<boolean> {
  const r = await fetch(`${API}/auth/dev-login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!r.ok) return false;
  const { token } = await r.json();
  setToken(token);
  return true;
}
