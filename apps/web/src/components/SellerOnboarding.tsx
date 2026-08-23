"use client";
import { useCallback, useEffect, useState } from "react";
import { authed, getMe, humanizeError, type Account } from "../lib/session";

// The seller's path to actually taking money: verify identity, connect Stripe.
// Shown as a checklist because "why can't I sell yet?" is otherwise invisible.
export function SellerOnboarding() {
  const [account, setAccount] = useState<Account | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const me = await getMe();
    setAccount(me?.account ?? null);
  }, []);

  useEffect(() => {
    void load();
    // Stripe bounces back here with ?stripe=return once onboarding finishes.
    if (typeof window !== "undefined" && window.location.search.includes("stripe=")) {
      void authed("/console/stripe/status").then(load).catch(() => {});
    }
  }, [load]);

  async function startStripe() {
    setBusy("stripe");
    setError("");
    try {
      const r = await authed<{ url: string }>("/console/stripe/onboard", { method: "POST" });
      window.location.href = r.url;
    } catch (e) {
      setError(humanizeError(e));
      setBusy(null);
    }
  }

  async function startIdentity() {
    setBusy("identity");
    setError("");
    try {
      const r = await authed<{ inquiryUrl: string; ref: string }>("/identity/start", { method: "POST" });
      if (r.inquiryUrl.startsWith("/identity/dev-approve")) {
        // Dev provider: no hosted flow to visit, so complete it inline.
        await authed(`/identity/dev-approve?ref=${encodeURIComponent(r.ref)}`, { method: "POST" });
        await load();
      } else {
        window.location.href = r.inquiryUrl;
      }
    } catch (e) {
      setError(humanizeError(e));
    } finally {
      setBusy(null);
    }
  }

  if (!account) return null;

  const steps = [
    {
      key: "identity",
      done: account.identityVerified,
      title: "Verify your identity",
      body: account.identityVerified
        ? "Verified."
        : "Required before money moves. Takes a couple of minutes.",
      action: account.identityVerified ? null : (
        <button className="btn btn-ghost btn-sm" onClick={startIdentity} disabled={busy === "identity"}>
          {busy === "identity" ? "Starting…" : "Verify"}
        </button>
      ),
    },
    {
      key: "stripe",
      done: account.stripeOnboarded,
      title: "Connect payouts",
      body: account.stripeOnboarded
        ? "Stripe account connected — you can accept payment on genetics lots."
        : account.stripeConnected
          ? "Stripe setup started but not finished."
          : "Connect a Stripe account so buyers can pay you through Brindle.",
      action: account.stripeOnboarded ? null : (
        <button className="btn btn-ghost btn-sm" onClick={startStripe} disabled={busy === "stripe"}>
          {busy === "stripe" ? "Opening…" : account.stripeConnected ? "Finish setup" : "Connect Stripe"}
        </button>
      ),
    },
  ];

  const remaining = steps.filter((s) => !s.done).length;
  if (remaining === 0) return null; // nothing left to nag about

  return (
    <div className="card-form">
      <h2>Before you can sell</h2>
      <p className="block-note" style={{ marginTop: -10 }}>
        {remaining === 1 ? "One step left." : `${remaining} steps left.`}
      </p>
      {error && <div className="statusmsg rejected" style={{ marginBottom: 12 }}>{error}</div>}
      <div className="checklist">
        {steps.map((s) => (
          <div key={s.key} className={`check-row ${s.done ? "done" : ""}`}>
            <span className="check-mark">{s.done ? "✓" : ""}</span>
            <div className="check-body">
              <strong>{s.title}</strong>
              <span>{s.body}</span>
            </div>
            {s.action}
          </div>
        ))}
      </div>
    </div>
  );
}
