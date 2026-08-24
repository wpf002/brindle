export default function NotFound() {
  return (
    <main className="wrap section">
      <div className="signin-wrap">
        <div className="eyebrow">404</div>
        <h1>Page Not Found</h1>
        <p className="muted">
          The lot or sale you&rsquo;re looking for may have closed or been withdrawn.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 20 }}>
          <a className="btn btn-primary" href="/">Browse Auctions</a>
          <a className="btn btn-ghost" href="/news">Market News</a>
        </div>
      </div>
    </main>
  );
}
