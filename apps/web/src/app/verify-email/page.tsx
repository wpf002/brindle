"use client";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { API } from "../../lib/api";
import { humanizeError, refreshMe } from "../../lib/session";

// Landing page for the link in the confirmation email. The token is consumed
// server-side on arrival — nothing for the reader to do but read the result.
function VerifyEmail() {
  const token = useSearchParams()?.get("token") ?? "";
  const [state, setState] = useState<"working" | "done" | "failed">("working");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) { setState("failed"); setError(humanizeError(new Error("TOKEN_REQUIRED"))); return; }
    void (async () => {
      try {
        const r = await fetch(`${API}/auth/verify-email`, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token }),
        });
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${r.status}`);
        }
        await refreshMe(); // the badge in the nav should update immediately
        setState("done");
      } catch (e) {
        setError(humanizeError(e));
        setState("failed");
      }
    })();
  }, [token]);

  return (
    <div className="signin-wrap">
      <h1>{state === "done" ? "Email confirmed" : "Confirming your email"}</h1>
      <div className="signin-card">
        {state === "working" && <p className="muted" style={{ margin: 0 }}>One moment…</p>}

        {state === "done" && (
          <>
            <p className="muted" style={{ margin: 0 }}>
              Thanks — your email address is confirmed. Buyers with a confirmed email and approved
              credit can bid in any sale on Brindle.
            </p>
            <Link href="/" className="btn btn-primary btn-lg" style={{ textAlign: "center" }}>
              Browse the sales
            </Link>
          </>
        )}

        {state === "failed" && (
          <>
            <div className="statusmsg rejected">{error}</div>
            <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>
              Confirmation links expire after 24 hours and only work once. Sign in and request a new
              one from your account page.
            </p>
            <Link href="/account" className="btn btn-primary btn-lg" style={{ textAlign: "center" }}>
              Go to my account
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

export default function Page() {
  // useSearchParams needs a Suspense boundary under the App Router.
  return (
    <Suspense fallback={<div className="signin-wrap"><h1>Confirming your email</h1></div>}>
      <VerifyEmail />
    </Suspense>
  );
}
