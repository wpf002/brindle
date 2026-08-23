export default function NotFound() {
  return (
    <main className="wrap section">
      <div className="signin-wrap">
        <div className="eyebrow">Page not found</div>
        <h1>We couldn&rsquo;t find that page</h1>
        <p className="muted">
          The lot or sale you&rsquo;re looking for may have closed or been withdrawn.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 20 }}>
          <a className="btn btn-primary" href="/">Browse auctions</a>
          <a className="btn btn-ghost" href="/news">Market news</a>
        </div>
      </div>
    </main>
  );
}
