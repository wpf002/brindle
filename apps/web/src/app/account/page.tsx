"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  authed, getMe, refreshMe, onAuthChange, openSignIn, signOut, humanizeError,
  type Me,
} from "../../lib/session";

interface ActiveSession {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  ip: string | null;
  userAgent: string | null;
  current: boolean;
}

export default function AccountPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    setMe(await getMe());
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
    return onAuthChange(() => void load());
  }, [load]);

  if (!loaded) return <div className="wrap section"><p className="muted">Loading…</p></div>;

  if (!me) {
    return (
      <div className="signin-wrap">
        <h1>Your account</h1>
        <div className="signin-card">
          <p className="muted" style={{ margin: 0 }}>Sign in to manage your account.</p>
          <button className="btn btn-primary btn-lg" onClick={openSignIn}>Sign in</button>
        </div>
      </div>
    );
  }

  const { account } = me;

  return (
    <div className="wrap section" style={{ maxWidth: 720 }}>
      <p className="eyebrow">Account</p>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: 34, margin: "4px 0 6px" }}>
        {account.businessName ?? account.legalName}
      </h1>
      <p className="muted" style={{ marginTop: 0 }}>{account.email}</p>

      <EmailPanel verified={account.emailVerified} />
      <TwoFactorPanel enabled={account.twoFactorEnabled} onChange={() => void refreshMe().then(setMe)} />
      <PasswordPanel />
      <SessionsPanel />

      {account.adminRole && (
        <p className="dim" style={{ fontSize: 13, marginTop: 28 }}>
          Signed in with <strong>{account.adminRole}</strong> administrator access.
        </p>
      )}
    </div>
  );
}

function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="signin-card" style={{ marginTop: 22 }}>
      <div>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 20, margin: 0 }}>{title}</h2>
        {note && <p className="muted" style={{ fontSize: 13.5, margin: "4px 0 0" }}>{note}</p>}
      </div>
      {children}
    </section>
  );
}

function EmailPanel({ verified }: { verified: boolean }) {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function resend() {
    setBusy(true);
    try {
      await authed("/auth/resend-verification", { method: "POST" });
      setMsg("Sent — check your inbox.");
    } catch (e) {
      setMsg(humanizeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title="Email address"
      note={verified
        ? "Confirmed. This is where sale notices and settlement paperwork go."
        : "Not confirmed yet. Confirm it so you don't miss outbid notices or settlement paperwork."}
    >
      {verified ? (
        <span className="pill live" style={{ alignSelf: "start" }}>Confirmed</span>
      ) : (
        <>
          <button className="btn btn-primary btn-sm" style={{ alignSelf: "start" }}
            onClick={resend} disabled={busy}>
            {busy ? "Sending…" : "Resend confirmation email"}
          </button>
          {msg && <div className="statusmsg info">{msg}</div>}
        </>
      )}
    </Panel>
  );
}

function TwoFactorPanel({ enabled, onChange }: { enabled: boolean; onChange: () => void }) {
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true); setError("");
    try {
      setSetup(await authed<{ secret: string; uri: string }>("/auth/2fa/start", { method: "POST" }));
    } catch (e) { setError(humanizeError(e)); } finally { setBusy(false); }
  }

  async function confirm() {
    setBusy(true); setError("");
    try {
      const r = await authed<{ recoveryCode: string }>("/auth/2fa/confirm", {
        method: "POST", body: JSON.stringify({ code: code.trim() }),
      });
      setRecovery(r.recoveryCode);
      setSetup(null);
      setCode("");
      onChange();
    } catch (e) { setError(humanizeError(e)); } finally { setBusy(false); }
  }

  async function disable() {
    setBusy(true); setError("");
    try {
      await authed("/auth/2fa/disable", { method: "POST", body: JSON.stringify({ password }) });
      setPassword("");
      onChange();
    } catch (e) { setError(humanizeError(e)); } finally { setBusy(false); }
  }

  // The recovery code is shown exactly once — the server only keeps its hash.
  if (recovery) {
    return (
      <Panel title="Two-factor authentication"
        note="Two-factor is on. Write this recovery code down now — it won't be shown again.">
        <code style={{ fontSize: 20, letterSpacing: ".12em", padding: "12px 14px",
          background: "var(--forest-wash)", borderRadius: 10, textAlign: "center" }}>
          {recovery}
        </code>
        <p className="dim" style={{ fontSize: 12.5, margin: 0 }}>
          It works once, in place of a code, if you lose your phone. Using it turns two-factor off so
          you can set it up again on a new device.
        </p>
        <button className="btn btn-ghost btn-sm" style={{ alignSelf: "start" }}
          onClick={() => setRecovery("")}>I&rsquo;ve saved it</button>
      </Panel>
    );
  }

  if (enabled) {
    return (
      <Panel title="Two-factor authentication"
        note="On. Sign-ins need a code from your authenticator app.">
        <span className="pill live" style={{ alignSelf: "start" }}>Enabled</span>
        <details>
          <summary className="btn-link" style={{ cursor: "pointer" }}>Turn two-factor off</summary>
          <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
            <label className="field">
              <span className="label">Confirm your password</span>
              <input className="input" type="password" value={password}
                onChange={(e) => setPassword(e.target.value)} />
            </label>
            {error && <div className="statusmsg rejected">{error}</div>}
            <button className="btn btn-ghost btn-sm" style={{ justifySelf: "start" }}
              onClick={disable} disabled={busy || !password}>
              {busy ? "Working…" : "Turn it off"}
            </button>
          </div>
        </details>
      </Panel>
    );
  }

  return (
    <Panel title="Two-factor authentication"
      note="A second factor on top of your password. Worth turning on for any account that can bid or take payouts.">
      {!setup ? (
        <>
          {error && <div className="statusmsg rejected">{error}</div>}
          <button className="btn btn-primary btn-sm" style={{ alignSelf: "start" }}
            onClick={start} disabled={busy}>
            {busy ? "Working…" : "Set up two-factor"}
          </button>
        </>
      ) : (
        <>
          <p className="muted" style={{ fontSize: 13.5, margin: 0 }}>
            Add this key to your authenticator app, then enter the code it shows.
          </p>
          <code style={{ fontSize: 15, letterSpacing: ".1em", padding: "12px 14px", wordBreak: "break-all",
            background: "var(--forest-wash)", borderRadius: 10, textAlign: "center" }}>
            {setup.secret.replace(/(.{4})/g, "$1 ").trim()}
          </code>
          <a className="btn-link" href={setup.uri} style={{ fontSize: 13 }}>
            Or open it directly in your authenticator app
          </a>
          <label className="field">
            <span className="label">Code from your app</span>
            <input className="input" value={code} inputMode="numeric" autoComplete="one-time-code"
              placeholder="123456" maxLength={6}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && code.trim().length === 6 && confirm()} />
          </label>
          {error && <div className="statusmsg rejected">{error}</div>}
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn btn-primary btn-sm" onClick={confirm}
              disabled={busy || code.trim().length !== 6}>
              {busy ? "Checking…" : "Turn on two-factor"}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setSetup(null); setCode(""); setError(""); }}>
              Cancel
            </button>
          </div>
        </>
      )}
    </Panel>
  );
}

function PasswordPanel() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<{ kind: "info" | "rejected"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true); setMsg(null);
    try {
      await authed("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      setCurrent(""); setNext("");
      setMsg({ kind: "info", text: "Password changed. Other devices have been signed out." });
    } catch (e) {
      setMsg({ kind: "rejected", text: humanizeError(e) });
    } finally { setBusy(false); }
  }

  return (
    <Panel title="Password" note="Changing it signs out every other device.">
      <label className="field">
        <span className="label">Current password</span>
        <input className="input" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      </label>
      <label className="field">
        <span className="label">New password</span>
        <input className="input" type="password" value={next} placeholder="At least 8 characters"
          onChange={(e) => setNext(e.target.value)} />
      </label>
      {msg && <div className={`statusmsg ${msg.kind}`}>{msg.text}</div>}
      <button className="btn btn-primary btn-sm" style={{ alignSelf: "start" }}
        onClick={submit} disabled={busy || !current || next.length < 8}>
        {busy ? "Saving…" : "Change password"}
      </button>
    </Panel>
  );
}

function SessionsPanel() {
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setSessions((await authed<{ sessions: ActiveSession[] }>("/auth/sessions")).sessions);
    } catch { setSessions([]); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function signOutEverywhere() {
    setBusy(true);
    try {
      await authed("/auth/logout-all", { method: "POST" });
      await signOut();
    } finally { setBusy(false); }
  }

  return (
    <Panel title="Where you're signed in"
      note="Every device with an active session. If you see one you don't recognise, sign out everywhere and change your password.">
      <ul className="lotlist">
        {sessions.map((s) => (
          <li key={s.id} style={{ display: "grid", gap: 2 }}>
            <span>
              {describeAgent(s.userAgent)}
              {s.current && <span className="pill live" style={{ marginLeft: 8, padding: "1px 7px" }}>This device</span>}
            </span>
            <span className="dim" style={{ fontSize: 12 }}>
              {s.ip ?? "unknown address"} · last active {new Date(s.lastSeenAt).toLocaleString()}
            </span>
          </li>
        ))}
        {sessions.length === 0 && <li className="dim">No other active sessions.</li>}
      </ul>
      <button className="btn btn-ghost btn-sm" style={{ alignSelf: "start" }}
        onClick={signOutEverywhere} disabled={busy}>
        {busy ? "Signing out…" : "Sign out everywhere"}
      </button>
      <Link href="/watchlist" className="btn-link" style={{ fontSize: 13 }}>Back to your watchlist</Link>
    </Panel>
  );
}

/** A user-agent string is unreadable; the browser and OS are what identifies a device. */
function describeAgent(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser =
    /Edg\//.test(ua) ? "Edge"
      : /OPR\//.test(ua) ? "Opera"
        : /Chrome\//.test(ua) ? "Chrome"
          : /Firefox\//.test(ua) ? "Firefox"
            : /Safari\//.test(ua) ? "Safari"
              : "Browser";
  const os =
    /iPhone|iPad/.test(ua) ? "iOS"
      : /Android/.test(ua) ? "Android"
        : /Mac OS X/.test(ua) ? "macOS"
          : /Windows/.test(ua) ? "Windows"
            : /Linux/.test(ua) ? "Linux"
              : "";
  return os ? `${browser} on ${os}` : browser;
}
