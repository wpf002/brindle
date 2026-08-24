"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  getSession, login, register, signOut, onAuthChange, onOpenSignIn, humanizeError, type Session,
} from "../lib/session";
import { NotificationBell } from "./NotificationBell";

type Mode = "signin" | "register";

export function Nav() {
  const path = usePathname() ?? "/";
  const [session, setSession] = useState<Session | null>(null);
  const [modal, setModal] = useState<Mode | null>(null);

  const refresh = () => void getSession().then(setSession);
  useEffect(() => {
    refresh();
    const offAuth = onAuthChange(refresh);
    const offOpen = onOpenSignIn(() => setModal("signin"));
    return () => { offAuth(); offOpen(); };
  }, []);

  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  return (
    <>
      <nav className="nav">
        <div className="nav-inner">
          <Link href="/" className="brand">Brindle<span className="dot">.</span></Link>
          <div className="nav-links">
            <Link href="/" className={`nav-link ${isActive("/") ? "active" : ""}`}>Auctions</Link>
            <Link href="/market" className={`nav-link ${isActive("/market") ? "active" : ""}`}>Market</Link>
            <Link href="/news" className={`nav-link ${isActive("/news") ? "active" : ""}`}>News</Link>
            <Link href="/sell" className={`nav-link ${isActive("/sell") ? "active" : ""}`}>Sell</Link>
          </div>
          <div className="nav-spacer" />
          <div className="nav-user">
            {session ? (
              <>
                <Link href="/watchlist" className="nav-link">Watchlist</Link>
                <NotificationBell />
                <span className="chip">
                  {session.buyerNumber
                    ? <span className="num">{session.buyerNumber}</span>
                    : <span className="num">Credit Pending</span>}
                  {session.creditApproved && (
                    <span className="pill live" style={{ padding: "1px 7px" }}>Approved</span>
                  )}
                </span>
                <Link href="/account" className="nav-link">Account</Link>
                <button className="btn-link" onClick={() => void signOut()}>Sign Out</button>
              </>
            ) : (
              <>
                <button className="btn-link" onClick={() => setModal("signin")}>Sign In</button>
                <button className="btn btn-primary btn-sm" onClick={() => setModal("register")}>
                  Create Account
                </button>
              </>
            )}
          </div>
        </div>
      </nav>

      {modal && <AuthModal mode={modal} onMode={setModal} onClose={() => setModal(null)} />}
    </>
  );
}

function AuthModal({
  mode, onMode, onClose,
}: { mode: Mode; onMode: (m: Mode) => void; onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [legalName, setLegalName] = useState("");
  const [accountType, setAccountType] = useState("BUYER");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The API answers TOTP_REQUIRED when 2FA is on — a prompt, not a failure.
  // We keep the password in state and re-submit it with the code.
  const [totp, setTotp] = useState("");
  const [needsTotp, setNeedsTotp] = useState(false);

  async function submit() {
    setBusy(true);
    setError("");
    try {
      if (mode === "signin") {
        await login(email.trim(), password, totp.trim() || undefined);
      } else {
        await register({ email: email.trim(), password, legalName: legalName.trim(), type: accountType });
      }
      onClose();
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      if (code === "TOTP_REQUIRED") {
        setNeedsTotp(true);
        setError(""); // asking for a second factor isn't an error to shout about
      } else {
        if (code === "INVALID_TOTP") setTotp("");
        setError(humanizeError(e));
      }
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = mode === "signin"
    ? Boolean(email.trim() && password && (!needsTotp || totp.trim().length >= 6))
    : Boolean(email.trim() && password && legalName.trim());

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(33,29,24,.45)", zIndex: 100,
        display: "grid", placeItems: "center", padding: 20 }}
    >
      <div
        className="signin-card"
        style={{ margin: 0, width: 400, maxWidth: "100%" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22 }}>
            {mode === "signin" ? "Sign In to Brindle" : "Create Your Brindle Account"}
          </h2>
          <p className="muted" style={{ fontSize: 13.5, margin: "4px 0 0" }}>
            {mode === "signin"
              ? "Welcome back."
              : "Buyers need credit approval before bidding — we'll walk you through it after you sign up."}
          </p>
        </div>

        {mode === "register" && (
          <>
            <label className="field">
              <span className="label">Name or Ranch Name</span>
              <input className="input" value={legalName} onChange={(e) => setLegalName(e.target.value)}
                placeholder="Willow Creek Genetics" autoFocus />
            </label>
            <label className="field">
              <span className="label">I&rsquo;m here to</span>
              <select className="input" value={accountType} onChange={(e) => setAccountType(e.target.value)}>
                <option value="BUYER">Buy cattle and genetics</option>
                <option value="SELLER_BREEDER">Sell — run my own sales</option>
                <option value="GENETICS_PROVIDER">Sell semen and embryos</option>
              </select>
            </label>
          </>
        )}

        <label className="field">
          <span className="label">Email</span>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="you@ranch.com" autoFocus={mode === "signin"} />
        </label>
        <label className="field">
          <span className="label">Password</span>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === "register" ? "At least 8 characters" : ""}
            onKeyDown={(e) => e.key === "Enter" && canSubmit && submit()} />
        </label>

        {mode === "signin" && needsTotp && (
          <label className="field">
            <span className="label">Authenticator Code</span>
            <input className="input" value={totp} inputMode="numeric" autoComplete="one-time-code"
              maxLength={20} autoFocus placeholder="123456"
              onChange={(e) => setTotp(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && canSubmit && submit()} />
            <span className="dim" style={{ fontSize: 12 }}>
              Six digits from your authenticator app, or one of your recovery codes.
            </span>
          </label>
        )}

        {error && <div className="statusmsg rejected">{error}</div>}

        <button className="btn btn-primary btn-lg" onClick={submit} disabled={busy || !canSubmit}>
          {busy ? "Working…" : mode === "signin" ? "Sign In" : "Create Account"}
        </button>

        {mode === "signin" && (
          <p className="muted" style={{ fontSize: 13, textAlign: "center", margin: 0 }}>
            <Link href="/forgot-password" className="btn-link" style={{ fontSize: "inherit" }}
              onClick={onClose}>Forgot Your Password?</Link>
          </p>
        )}

        {mode === "register" && (
          <p className="dim" style={{ fontSize: 12, textAlign: "center", margin: 0 }}>
            By creating an account you agree to our{" "}
            <Link href="/terms" className="btn-link" style={{ fontSize: "inherit" }}>terms</Link> and{" "}
            <Link href="/privacy" className="btn-link" style={{ fontSize: "inherit" }}>privacy policy</Link>.
          </p>
        )}

        <p className="muted" style={{ fontSize: 13, textAlign: "center", margin: 0 }}>
          {mode === "signin" ? (
            <>New to Brindle? <button className="btn-link" onClick={() => onMode("register")}>Create an Account</button></>
          ) : (
            <>Already have an account? <button className="btn-link" onClick={() => onMode("signin")}>Sign In</button></>
          )}
        </p>
      </div>
    </div>
  );
}
