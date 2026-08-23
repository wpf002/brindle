"use client";
import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { API } from "../../lib/api";
import { humanizeError } from "../../lib/session";

function ResetPassword() {
  const token = useSearchParams()?.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const mismatch = confirm.length > 0 && password !== confirm;
  const canSubmit = Boolean(token) && password.length >= 8 && !mismatch;

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`${API}/auth/reset-password`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${r.status}`);
      }
      setDone(true);
    } catch (e) {
      setError(humanizeError(e));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="signin-wrap">
        <h1>Password changed</h1>
        <div className="signin-card">
          <p className="muted" style={{ margin: 0 }}>
            Your new password is set. Everywhere you were signed in has been signed out — that&rsquo;s
            the point of a reset. Sign in again with the new password.
          </p>
          <Link href="/" className="btn btn-primary btn-lg" style={{ textAlign: "center" }}>
            Back to the sales
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="signin-wrap">
      <h1>Choose a new password</h1>
      <div className="signin-card">
        {!token && (
          <div className="statusmsg rejected">
            That link is missing its confirmation code. Request a fresh one.
          </div>
        )}

        <label className="field">
          <span className="label">New password</span>
          <input className="input" type="password" value={password} autoFocus
            placeholder="At least 8 characters"
            onChange={(e) => setPassword(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Confirm new password</span>
          <input className="input" type="password" value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && canSubmit && submit()} />
          {mismatch && <span className="dim" style={{ fontSize: 12 }}>Those don&rsquo;t match yet.</span>}
        </label>

        {error && <div className="statusmsg rejected">{error}</div>}

        <button className="btn btn-primary btn-lg" onClick={submit} disabled={busy || !canSubmit}>
          {busy ? "Saving…" : "Set new password"}
        </button>

        <p className="muted" style={{ fontSize: 13, textAlign: "center", margin: 0 }}>
          Link expired? <Link href="/forgot-password" className="btn-link" style={{ fontSize: "inherit" }}>
            Request a new one
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="signin-wrap"><h1>Choose a new password</h1></div>}>
      <ResetPassword />
    </Suspense>
  );
}
