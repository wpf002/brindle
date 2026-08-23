import Link from "next/link";

export const metadata = {
  title: "Terms of service",
  description: "Brindle's terms of service, auction terms, and dispute resolution policy.",
};

// NOTE: This is a working draft written to make the product coherent and to give
// buyers and sellers something concrete to agree to. It has NOT been reviewed by
// counsel. Before any real money moves, an agricultural-law attorney needs to
// review this alongside the Packers and Stockyards Act posture (see
// docs/legal-review.md).
export default function TermsPage() {
  return (
    <main className="wrap">
      <div className="news-detail">
        <Link href="/" className="crumb">← Home</Link>
        <div className="eyebrow cat">Legal</div>
        <h1>Terms of service</h1>
        <p className="dek">
          The agreement between Brindle, sellers who run sales here, and buyers who bid on them.
        </p>
        <div className="byline">Draft — pending legal review. Last updated {new Date().getFullYear()}.</div>

        <div className="news-body">
          <h2 className="block-title">1. What Brindle is</h2>
          <p>
            Brindle is a technology platform that lets livestock and genetics sellers run their own
            auctions. Brindle is not a livestock dealer, does not take ownership of any animal or
            genetic material listed here, and does not act as a market agency selling on commission.
            The sale contract is between the buyer and the seller.
          </p>
          <p>
            For lots settled through Brindle&rsquo;s integrated payment flow, Brindle acts as a
            marketplace facilitator: funds move from the buyer to the seller&rsquo;s connected
            payment account, and Brindle collects a platform fee. Brindle does not hold seller
            proceeds in its own accounts.
          </p>

          <h2 className="block-title">2. Accounts and buyer credit</h2>
          <p>
            You must create an account with accurate information to use Brindle. Buyers must
            complete identity verification and be approved for buyer credit before bidding.
            Approval is at Brindle&rsquo;s discretion and may be suspended at any time. Your buyer
            number identifies you across every seller&rsquo;s sale on the platform.
          </p>
          <p>You are responsible for everything done under your account. Keep your password secure.</p>

          <h2 className="block-title">3. Bidding</h2>
          <p>
            A bid is a binding offer to buy at that price. You may not retract a bid. If you are the
            high bidder when a lot closes and the reserve is met, you have bought that lot and are
            obligated to pay for it and take delivery.
          </p>
          <p>
            Timed lots close at their posted end time. Lots that receive a bid inside the soft-close
            window are extended, so a lot may close later than its originally posted time. Every bid
            is recorded in an append-only log with its sequence number; that log is the record of
            record in any dispute.
          </p>
          <p>
            You may not bid on your own lots, bid to inflate a price without intent to buy, or use
            more than one account to bid on the same lot.
          </p>

          <h2 className="block-title">4. Seller obligations</h2>
          <p>
            Sellers are responsible for the accuracy of every listing: descriptions, weights,
            registration numbers, EPD figures, health and disease-test records, and photographs.
            Sellers must have the right to sell what they list.
          </p>
          <p>
            Sellers are responsible for compliance with all applicable law governing the movement
            and sale of livestock, including interstate health certificates, brand inspection where
            required, and any state licensing that applies to their operation.
          </p>

          <h2 className="block-title">5. Payment and settlement</h2>
          <p>
            For lots settled through integrated payment, the buyer&rsquo;s payment method is
            authorized when the lot closes and captured when the seller confirms the sale. Funds
            for a lot under an open dispute are held and are not released to the seller until the
            dispute resolves.
          </p>
          <p>
            For contract-settled lots, Brindle generates a forward contract at hammer. The buyer
            pays the seller directly on delivery per the contract&rsquo;s terms; Brindle invoices
            only its platform fee.
          </p>

          <h2 className="block-title">6. Disputes</h2>
          <p>
            A buyer may file a dispute on a lot they won, stating the claim (not as described,
            delivery, weight variance, or genetics quality) and attaching evidence. Filing a
            dispute places any held funds on hold.
          </p>
          <p>
            Brindle reviews the dispute, the listing as it appeared at sale, and the bid log, and
            resolves by either refunding the buyer or releasing funds to the seller. Buyers and
            sellers agree to cooperate in good faith and to provide requested documentation.
          </p>
          <p>
            Brindle&rsquo;s resolution is final as to the movement of funds held on the platform.
            It does not extinguish any right either party has to pursue the other outside Brindle.
          </p>

          <h2 className="block-title">7. Fees</h2>
          <p>
            Sellers pay a platform fee on lots sold through integrated payment, disclosed before a
            sale opens. Buyer premium, where a seller charges one, is disclosed on every lot page
            before you bid and is added to the hammer price.
          </p>

          <h2 className="block-title">8. Limitation of liability</h2>
          <p>
            Brindle provides the platform as-is. Brindle is not a party to the sale contract and
            does not warrant any animal, genetic material, or seller representation. To the extent
            permitted by law, Brindle&rsquo;s liability arising from any lot is limited to the
            platform fees it collected on that lot.
          </p>

          <h2 className="block-title">9. Changes</h2>
          <p>
            Brindle may update these terms. Material changes will be posted before they take
            effect. Terms in force at the time a lot closes govern that sale.
          </p>

          <h2 className="block-title">Contact</h2>
          <p>
            Questions about these terms: <a className="btn-link" href="mailto:hello@brindle.example">hello@brindle.example</a>
          </p>
        </div>
      </div>
    </main>
  );
}
