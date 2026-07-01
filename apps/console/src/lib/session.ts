"use client";
export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export function wsBase(): string {
  return API.replace(/^http/, "ws");
}

const KEY = "brindle_console_token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(KEY);
}
export function setToken(t: string): void {
  window.localStorage.setItem(KEY, t);
}
export function clearToken(): void {
  window.localStorage.removeItem(KEY);
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

/** Authenticated JSON request against the API using the stored seller token. */
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
