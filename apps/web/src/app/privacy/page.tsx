import Link from "next/link";

export const metadata = {
  title: "Privacy policy",
  description: "What Brindle collects, why, and who it's shared with.",
};

// Draft — see the note in terms/page.tsx. Needs counsel review before launch,
// particularly around identity-verification data retention.
export default function PrivacyPage() {
  return (
    <main className="wrap">
      <div className="news-detail">
        <Link href="/" className="crumb">← Home</Link>
        <div className="eyebrow cat">Legal</div>
        <h1>Privacy policy</h1>
        <p className="dek">What we collect, why we collect it, and who sees it.</p>
        <div className="byline">Draft — pending legal review. Last updated {new Date().getFullYear()}.</div>

        <div className="news-body">
          <h2 className="block-title">What we collect</h2>
          <p>
            Account information you give us (name, ranch or business name, email, phone, state).
            Bidding and transaction activity on the platform. Identity-verification results from
            our verification provider — we receive a pass/fail and a reference id, not your
            underlying identity documents. Payment details are handled by Stripe; Brindle never
            stores card or bank numbers.
          </p>

          <h2 className="block-title">Why we collect it</h2>
          <p>
            To run auctions and settle sales, to approve and manage buyer credit, to meet
            identity and anti-fraud obligations, to notify you about lots you bid on or watch,
            and to resolve disputes.
          </p>

          <h2 className="block-title">Who sees it</h2>
          <p>
            Sellers see the buyer number, name, and contact details of the buyer who won their
            lot — they need this to arrange delivery. Buyers see seller identity and location.
            Other bidders never see who else is bidding; bidder identities are not public.
          </p>
          <p>
            We share data with processors who run parts of the service: Stripe (payments),
            our identity-verification provider, and our email provider. We do not sell your data.
          </p>

          <h2 className="block-title">The bid log</h2>
          <p>
            Bids are recorded permanently and immutably — that record is what makes a disputed
            sale resolvable. Bid records are not deleted on account closure, though they are
            disassociated from your contact details where we are able to do so.
          </p>

          <h2 className="block-title">Your choices</h2>
          <p>
            You can view and update your account information at any time. You can ask us for a
            copy of your data or to close your account by writing to us. Notification emails
            about lots you are actively bidding on are part of the service and cannot be
            disabled while you have live bids.
          </p>

          <h2 className="block-title">Contact</h2>
          <p>
            Privacy questions: <a className="btn-link" href="mailto:hello@brindle.example">hello@brindle.example</a>
          </p>
        </div>
      </div>
    </main>
  );
}
