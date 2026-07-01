"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { getSession, devSignIn, clearToken, onAuthChange, type Session } from "../lib/session";

export function Nav() {
  const path = usePathname() ?? "/";
  const [session, setSession] = useState<Session | null>(null);
  const [modal, setModal] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = () => void getSession().then(setSession);
  useEffect(() => {
    refresh();
    return onAuthChange(refresh);
  }, []);

  async function signIn() {
    if (!email.trim()) return;
    setBusy(true);
    const ok = await devSignIn(email.trim());
    setBusy(false);
    if (ok) { setModal(false); setEmail(""); }
  }

  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  return (
    <>
      <nav className="nav">
        <div className="nav-inner">
          <Link href="/" className="brand">Brindle<span className="dot">.</span></Link>
          <div className="nav-links">
            <Link href="/" className={`nav-link ${isActive("/") ? "active" : ""}`}>Auctions</Link>
            <Link href="/news" className={`nav-link ${isActive("/news") ? "active" : ""}`}>News</Link>
            <Link href="/sell" className={`nav-link ${isActive("/sell") ? "active" : ""}`}>Sell</Link>
          </div>
          <div className="nav-spacer" />
          <div className="nav-user">
            {session ? (
              <>
                <span className="chip">
                  {session.buyerNumber && <span className="num">{session.buyerNumber}</span>}
                  {session.creditApproved && <span className="pill live" style={{ padding: "1px 7px" }}>Approved</span>}
                </span>
                <span className="avatar">{session.userId.slice(0, 1).toUpperCase()}</span>
                <button className="btn-link" onClick={() => clearToken()}>Sign out</button>
              </>
            ) : (
              <button className="btn btn-primary btn-sm" onClick={() => setModal(true)}>Sign in</button>
            )}
          </div>
        </div>
      </nav>

      {modal && (
        <div
          onClick={() => setModal(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(33,29,24,.4)", zIndex: 100,
            display: "grid", placeItems: "center", padding: 20 }}
        >
          <div className="signin-card" style={{ margin: 0, width: 380, maxWidth: "100%" }} onClick={(e) => e.stopPropagation()}>
            <div>
              <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22 }}>Sign in to Brindle</h2>
              <p className="muted" style={{ fontSize: 13.5, margin: "4px 0 0" }}>
                No password needed. We&rsquo;ll set up your account and buyer credit instantly.
              </p>
            </div>
            <input className="input" placeholder="you@ranch.com" value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && signIn()} autoFocus />
            <button className="btn btn-primary btn-lg" onClick={signIn} disabled={busy || !email.trim()}>
              {busy ? "Signing in…" : "Continue"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
