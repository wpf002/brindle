"use client";
import { useEffect, useState } from "react";
import { authed, getToken, onAuthChange, openSignIn } from "../lib/session";

/** Star toggle that saves a lot to the signed-in buyer's watchlist. */
export function WatchButton({ lotId }: { lotId: string }) {
  const [watching, setWatching] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const sync = () => {
      const has = Boolean(getToken());
      setSignedIn(has);
      if (!has) { setWatching(false); return; }
      void authed<{ lotIds: string[] }>(`/watchlist/mine?lotIds=${lotId}`)
        .then((r) => setWatching(r.lotIds.includes(lotId)))
        .catch(() => {});
    };
    sync();
    return onAuthChange(sync);
  }, [lotId]);

  async function toggle() {
    if (!signedIn) { openSignIn(); return; }
    setBusy(true);
    const next = !watching;
    try {
      await authed(`/watchlist/${lotId}`, { method: next ? "POST" : "DELETE" });
      setWatching(next);
    } catch {
      // Leave the previous state visible rather than lying about what saved.
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      className="watch-btn"
      onClick={toggle}
      disabled={busy}
      aria-pressed={watching}
      aria-label={watching ? "Remove from watchlist" : "Save to watchlist"}
      title={watching ? "Remove from watchlist" : "Save to watchlist"}
    >
      <span aria-hidden="true" style={{ color: watching ? "var(--gold)" : "var(--ink-3)" }}>
        {watching ? "★" : "☆"}
      </span>
    </button>
  );
}
