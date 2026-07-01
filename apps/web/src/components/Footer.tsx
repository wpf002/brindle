export function Footer() {
  return (
    <footer className="footer">
      <div className="wrap footer-inner">
        <div>
          <div className="footer-brand">Brindle<span className="dot">.</span></div>
          <p className="footer-tag">
            Integer-cent bidding engine · marketplace facilitator · genetics-first.
            One credit approval, every seller&rsquo;s sale.
          </p>
        </div>
        <div className="footer-cols">
          <div className="footer-col">
            <div className="h">Marketplace</div>
            <a href="/">Browse auctions</a>
            <a href="/sell">Sell on Brindle</a>
          </div>
          <div className="footer-col">
            <div className="h">Trust</div>
            <div>Buyer credit cleared once</div>
            <div>Verified sellers</div>
            <div>Immutable bid log</div>
          </div>
          <div className="footer-col">
            <div className="h">Support</div>
            <a href="mailto:hello@brindle.example">Contact</a>
            <div>Payments &amp; settlement</div>
          </div>
        </div>
      </div>
      <div className="wrap footer-bottom">Brindle Marketplace, Inc. · genetics-first livestock auctions</div>
    </footer>
  );
}
