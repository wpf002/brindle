export function Footer() {
  return (
    <footer className="footer">
      <div className="wrap footer-inner">
        <div>
          <div className="footer-brand">Brindle<span className="dot">.</span></div>
          <p className="footer-tag">
            Auction software for the cattle business. Sale barns and breeders run their
            own ring, live or online; buyers clear credit once and bid anywhere on
            Brindle; and every bid lands in an audit trail neither side can change.
          </p>
        </div>
        <div className="footer-cols">
          <div className="footer-col">
            <div className="h">Marketplace</div>
            <a href="/">Browse Auctions</a>
            <a href="/market">Market Prices</a>
            <a href="/sell">Sell on Brindle</a>
          </div>
          <div className="footer-col">
            <div className="h">Trust</div>
            <div>Buyer Credit Cleared Once</div>
            <div>Verified Sellers</div>
            <div>Immutable Bid Log</div>
          </div>
          <div className="footer-col">
            <div className="h">Legal</div>
            <a href="/terms">Terms of Service</a>
            <a href="/privacy">Privacy Policy</a>
            <a href="mailto:hello@brindle.example">Contact</a>
          </div>
        </div>
      </div>
      <div className="wrap footer-bottom">
        Brindle Marketplace, Inc. · Market data courtesy of the{" "}
        USDA Agricultural Marketing Service
      </div>
    </footer>
  );
}
