"use client";
import { useEffect } from "react";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Client-side error reporting hook — wire to your tracker of choice here.
    console.error(error);
  }, [error]);

  return (
    <main className="wrap section">
      <div className="signin-wrap">
        <div className="eyebrow">Something went wrong</div>
        <h1>We hit a snag loading this page</h1>
        <p className="muted">
          The problem has been logged. Try again, and if it keeps happening let us know.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 20 }}>
          <button className="btn btn-primary" onClick={reset}>Try again</button>
          <a className="btn btn-ghost" href="/">Back to auctions</a>
        </div>
      </div>
    </main>
  );
}
