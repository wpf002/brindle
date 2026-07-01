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

/** Authenticated JSON request using the stored token. */
export async function authed<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const r = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
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

export function openSignIn(): void {
  document.querySelector<HTMLButtonElement>(".nav-user .btn-primary")?.click();
}

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
