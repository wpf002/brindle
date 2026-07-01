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
        "Willow Creek Genetics was founded in 1987 on a bend of the Yellowstone River outside Big Timber, Montana, " +
        "with forty registered Angus cows and a conviction that maternal soundness and carcass merit didn't have to " +
        "trade off against each other. Nearly four decades later the program runs close to 900 head across two " +
        "divisions, with an embryo transfer and semen program that ships genetics to commercial operations in " +
        "eleven states.\n\n" +
        "Every bull that enters the AI battery is selected first on data — actual birth weights, actual weaning " +
        "weights, ultrasound carcass scans on the whole calf crop, not just the standouts — and second on how he " +
        "moves and how he holds up on native range through a Montana winter. \"We don't keep a bull that can't do " +
        "both,\" is the rule, and it hasn't changed since the ranch's founding.",
      quote:
        "We're not chasing a single number on a page. We want a bull whose calves finish well, whose daughters " +
        "breed back every year, and who can still get out and cover ground. If he can't do all three, he doesn't " +
        "stay in the program.",
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
        "Willow Creek Genetics was founded in 1987 on a bend of the Yellowstone River outside Big Timber, Montana, " +
        "with forty registered Angus cows and a conviction that maternal soundness and carcass merit didn't have to " +
        "trade off against each other. Nearly four decades later the program runs close to 900 head across two " +
        "divisions, with an embryo transfer and semen program that ships genetics to commercial operations in " +
        "eleven states.\n\n" +
        "Every bull that enters the AI battery is selected first on data — actual birth weights, actual weaning " +
        "weights, ultrasound carcass scans on the whole calf crop, not just the standouts — and second on how he " +
        "moves and how he holds up on native range through a Montana winter. \"We don't keep a bull that can't do " +
        "both,\" is the rule, and it hasn't changed since the ranch's founding.",
      quote:
        "We're not chasing a single number on a page. We want a bull whose calves finish well, whose daughters " +
        "breed back every year, and who can still get out and cover ground. If he can't do all three, he doesn't " +
        "stay in the program.",
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
        "Sundance Simmental Co. has run SimAngus cattle in the Black Hills foothills since 1962, when Simmental " +
        "genetics were still a novelty on this side of the Atlantic. The program leaned into hybrid vigor early and " +
        "never looked back — today the cow herd runs about 550 head, split between purebred Simmental and a " +
        "stabilized SimAngus composite bred for feedlots that pay on gain and grade.\n\n" +
        "Bulls are developed on a forage-based, low-input ration on purpose: the ranch wants sires that will hold " +
        "up for commercial customers who don't have a feed truck running twice a day.",
      quote: "A bull has to work for the guy who buys him, not just for us on sale day.",
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
          "The original 1987 property and the seedstock cow herd's home range — 6,400 deeded acres of Yellowstone " +
          "River bottom and foothill grazing. All embryo transfer and AI work happens here.",
        acres: 6400,
        herdSize: 620,
      },
      {
        sellerId: seller.id,
        sortOrder: 1,
        name: "Crazy Mountain Division",
        location: "Wilsall, Montana",
        description:
          "Higher-elevation summer range added in 2004, used to develop replacement heifers and bulls under " +
          "genuinely tough conditions before they're offered for sale.",
        acres: 3100,
        herdSize: 280,
      },
      {
        sellerId: sundance.id,
        sortOrder: 0,
        name: "Sundance Home Ranch",
        location: "Spearfish, South Dakota",
        description:
          "Three generations of the same family running cattle in the Black Hills foothills on a forage-first program.",
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
        "Semen pricing on registered Angus sires with above-average maternal indexes has held firm through the third " +
        "quarter, with comparable lots clearing 8 to 12 percent over spring averages according to sales tracked on " +
        "the platform. Buyers are showing a clear preference for sires with published accuracy above 0.6 on growth " +
        "traits, a signal that commercial operations are weighting proven data more heavily than in years past.\n\n" +
        "Doses on bulls in the top decile for marbling have been the tightest category, with several lots selling " +
        "out within the first hour of a timed sale opening. Sellers bringing genetics to market this fall should " +
        "expect strong clearance on well-documented lots and softer demand on lots with thin EPD data.\n\n" +
        "Buyer premium structures have stayed consistent across sellers this quarter, averaging 4 to 5 percent, in " +
        "line with prior periods.",
    },
    {
      slug: "willow-creek-spring-sale-recap",
      title: "Willow Creek's spring genetics sale clears strong",
      dek: "Two lots, forty-one combined years of program history, and a buyer base that stretched from Montana to Nebraska.",
      category: "Sale Recap",
      authorName: "Brindle Market Desk",
      sellerId: seller.id,
      body:
        "Willow Creek Genetics' spring sale moved both offered lots to approved commercial buyers, continuing the " +
        "program's run of full clearance on timed-online sales since joining the platform. WCG Cimarron 204, a " +
        "calving-ease sire with a top-15% weaning weight EPD, drew active bidding through the closing minutes before " +
        "settling to a Nebraska operation.\n\n" +
        "\"We've sold private treaty for years, but the transparency of a timed auction — everyone sees the same " +
        "price move in real time — has actually strengthened relationships with repeat buyers,\" said Willow Creek's " +
        "general manager. \"They know the number they see is the number everyone else saw.\"\n\n" +
        "The sale's buyer premium and settlement cleared through Brindle's integrated payment flow within the same " +
        "business day.",
    },
    {
      slug: "willow-creek-expands-embryo-program",
      title: "Willow Creek expands embryo transfer program to Crazy Mountain division",
      dek: "The ranch's newer high-elevation property will begin flushing donor cows for the first time this winter.",
      category: "Ranch News",
      authorName: "Brindle Editorial",
      sellerId: seller.id,
      body:
        "Willow Creek Genetics will begin embryo transfer work at its Crazy Mountain division this winter, extending " +
        "a program that has run exclusively out of the home place since 1994. The higher-elevation property, added " +
        "to the ranch in 2004, has been used to develop replacement females and bulls under harder conditions before " +
        "they enter the sale program — a deliberate test the ranch has never softened.\n\n" +
        "The expansion will roughly double the number of donor cows the program can flush in a season, without " +
        "changing the selection criteria that has defined the herd for nearly four decades.",
    },
  ];
  for (const p of posts) {
    await prisma.newsPost.upsert({ where: { slug: p.slug }, update: {}, create: p });
  }

  console.log("seeded sellers:", seller.email, sundance.email, "| buyer:", buyer.email, "| news posts:", posts.length);
  await prisma.$disconnect();
}

void main();
