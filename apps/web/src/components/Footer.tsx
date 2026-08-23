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
            <a href="/market">Market prices</a>
            <a href="/sell">Sell on Brindle</a>
          </div>
          <div className="footer-col">
            <div className="h">Trust</div>
            <div>Buyer credit cleared once</div>
            <div>Verified sellers</div>
            <div>Immutable bid log</div>
          </div>
          <div className="footer-col">
            <div className="h">Legal</div>
            <a href="/terms">Terms of service</a>
            <a href="/privacy">Privacy policy</a>
            <a href="mailto:hello@brindle.example">Contact</a>
          </div>
        </div>
      </div>
      <div className="wrap footer-bottom">
        Brindle Marketplace, Inc. · genetics-first livestock auctions ·{" "}
        Market data courtesy of USDA Agricultural Marketing Service
      </div>
    </footer>
  );
}
