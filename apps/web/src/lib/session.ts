"use client";
import { API } from "./api";

// Minimal client-side session: a JWT in localStorage. Dev sign-in mints one via
// /auth/dev-login; real identity/credit onboarding replaces this in production.
const KEY = "brindle_token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(KEY);
}

export function setToken(token: string): void {
  window.localStorage.setItem(KEY, token);
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
