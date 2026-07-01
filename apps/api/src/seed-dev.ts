// Dev seed: sellers with story content, an approved buyer, and a few news
// posts, so dev-login and the editorial pages have real content to render.
// Run: pnpm --filter @brindle/api exec tsx src/seed-dev.ts
import { prisma, UserType, CreditStatus, AuctionFormat, SettlementMode, LotCategory, PriceUnit, LotStatus } from "@brindle/db";

async function main() {
  const seller = await prisma.user.upsert({
    where: { email: "seller@ranch.com" },
    update: {
      title: "Owner & General Manager",
      sellerVerified: true,
      foundedYear: 1987,
      bio:
        "Willow Creek Genetics started in 1987 with forty registered Angus cows on a bend of the Yellowstone River " +
        "outside Big Timber, Montana. The herd runs close to 900 head now across two properties, and the AI and " +
        "embryo program ships genetics to commercial operations in eleven states.\n\n" +
        "Bulls get culled on data before anything else: actual birth weights, actual weaning weights, ultrasound " +
        "scans on the whole calf crop. A bull also has to hold up on native range through a Montana winter. If he " +
        "can't do both, he's gone, no matter how he scores on paper.",
      quote:
        "A bull's paper can look perfect and he still won't make it here if his daughters don't breed back or he " +
        "can't handle a Montana winter.",
    },
    create: {
      email: "seller@ranch.com",
      type: UserType.SELLER_BREEDER,
      legalName: "Willow Creek Genetics",
      businessName: "Willow Creek Genetics",
      state: "MT",
      stripeAccountId: "acct_dev_seller",
      title: "Owner & General Manager",
      sellerVerified: true,
      foundedYear: 1987,
      bio:
        "Willow Creek Genetics started in 1987 with forty registered Angus cows on a bend of the Yellowstone River " +
        "outside Big Timber, Montana. The herd runs close to 900 head now across two properties, and the AI and " +
        "embryo program ships genetics to commercial operations in eleven states.\n\n" +
        "Bulls get culled on data before anything else: actual birth weights, actual weaning weights, ultrasound " +
        "scans on the whole calf crop. A bull also has to hold up on native range through a Montana winter. If he " +
        "can't do both, he's gone, no matter how he scores on paper.",
      quote:
        "A bull's paper can look perfect and he still won't make it here if his daughters don't breed back or he " +
        "can't handle a Montana winter.",
    },
  });

  const sundance = await prisma.user.upsert({
    where: { email: "info@sundancesimmental.com" },
    update: {},
    create: {
      email: "info@sundancesimmental.com",
      type: UserType.SELLER_BREEDER,
      legalName: "Sundance Simmental Co.",
      businessName: "Sundance Simmental Co.",
      state: "SD",
      stripeAccountId: "acct_dev_sundance",
      title: "Third-generation owner",
      sellerVerified: true,
      foundedYear: 1962,
      bio:
        "Sundance Simmental has run cattle in the Black Hills foothills since 1962, back when Simmental genetics " +
        "were still unusual in the U.S. The herd is around 550 head today, split between purebred Simmental and a " +
        "SimAngus composite built for feedlots that pay on gain and grade.\n\n" +
        "Bulls are developed on a forage-based ration instead of a high-grain one, because most of Sundance's " +
        "commercial customers don't have a feed truck running twice a day.",
      quote: "A bull's got to work for the guy who buys him, not just look good on sale day.",
    },
  });

  const buyer = await prisma.user.upsert({
    where: { email: "buyer@ranch.com" },
    update: { creditStatus: CreditStatus.APPROVED },
    create: {
      email: "buyer@ranch.com",
      type: UserType.BUYER,
      legalName: "Rocking R Ranch",
      businessName: "Rocking R Ranch",
      state: "NE",
      creditStatus: CreditStatus.APPROVED,
      buyerNumber: "B-000001",
      creditLimitCents: 5_000_000n,
    },
  });

  // Operations (the "Dixon Creek / Frisco Creek" pattern) — idempotent: clear
  // and re-seed each run so this stays safe to run repeatedly in dev.
  await prisma.sellerOperation.deleteMany({ where: { sellerId: { in: [seller.id, sundance.id] } } });
  await prisma.sellerOperation.createMany({
    data: [
      {
        sellerId: seller.id,
        sortOrder: 0,
        name: "Willow Creek Home Place",
        location: "Big Timber, Montana",
        description:
          "The original 1987 property: 6,400 deeded acres of river bottom and foothill grazing along the " +
          "Yellowstone. All embryo transfer and AI work happens here.",
        acres: 6400,
        herdSize: 620,
      },
      {
        sellerId: seller.id,
        sortOrder: 1,
        name: "Crazy Mountain Division",
        location: "Wilsall, Montana",
        description:
          "Higher-elevation summer range added in 2004. Replacement heifers and bulls are developed here under " +
          "tough conditions before they're offered for sale.",
        acres: 3100,
        herdSize: 280,
      },
      {
        sellerId: sundance.id,
        sortOrder: 0,
        name: "Sundance Home Ranch",
        location: "Spearfish, South Dakota",
        description: "Three generations of the same family have run cattle here in the Black Hills foothills.",
        acres: 4200,
        herdSize: 550,
      },
    ],
  });

  // A second seller's auction + lot, so the catalog and brand-family strip show
  // more than one program (and the registry badge wall shows more than AAA).
  const sundanceAuction = await prisma.auction.upsert({
    where: { id: "00000000-0000-0000-0000-00000000a001" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-00000000a001",
      sellerId: sundance.id,
      name: "Sundance Fall Bull & Female Sale",
      format: AuctionFormat.TIMED_ONLINE,
      settlementMode: SettlementMode.INTEGRATED_PAYMENT,
      startsAt: new Date("2026-10-15T16:00:00Z"),
      buyerPremiumBps: 400,
      softCloseSecs: 120,
    },
  });
  await prisma.lot.upsert({
    where: { auctionId_lotNumber: { auctionId: sundanceAuction.id, lotNumber: 1 } },
    update: {},
    create: {
      auctionId: sundanceAuction.id,
      lotNumber: 1,
      category: LotCategory.SEMEN,
      priceUnit: PriceUnit.DOSE,
      startingBidCents: 3000,
      bidIncrementCents: 200,
      bullName: "Sundance Rebel 118A",
      bullRegId: "ASA3312456",
      dosesAvailable: 30,
      postThawMotility: 65,
      storageFacility: "Genex Cooperative, Shawano WI",
      photoCredit: "Photo: Sundance Simmental Co.",
      status: LotStatus.ACTIVE,
      epd: { CED: 9, BW: { value: 0.8, pct: 22 }, WW: { value: 78, pct: 12 }, Marb: { value: 0.45, pct: 40 } },
    },
  });

  // News — market reports, sale recaps, ranch news. Idempotent on slug.
  const posts = [
    {
      slug: "fall-2026-angus-semen-market-report",
      title: "Angus semen demand holds firm heading into fall",
      dek: "Comparable AAA sires are clearing 8–12% over spring pricing as commercial buyers lock in genetics ahead of breeding season.",
      category: "Market Report",
      authorName: "Brindle Market Desk",
      body:
        "Semen pricing on registered Angus sires with above-average maternal indexes held firm through the third " +
        "quarter. Comparable lots on the platform cleared 8 to 12 percent over spring averages, with the tightest " +
        "bidding on bulls in the top decile for marbling — several of those lots sold out within the first hour of " +
        "a timed sale opening.\n\n" +
        "Buyer premiums stayed in the 4 to 5 percent range across sellers this quarter, consistent with prior " +
        "periods.",
    },
    {
      slug: "willow-creek-spring-sale-recap",
      title: "Willow Creek's spring genetics sale clears strong",
      dek: "Both lots offered found buyers, continuing Willow Creek's run of full-clearance sales on the platform this year.",
      category: "Sale Recap",
      authorName: "Brindle Editorial",
      sellerId: seller.id,
      body:
        "Willow Creek Genetics sold both lots offered in its spring sale to approved commercial buyers. WCG " +
        "Cimarron 204, a calving-ease sire with a top-15% weaning weight EPD, drew bidding through the closing " +
        "minutes before settling to a Nebraska operation.\n\n" +
        "It was Willow Creek's third sale on Brindle, and its third to clear every lot offered.",
    },
    {
      slug: "willow-creek-expands-embryo-program",
      title: "Willow Creek expands embryo transfer program to Crazy Mountain division",
      dek: "The ranch's newer high-elevation property will begin flushing donor cows for the first time this winter.",
      category: "Ranch News",
      authorName: "Brindle Editorial",
      sellerId: seller.id,
      body:
        "Willow Creek Genetics will begin embryo transfer work at its Crazy Mountain division this winter — the " +
        "first time the program has flushed donor cows anywhere but the home place since 1994. Crazy Mountain was " +
        "added to the ranch in 2004 and has mainly been used to develop replacement heifers and bulls before they " +
        "enter the sale program.\n\n" +
        "The expansion is expected to roughly double how many donor cows the program can flush in a season.",
    },
  ];
  for (const p of posts) {
    await prisma.newsPost.upsert({ where: { slug: p.slug }, update: p, create: p });
  }

  console.log("seeded sellers:", seller.email, sundance.email, "| buyer:", buyer.email, "| news posts:", posts.length);
  await prisma.$disconnect();
}

void main();
