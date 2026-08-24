import { describe, it, expect } from "vitest";
import {
  buildMarketPost, weightedAverageCents, formatCwt, formatClassName, formatReportDate, basisOf,
  type ReportRow,
} from "./report.js";

// The 5 Area Daily report — the one a daily write-up is built from.
const DAILY = "DATAMART-2466";
// The 5 Area Weekly. Same dates, same class names, week-to-date coverage.
const WEEKLY = "DATAMART-2477";

function row(over: Partial<ReportRow> = {}): ReportRow {
  return {
    category: "STEER — DRESSED DELIVERED",
    region: "MO",
    wtLowLbs: 800,
    wtHighLbs: 1000,
    avgCentsPerCwt: 35_000,
    headCount: 100,
    source: DAILY,
    ...over,
  };
}

describe("formatCwt", () => {
  it("renders integer cents as dollars", () => {
    expect(formatCwt(35_546)).toBe("$355.46");
    expect(formatCwt(35_500)).toBe("$355.00");
    expect(formatCwt(5)).toBe("$0.05");
  });

  it("keeps the sign outside the dollar mark", () => {
    expect(formatCwt(-214)).toBe("-$2.14");
  });
});

describe("formatClassName", () => {
  it("softens the all-caps AMS class names", () => {
    expect(formatClassName("STEER — DRESSED DELIVERED")).toBe("Steer — Dressed Delivered");
    expect(formatClassName("HEIFER — NEGOTIATED LIVE")).toBe("Heifer — Negotiated Live");
  });

  it("capitalises both sides of a slash", () => {
    expect(formatClassName("MIXED STEER/HEIFER — LIVE FOB")).toBe("Mixed Steer/Heifer — Live FOB");
  });

  // "Fob" reads as a typo to anyone in the business.
  it("leaves trade acronyms alone", () => {
    expect(formatClassName("ALL BEEF TYPE — LIVE FOB")).toBe("All Beef Type — Live FOB");
    expect(formatClassName("STEER FOB TX")).toBe("Steer FOB TX");
  });
});

describe("formatReportDate", () => {
  it("does not depend on the machine's locale", () => {
    expect(formatReportDate("2026-08-21")).toBe("August 21, 2026");
    expect(formatReportDate("2026-01-01")).toBe("January 1, 2026");
  });

  it("passes through anything that isn't a date", () => {
    expect(formatReportDate("not-a-date")).toBe("not-a-date");
  });
});

describe("weightedAverageCents", () => {
  it("weights by head, not by row", () => {
    // 10 head at $300, 990 head at $400 — a plain mean would say $350.
    const avg = weightedAverageCents([
      row({ avgCentsPerCwt: 30_000, headCount: 10 }),
      row({ avgCentsPerCwt: 40_000, headCount: 990 }),
    ]);
    expect(avg).toBe(39_900);
  });

  it("ignores rows reporting no head", () => {
    expect(weightedAverageCents([
      row({ avgCentsPerCwt: 30_000, headCount: 0 }),
      row({ avgCentsPerCwt: 40_000, headCount: 50 }),
    ])).toBe(40_000);
  });

  it("returns null when nothing reports head", () => {
    expect(weightedAverageCents([row({ headCount: 0 })])).toBeNull();
    expect(weightedAverageCents([])).toBeNull();
  });
});

describe("basisOf", () => {
  it("separates live from dressed", () => {
    expect(basisOf("STEER — DRESSED DELIVERED")).toBe("dressed");
    expect(basisOf("STEER — LIVE FOB")).toBe("live");
  });

  it("falls back to other for classes naming neither", () => {
    expect(basisOf("ALL BEEF TYPE")).toBe("other");
  });
});

// AMS publishes each quote twice: once per sex class and once as an "All Beef
// Type" roll-up of those same cattle. Summing all of it counts every animal
// twice — the 2026-08-21 report would have claimed 16,688 head against a true
// 8,344.
describe("roll-up de-duplication", () => {
  const quote = [
    row({ category: "STEER — LIVE FOB", avgCentsPerCwt: 22_532, headCount: 3391 }),
    row({ category: "HEIFER — LIVE FOB", avgCentsPerCwt: 22_540, headCount: 1236 }),
    row({ category: "MIXED STEER/HEIFER — LIVE FOB", avgCentsPerCwt: 22_500, headCount: 653 }),
    row({ category: "ALL BEEF TYPE — LIVE FOB", avgCentsPerCwt: 22_530, headCount: 5280 }),
  ];

  it("counts the roll-up, not the roll-up plus its parts", () => {
    const post = buildMarketPost({ reportDate: "2026-08-21", source: DAILY, rows: quote })!;
    expect(post.dek).toContain("5,280 head"); // not 10,560
  });

  it("still lists the sex classes as the detail underneath", () => {
    const post = buildMarketPost({ reportDate: "2026-08-21", source: DAILY, rows: quote })!;
    expect(post.body).toContain("Steer — Live FOB");
    expect(post.body).toContain("Heifer — Live FOB");
    expect(post.body).toContain("Mixed Steer/Heifer — Live FOB");
    // The roll-up is a total, not a fourth class beside its own parts.
    expect(post.body).not.toContain("All Beef Type — Live FOB:");
  });

  it("totals each quote separately, since a roll-up covers only its own", () => {
    const post = buildMarketPost({
      reportDate: "2026-08-21",
      source: DAILY,
      rows: [
        ...quote,
        row({ category: "ALL BEEF TYPE — LIVE DELIVERED", avgCentsPerCwt: 22_600, headCount: 30 }),
        row({ category: "MIXED STEER/HEIFER — LIVE DELIVERED", avgCentsPerCwt: 22_600, headCount: 30 }),
      ],
    })!;
    expect(post.dek).toContain("5,310 head"); // 5,280 + 30
  });

  it("falls back to the classes when a quote publishes no roll-up", () => {
    const post = buildMarketPost({
      reportDate: "2026-08-21",
      source: DAILY,
      rows: [
        row({ category: "STEER — LIVE FOB", avgCentsPerCwt: 22_000, headCount: 100 }),
        row({ category: "HEIFER — LIVE FOB", avgCentsPerCwt: 23_000, headCount: 100 }),
      ],
    })!;
    expect(post.dek).toContain("200 head");
  });

  it("still reports a quote that publishes only a roll-up", () => {
    const post = buildMarketPost({
      reportDate: "2026-08-21",
      source: DAILY,
      rows: [row({ category: "ALL BEEF TYPE — LIVE FOB", avgCentsPerCwt: 22_530, headCount: 400 })],
    })!;
    expect(post.dek).toContain("400 head");
    expect(post.body).toContain("All Beef Type — Live FOB: $225.30 on 400 head");
  });
});

// AMS publishes several reports that share dates and class names but cover
// different spans: the 5 Area Daily is one day's trade, the 5 Area Weekly is the
// week to date and therefore contains the same cattle again. Mixing them counted
// animals twice and called a week's trade a day's.
describe("source separation", () => {
  const daily = [row({ category: "STEER — LIVE FOB", avgCentsPerCwt: 22_440, headCount: 6721, source: DAILY })];
  const weekly = [row({ category: "STEER — LIVE FOB", avgCentsPerCwt: 22_501, headCount: 21_432, source: WEEKLY })];

  it("ignores rows from any other report", () => {
    const post = buildMarketPost({ reportDate: "2026-08-24", source: DAILY, rows: [...daily, ...weekly] })!;
    expect(post.dek).toContain("6,721 head"); // not 28,153
    expect(post.title).toContain("$224.40"); // the daily price, not a blend
  });

  it("compares against the same report a day earlier, not a different one", () => {
    const post = buildMarketPost({
      reportDate: "2026-08-24",
      source: DAILY,
      rows: [...daily, ...weekly],
      previous: {
        reportDate: "2026-08-21",
        rows: [
          row({ category: "STEER — LIVE FOB", avgCentsPerCwt: 22_240, headCount: 5000, source: DAILY }),
          row({ category: "STEER — LIVE FOB", avgCentsPerCwt: 30_000, headCount: 9999, source: WEEKLY }),
        ],
      },
    })!;
    // $224.40 vs the daily $222.40 — the weekly's $300 must not enter into it.
    expect(post.title).toContain("Fed Cattle Up $2.00 to $224.40 live");
  });

  it("publishes nothing when the requested report has no rows that day", () => {
    expect(buildMarketPost({ reportDate: "2026-08-24", source: DAILY, rows: weekly })).toBeNull();
  });
});

describe("buildMarketPost", () => {
  // Real shape of the AMS feed: the same cattle quoted two ways.
  const live = [
    row({ category: "STEER — LIVE FOB", avgCentsPerCwt: 22_532, headCount: 3391 }),
    row({ category: "HEIFER — LIVE FOB", avgCentsPerCwt: 22_540, headCount: 1236 }),
  ];
  const dressed = [
    row({ category: "STEER — DRESSED DELIVERED", avgCentsPerCwt: 35_546, headCount: 1940 }),
    row({ category: "HEIFER — DRESSED DELIVERED", avgCentsPerCwt: 35_537, headCount: 815 }),
  ];
  const rows = [...live, ...dressed];

  it("publishes nothing when there are no rows", () => {
    expect(buildMarketPost({ reportDate: "2026-08-21", source: DAILY, rows: [] })).toBeNull();
  });

  it("publishes nothing when no row reports head", () => {
    expect(buildMarketPost({ reportDate: "2026-08-21", source: DAILY, rows: [row({ headCount: 0 })] })).toBeNull();
  });

  // The bug this design exists to prevent. Live (~$225 on the hoof) and dressed
  // (~$355 hanging) describe the same cattle; a blended "$272" is a number that
  // exists nowhere, and any cattleman would spot it instantly.
  it("never blends live and dressed into one average", () => {
    const post = buildMarketPost({ reportDate: "2026-08-21", source: DAILY, rows })!;
    expect(post.title).not.toContain("$272");
    expect(post.body).not.toContain("$272");
    expect(post.dek).toContain("$225.34 live");
    expect(post.dek).toContain("$355.43 dressed");
  });

  it("labels the basis in the headline, since an unlabelled price is ambiguous", () => {
    const post = buildMarketPost({ reportDate: "2026-08-21", source: DAILY, rows })!;
    // 4,627 head traded live against 2,755 dressed, so live leads.
    expect(post.title).toBe("Fed Cattle at $225.34 live — August 21, 2026");
  });

  it("compares each basis only against the same basis a day earlier", () => {
    const post = buildMarketPost({
      reportDate: "2026-08-21",
      source: DAILY,
      rows,
      previous: {
        reportDate: "2026-08-20",
        // Live down $2.00 day over day; dressed up $3.00.
        rows: [
          ...live.map((r) => ({ ...r, avgCentsPerCwt: r.avgCentsPerCwt + 200 })),
          ...dressed.map((r) => ({ ...r, avgCentsPerCwt: r.avgCentsPerCwt - 300 })),
        ],
      },
    })!;
    expect(post.title).toBe("Fed Cattle Down $2.00 to $225.34 live — August 21, 2026");
    expect(post.body).toContain("down $2.00 from $227.34 on August 20, 2026");
    expect(post.body).toContain("up $3.00 from $352.43 on August 20, 2026");
  });

  it("reports the spread within a basis, never across them", () => {
    const post = buildMarketPost({ reportDate: "2026-08-21", source: DAILY, rows })!;
    // The live/dressed gap is ~$130 and is the dressing percentage, not news.
    expect(post.body).not.toContain("$130");
    // The within-basis ranges here are pennies, so neither is worth a line.
    expect(post.body).not.toContain("ranged");
  });

  it("does report a genuine within-basis range", () => {
    const post = buildMarketPost({
      reportDate: "2026-08-21",
      source: DAILY,
      rows: [
        row({ category: "STEER — LIVE FOB", avgCentsPerCwt: 22_000, headCount: 500 }),
        row({ category: "HEIFER — LIVE FOB", avgCentsPerCwt: 23_500, headCount: 500 }),
      ],
    })!;
    expect(post.body).toContain("Classes on the live basis ranged $15.00 per hundredweight from $220.00 to $235.00");
  });

  it("explains why there is no single headline number", () => {
    const post = buildMarketPost({ reportDate: "2026-08-21", source: DAILY, rows })!;
    expect(post.body).toContain("averaging them together would produce a figure that means nothing");
  });

  it("leaves that explanation out when only one basis reported", () => {
    const post = buildMarketPost({ reportDate: "2026-08-21", source: DAILY, rows: live })!;
    expect(post.body).not.toContain("means nothing");
    expect(post.title).toContain("live");
  });

  it("leads with whichever basis the most cattle traded on", () => {
    const dressedHeavy = [
      row({ category: "STEER — LIVE FOB", avgCentsPerCwt: 22_532, headCount: 100 }),
      row({ category: "STEER — DRESSED DELIVERED", avgCentsPerCwt: 35_546, headCount: 9000 }),
    ];
    const post = buildMarketPost({ reportDate: "2026-08-21", source: DAILY, rows: dressedHeavy })!;
    expect(post.title).toBe("Fed Cattle at $355.46 dressed — August 21, 2026");
  });

  it("calls a small move steady rather than reporting noise as a trend", () => {
    const post = buildMarketPost({
      reportDate: "2026-08-21",
      source: DAILY,
      rows: live,
      previous: { reportDate: "2026-08-20", rows: live.map((r) => ({ ...r, avgCentsPerCwt: r.avgCentsPerCwt + 20 })) },
    })!;
    expect(post.title).toContain("Fed Cattle Steady at $225.34 live");
    expect(post.body).toContain("essentially unchanged from August 20, 2026");
  });

  it("uses a date-derived slug so a re-run overwrites rather than duplicates", () => {
    const a = buildMarketPost({ reportDate: "2026-08-21", source: DAILY, rows })!;
    const b = buildMarketPost({ reportDate: "2026-08-21", source: DAILY, rows })!;
    expect(a.slug).toBe("market-report-2026-08-21");
    expect(b.body).toBe(a.body); // byte-identical, so the upsert is a no-op
  });

  it("groups multiple weight bands of one class into a single line", () => {
    const post = buildMarketPost({
      reportDate: "2026-08-21",
      source: DAILY,
      rows: [
        row({ category: "STEER — LIVE FOB", wtLowLbs: 800, wtHighLbs: 900, avgCentsPerCwt: 30_000, headCount: 100 }),
        row({ category: "STEER — LIVE FOB", wtLowLbs: 900, wtHighLbs: 1000, avgCentsPerCwt: 40_000, headCount: 300 }),
      ],
    })!;
    // Head-weighted: (300*100 + 400*300)/400 = $375.00 on 400 head.
    expect(post.body).toContain("Steer — Live FOB: $375.00 on 400 head");
  });

  it("lists classes most-traded first", () => {
    const post = buildMarketPost({ reportDate: "2026-08-21", source: DAILY, rows })!;
    const steer = post.body.indexOf("Steer — Live FOB");
    const heifer = post.body.indexOf("Heifer — Live FOB");
    expect(steer).toBeGreaterThan(-1);
    expect(heifer).toBeGreaterThan(steer); // 3,391 head outranks 1,236
  });

  it("thousands-separates head counts", () => {
    const post = buildMarketPost({ reportDate: "2026-08-21", source: DAILY, rows })!;
    expect(post.dek).toContain("7,382 head");
  });

  it("always carries the LMPR caveat, because misreading this feed is easy", () => {
    const post = buildMarketPost({ reportDate: "2026-08-21", source: DAILY, rows })!;
    expect(post.body).toContain("Livestock Mandatory Price Reporting");
    expect(post.body).toContain("not a substitute for feeder-calf averages");
  });

  it("never claims a human wrote it", () => {
    const post = buildMarketPost({ reportDate: "2026-08-21", source: DAILY, rows })!;
    expect(post.authorName).toBe("Brindle Market Desk");
    expect(post.body).toContain("No one at Brindle wrote or reviewed this summary");
  });

  it("dates the post to the report, not to when it ran", () => {
    const post = buildMarketPost({ reportDate: "2026-08-21", source: DAILY, rows })!;
    expect(post.publishedAt).toBe("2026-08-21");
  });
});
