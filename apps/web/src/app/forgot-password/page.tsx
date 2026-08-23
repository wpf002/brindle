"use client";
import Link from "next/link";
import { useState } from "react";
import { API } from "../../lib/api";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit() {
    setBusy(true);
    // The API answers identically whether or not the address is registered, so
    // there's nothing to branch on here — and nothing this page could leak
    // about who has an account.
    await fetch(`${API}/auth/forgot-password`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: email.trim() }),
    }).catch(() => undefined);
    setBusy(false);
    setSent(true);
  }

  return (
    <div className="signin-wrap">
      <h1>Reset your password</h1>
      <div className="signin-card">
        {sent ? (
          <>
            <p className="muted" style={{ margin: 0 }}>
              If there&rsquo;s an account for <strong>{email.trim()}</strong>, a reset link is on its
              way. It expires in an hour.
            </p>
            <Link href="/" className="btn btn-primary btn-lg" style={{ textAlign: "center" }}>
              Back to the sales
            </Link>
          </>
        ) : (
          <>
            <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>
              Enter the email on your account and we&rsquo;ll send you a link to set a new password.
            </p>
            <label className="field">
              <span className="label">Email</span>
              <input className="input" type="email" value={email} autoFocus
                placeholder="you@ranch.com"
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && email.trim() && submit()} />
            </label>
            <button className="btn btn-primary btn-lg" onClick={submit} disabled={busy || !email.trim()}>
              {busy ? "Sending…" : "Send reset link"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
