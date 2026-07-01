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
