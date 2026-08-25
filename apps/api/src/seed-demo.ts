// Demo catalog: enough sellers, sales, and lots to actually show the product.
//
// Separate from seed-dev.ts, which exists to give a laptop something to render.
// This one is meant to be run against a deployed environment you demo from, so
// it is idempotent (fixed ids, upserts throughout) and reversible:
//
//   pnpm --filter @brindle/api seed:demo
//   pnpm --filter @brindle/api seed:demo -- --clear
//
// The content is illustrative. The ranches, animals, and registration numbers
// are invented — realistic in shape so the registry badges and EPD comparison
// have something to work on, but they describe no real animal. Clear it before
// real sellers list anything, or their lots will sit next to fictional ones.
import {
  prisma, UserType, CreditStatus, AuctionFormat, SettlementMode,
  LotCategory, PriceUnit, LotStatus, AuctionStatus,
} from "@brindle/db";
import type { Prisma } from "@brindle/db";
import { paymentsEnabled } from "./env.js";

// Fixed ids so re-running updates rather than duplicates, and so --clear knows
// exactly what it owns. The 'd' prefix marks them as demo rows on sight.
const ID = {
  willow: "00000000-0000-0000-0000-00000000d001",
  sundance: "00000000-0000-0000-0000-00000000d002",
  cedar: "00000000-0000-0000-0000-00000000d003",
  saleWillow: "00000000-0000-0000-0000-0000000d0a01",
  saleSundance: "00000000-0000-0000-0000-0000000d0a02",
  saleCedar: "00000000-0000-0000-0000-0000000d0a03",
  barn: "00000000-0000-0000-0000-00000000d004",
  saleBarn: "00000000-0000-0000-0000-0000000d0a04",
};

const SELLER_IDS = [ID.willow, ID.sundance, ID.cedar, ID.barn];
const SALE_IDS = [ID.saleWillow, ID.saleSundance, ID.saleCedar, ID.saleBarn];

/** Days from now, so a re-seed months later still shows upcoming sales. */
function daysOut(n: number): Date {
  return new Date(Date.now() + n * 24 * 3600_000);
}

async function clear(): Promise<void> {
  // Lots first — they reference auctions.
  const lots = await prisma.lot.deleteMany({ where: { auctionId: { in: SALE_IDS } } });
  const auctions = await prisma.auction.deleteMany({ where: { id: { in: SALE_IDS } } });
  const ops = await prisma.sellerOperation.deleteMany({ where: { sellerId: { in: SELLER_IDS } } });
  const users = await prisma.user.deleteMany({ where: { id: { in: SELLER_IDS } } });
  console.log(
    `cleared ${lots.count} lots, ${auctions.count} sales, ${ops.count} operations, ${users.count} sellers`,
  );
}

async function seller(
  id: string,
  email: string,
  businessName: string,
  state: string,
  title: string,
  foundedYear: number,
  bio: string,
  quote: string,
) {
  const data = {
    email, businessName, state, title, foundedYear, bio, quote,
    legalName: businessName,
    type: UserType.SELLER_BREEDER,
    sellerVerified: true,
    // No passwordHash, so nobody can sign in as a demo seller — login rejects
    // any account without one before it ever checks a password.
    creditStatus: CreditStatus.APPROVED,
  };
  return prisma.user.upsert({ where: { id }, update: data, create: { id, ...data } });
}

interface SaleOpts {
  /** Sale barns post these; genetics sales run by a breeder generally don't. */
  barnFees?: boolean;
}

async function sale(id: string, sellerId: string, name: string, startsInDays: number, opts: SaleOpts = {}) {
  const data = {
    sellerId,
    name,
    // Posted rates in the range barns actually charge: $15/head commission,
    // $1.50 yardage, $0.75 brand inspection. The $1/head Beef Checkoff is
    // federal and applied in code, not configured per sale.
    ...(opts.barnFees
      ? {
          commissionCentsPerHead: 1_500n,
          yardageCentsPerHead: 150n,
          brandInspectionCentsPerHead: 75n,
        }
      : {}),
    format: AuctionFormat.TIMED_ONLINE,
    // A demo deployment usually runs without payments; an INTEGRATED_PAYMENT
    // sale there would offer a checkout that can't complete.
    settlementMode: paymentsEnabled() ? SettlementMode.INTEGRATED_PAYMENT : SettlementMode.CONTRACT,
    status: AuctionStatus.SCHEDULED,
    startsAt: daysOut(startsInDays),
    endsAt: daysOut(startsInDays + 1),
    buyerPremiumBps: 400,
    softCloseSecs: 120,
  };
  return prisma.auction.upsert({ where: { id }, update: data, create: { id, ...data } });
}

interface LotSpec {
  lotNumber: number;
  category: LotCategory;
  // Commercial cattle sell as uniform loads priced per hundredweight —
  // "300 head of 550-600 lb black steers" — not per animal. This is the volume
  // of the business; genetics lots are the smaller, higher-value tail.
  headCount?: number;
  avgWeightLbs?: number;
  shrinkPct?: number;
  originState?: string;
  programCerts?: string[];
  priceUnit: PriceUnit;
  // Money is integer cents as bigint everywhere in this codebase; no float
  // ever touches a price.
  startingBidCents: bigint;
  bidIncrementCents: bigint;
  bullName?: string;
  bullRegId?: string;
  primaryBreed: string;
  dosesAvailable?: number;
  postThawMotility?: number;
  storageFacility?: string;
  epd?: Prisma.InputJsonValue;
}

async function lots(auctionId: string, specs: LotSpec[]) {
  for (const spec of specs) {
    const data = { ...spec, status: LotStatus.ACTIVE, endsAt: null };
    await prisma.lot.upsert({
      where: { auctionId_lotNumber: { auctionId, lotNumber: spec.lotNumber } },
      update: data,
      create: { auctionId, ...data },
    });
  }
}

async function main(): Promise<void> {
  if (process.argv.includes("--clear")) return clear();

  const willow = await seller(
    ID.willow, "demo-willowcreek@brindle.example", "Willow Creek Genetics", "MT",
    "Owner & General Manager", 1987,
    "Willow Creek runs registered Angus on a bend of the Yellowstone outside Big Timber, Montana. " +
      "The herd is close to 900 head across two properties, and the AI and embryo program ships " +
      "genetics to commercial operations in eleven states.\n\n" +
      "Bulls are culled on data first: actual birth weights, actual weaning weights, ultrasound scans " +
      "on the whole calf crop. A bull also has to hold up on native range through a Montana winter.",
    "A bull's paper can look perfect and he still won't make it here if his daughters don't breed back.",
  );

  const sundance = await seller(
    ID.sundance, "demo-sundance@brindle.example", "Sundance Simmental Co.", "SD",
    "Herd Manager", 1998,
    "Sundance runs Simmental and SimAngus seedstock in the Black Hills foothills, selecting hard for " +
      "calving ease and carcass merit without giving up growth. The fall sale is the only offering " +
      "each year — everything else sells private treaty.",
    "Calving ease first. Everything else is a conversation you get to have later.",
  );

  const cedar = await seller(
    ID.cedar, "demo-cedarbluff@brindle.example", "Cedar Bluff Herefords", "KS",
    "Owner", 1974,
    "Three generations of horned and polled Herefords in the Flint Hills. Cedar Bluff has kept the " +
      "same cow families since the seventies and sells bulls almost entirely to repeat commercial " +
      "buyers within a day's haul.",
    "We sell to the same outfits their fathers bought from. That keeps you honest.",
  );

  await prisma.sellerOperation.deleteMany({ where: { sellerId: { in: SELLER_IDS } } });
  await prisma.sellerOperation.createMany({
    data: [
      { sellerId: willow.id, name: "Home Place", location: "Big Timber, Montana", description: "Calving barns, AI facility, and the replacement heifer program.", acres: 4200, herdSize: 620 },
      { sellerId: willow.id, name: "North Unit", location: "Melville, Montana", description: "Summer range for mature cows and the bull development pasture.", acres: 6800, herdSize: 280 },
      { sellerId: sundance.id, name: "Spearfish Headquarters", location: "Spearfish, South Dakota", description: "Seedstock herd, sale facility, and the recipient cow herd.", acres: 3100, herdSize: 410 },
      { sellerId: cedar.id, name: "Cedar Bluff Ranch", location: "Council Grove, Kansas", description: "Flint Hills native pasture and the fall bull development lot.", acres: 5400, herdSize: 350 },
    ],
  });

  const willowSale = await sale(ID.saleWillow, willow.id, "Willow Creek Spring Genetics Sale", 12);
  const sundanceSale = await sale(ID.saleSundance, sundance.id, "Sundance Fall Bull & Female Sale", 26);
  const cedarSale = await sale(ID.saleCedar, cedar.id, "Cedar Bluff Annual Bull Sale", 40);

  await lots(willowSale.id, [
    { lotNumber: 1, category: LotCategory.SEMEN, priceUnit: PriceUnit.DOSE, startingBidCents: 2500n, bidIncrementCents: 250n,
      bullName: "WCG Cimarron 204", bullRegId: "AAA20412207", primaryBreed: "Angus", dosesAvailable: 40, postThawMotility: 62,
      storageFacility: "Cattle Genomics, Navasota TX",
      epd: { CED: 12, BW: { value: -0.4, pct: 15 }, WW: { value: 82, pct: 8 }, YW: { value: 145, pct: 10 }, Milk: { value: 28, pct: 30 }, Marb: { value: 0.72, pct: 12 }, REA: { value: 0.81, pct: 18 } } },
    { lotNumber: 2, category: LotCategory.SEMEN, priceUnit: PriceUnit.DOSE, startingBidCents: 4000n, bidIncrementCents: 250n,
      bullName: "WCG Northfork 771", bullRegId: "AAA20518844", primaryBreed: "Angus", dosesAvailable: 25, postThawMotility: 68,
      storageFacility: "Cattle Genomics, Navasota TX",
      epd: { CED: 8, BW: { value: 1.9, pct: 55 }, WW: { value: 94, pct: 3 }, YW: { value: 171, pct: 2 }, Milk: { value: 24, pct: 45 }, Marb: { value: 0.51, pct: 32 }, REA: { value: 1.14, pct: 5 } } },
    { lotNumber: 3, category: LotCategory.EMBRYO, priceUnit: PriceUnit.EMBRYO, startingBidCents: 65000n, bidIncrementCents: 5000n,
      bullName: "WCG Cimarron 204 x Blackcap 812", bullRegId: "AAA20601133", primaryBreed: "Angus",
      epd: { CED: 11, BW: { value: 0.2, pct: 20 }, WW: { value: 88, pct: 5 }, Marb: { value: 0.83, pct: 6 } } },
    { lotNumber: 4, category: LotCategory.BULLS, priceUnit: PriceUnit.HEAD, startingBidCents: 450000n, bidIncrementCents: 25000n,
      bullName: "WCG Sentinel 903", bullRegId: "AAA20655291", primaryBreed: "Angus",
      epd: { CED: 14, BW: { value: -1.6, pct: 5 }, WW: { value: 71, pct: 25 }, YW: { value: 128, pct: 28 }, Marb: { value: 0.64, pct: 18 } } },
  ]);

  await lots(sundanceSale.id, [
    { lotNumber: 1, category: LotCategory.SEMEN, priceUnit: PriceUnit.DOSE, startingBidCents: 3000n, bidIncrementCents: 200n,
      bullName: "Sundance Rebel 118A", bullRegId: "ASA3312456", primaryBreed: "Simmental", dosesAvailable: 30, postThawMotility: 65,
      storageFacility: "Genex Cooperative, Shawano WI",
      epd: { CED: 9, BW: { value: 0.8, pct: 22 }, WW: { value: 78, pct: 12 }, Marb: { value: 0.45, pct: 40 } } },
    { lotNumber: 2, category: LotCategory.BULLS, priceUnit: PriceUnit.HEAD, startingBidCents: 375000n, bidIncrementCents: 25000n,
      bullName: "Sundance Foreman 402", bullRegId: "ASA3398120", primaryBreed: "SimAngus",
      epd: { CED: 13, BW: { value: -0.9, pct: 10 }, WW: { value: 84, pct: 9 }, YW: { value: 139, pct: 14 }, Marb: { value: 0.58, pct: 22 } } },
    { lotNumber: 3, category: LotCategory.BULLS, priceUnit: PriceUnit.HEAD, startingBidCents: 320000n, bidIncrementCents: 25000n,
      bullName: "Sundance Cutbank 517", bullRegId: "ASA3401998", primaryBreed: "Simmental",
      epd: { CED: 7, BW: { value: 2.4, pct: 62 }, WW: { value: 91, pct: 4 }, YW: { value: 158, pct: 6 }, Marb: { value: 0.39, pct: 55 } } },
  ]);

  await lots(cedarSale.id, [
    { lotNumber: 1, category: LotCategory.BULLS, priceUnit: PriceUnit.HEAD, startingBidCents: 400000n, bidIncrementCents: 25000n,
      bullName: "CB Advance 244", bullRegId: "AHA44012877", primaryBreed: "Hereford",
      epd: { CED: 10, BW: { value: 1.1, pct: 30 }, WW: { value: 68, pct: 20 }, YW: { value: 112, pct: 24 }, Marb: { value: 0.31, pct: 35 } } },
    { lotNumber: 2, category: LotCategory.BULLS, priceUnit: PriceUnit.HEAD, startingBidCents: 355000n, bidIncrementCents: 25000n,
      bullName: "CB Domino 619", bullRegId: "AHA44098210", primaryBreed: "Hereford",
      epd: { CED: 12, BW: { value: -0.3, pct: 12 }, WW: { value: 63, pct: 32 }, YW: { value: 104, pct: 38 }, Marb: { value: 0.28, pct: 42 } } },
    { lotNumber: 3, category: LotCategory.SEMEN, priceUnit: PriceUnit.DOSE, startingBidCents: 2000n, bidIncrementCents: 200n,
      bullName: "CB Advance 244", bullRegId: "AHA44012877", primaryBreed: "Hereford", dosesAvailable: 60, postThawMotility: 71,
      storageFacility: "ORIgen, Huntley MT",
      epd: { CED: 10, BW: { value: 1.1, pct: 30 }, WW: { value: 68, pct: 20 }, Marb: { value: 0.31, pct: 35 } } },
  ]);

  // A sale barn running weekly commercial consignments — the volume channel the
  // market research points at, where ~80% of US calves change hands.
  const barn = await seller(
    ID.barn, "demo-flinthills@brindle.example", "Flint Hills Livestock Market", "KS",
    "Market Manager", 1962,
    "A regular-selling auction market on the Kansas side of the Flint Hills, running a feeder sale every " +
      "Tuesday and a cow sale monthly. Roughly 90,000 head cross the scales in a year, most of it " +
      "consigned by cow-calf operations within a two-hour haul.\n\n" +
      "Lots are sorted for uniformity before they hit the ring — weight, sex, breed type, and flesh — " +
      "because a straight load brings more than the same cattle sold mixed.",
    "Sort them right and the cattle sell themselves. That's most of what a barn is for.",
  );
  const barnSale = await sale(ID.saleBarn, barn.id, "Flint Hills Tuesday Feeder Sale", 3, { barnFees: true });

  await lots(barnSale.id, [
    { lotNumber: 1, category: LotCategory.STEERS, priceUnit: PriceUnit.CWT,
      startingBidCents: 21_800n, bidIncrementCents: 25n, primaryBreed: "Black Angus cross",
      headCount: 300, avgWeightLbs: 575, shrinkPct: 3, originState: "KS",
      programCerts: ["VAC-45", "BQA"] },
    { lotNumber: 2, category: LotCategory.HEIFERS, priceUnit: PriceUnit.CWT,
      startingBidCents: 20_400n, bidIncrementCents: 25n, primaryBreed: "Black Angus cross",
      headCount: 184, avgWeightLbs: 540, shrinkPct: 3, originState: "KS",
      programCerts: ["VAC-45"] },
    { lotNumber: 3, category: LotCategory.STEERS, priceUnit: PriceUnit.CWT,
      startingBidCents: 19_600n, bidIncrementCents: 25n, primaryBreed: "Red Angus / Hereford",
      headCount: 96, avgWeightLbs: 720, shrinkPct: 2, originState: "OK" },
    { lotNumber: 4, category: LotCategory.BRED_HEIFERS, priceUnit: PriceUnit.HEAD,
      startingBidCents: 235_000n, bidIncrementCents: 2_500n, primaryBreed: "Black Angus",
      headCount: 42, avgWeightLbs: 1_050, originState: "KS",
      programCerts: ["BQA"] },
    { lotNumber: 5, category: LotCategory.PAIRS, priceUnit: PriceUnit.HEAD,
      startingBidCents: 285_000n, bidIncrementCents: 2_500n, primaryBreed: "Angus / Simmental",
      headCount: 28, avgWeightLbs: 1_250, originState: "KS" },
    { lotNumber: 6, category: LotCategory.COWS, priceUnit: PriceUnit.CWT,
      startingBidCents: 12_400n, bidIncrementCents: 25n, primaryBreed: "Mixed",
      headCount: 61, avgWeightLbs: 1_310, shrinkPct: 2, originState: "KS" },
  ]);

  const lotCount = await prisma.lot.count({ where: { auctionId: { in: SALE_IDS } } });
  console.log(`seeded 4 sellers, 4 sales, ${lotCount} lots`);
  console.log("content is illustrative — clear it before real sellers list: seed:demo -- --clear");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
