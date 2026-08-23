import { describe, it, expect } from "vitest";
import { parseCsv, parseCsvRecords } from "./csv.js";
import { detectColumns, detectEpdColumns, dollarsToCents } from "./mapping.js";
import { parseCatalogCsv } from "./index.js";

describe("parseCsv", () => {
  it("parses a simple grid", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("keeps commas inside quoted fields", () => {
    // The single most common way a naive split(',') mangles a real catalog.
    expect(parseCsv('name,lot\n"Sitz Stellar 726D, ET",1')).toEqual([
      ["name", "lot"],
      ["Sitz Stellar 726D, ET", "1"],
    ]);
  });

  it("handles escaped quotes", () => {
    expect(parseCsv('a\n"He said ""hi"""')).toEqual([["a"], ['He said "hi"']]);
  });

  it("handles CRLF and bare CR line endings", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("a,b\r1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("strips an Excel BOM from the first header", () => {
    expect(parseCsv("﻿lot,name\n1,x")[0]).toEqual(["lot", "name"]);
  });

  it("preserves newlines inside a quoted field", () => {
    expect(parseCsv('note\n"line one\nline two"')).toEqual([["note"], ["line one\nline two"]]);
  });

  it("ignores trailing blank lines", () => {
    expect(parseCsv("a\n1\n\n")).toEqual([["a"], ["1"]]);
  });
});

describe("parseCsvRecords", () => {
  it("keys rows by normalized header", () => {
    const recs = parseCsvRecords("Lot #,Bull Name\n1,Cimarron");
    expect(recs).toEqual([{ lot: "1", bullname: "Cimarron" }]);
  });
});

describe("detectColumns", () => {
  it("matches varied real-world header spellings", () => {
    const cols = detectColumns(["Lot #", "Registration Number", "Opening Bid", "Doses Available"]);
    expect(cols.lotNumber).toBe("Lot #");
    expect(cols.bullRegId).toBe("Registration Number");
    expect(cols.startingBidCents).toBe("Opening Bid");
    expect(cols.dosesAvailable).toBe("Doses Available");
  });

  it("returns nothing for a field with no matching column", () => {
    expect(detectColumns(["Lot"]).storageFacility).toBeUndefined();
  });
});

describe("detectEpdColumns", () => {
  it("finds EPD trait columns by key", () => {
    const epd = detectEpdColumns(["Lot", "CED", "BW", "WW", "Marb", "NotATrait"]);
    expect(Object.keys(epd).sort()).toEqual(["BW", "CED", "Marb", "WW"]);
  });
});

describe("dollarsToCents", () => {
  it("parses plain, symbol-prefixed, and grouped amounts", () => {
    expect(dollarsToCents("25")).toBe(2500n);
    expect(dollarsToCents("$1,250.00")).toBe(125000n);
    expect(dollarsToCents("0.50")).toBe(50n);
  });

  it("truncates beyond cents rather than rounding into a float", () => {
    expect(dollarsToCents("1.999")).toBe(199n);
  });

  it("rejects junk", () => {
    expect(dollarsToCents("abc")).toBeNull();
    expect(dollarsToCents("")).toBeNull();
  });
});

describe("parseCatalogCsv", () => {
  it("parses a realistic genetics catalog export", () => {
    const csv = [
      "Lot #,Bull Name,Registration Number,Opening Bid,Doses,CED,BW,WW,Marb",
      '1,"WCG Cimarron 204, ET",AAA20412207,"$25.00",40,8,1.2,72,0.82',
      "2,Sundance Rebel 118A,ASA3312456,$30.00,30,9,0.8,78,0.45",
    ].join("\n");

    const parsed = parseCatalogCsv(csv);
    expect(parsed.errors).toEqual([]);
    expect(parsed.lots).toHaveLength(2);

    const [first] = parsed.lots;
    expect(first!.lotNumber).toBe(1);
    expect(first!.bullName).toBe("WCG Cimarron 204, ET"); // quoted comma survived
    expect(first!.bullRegId).toBe("AAA20412207");
    expect(first!.startingBidCents).toBe("2500");
    expect(first!.dosesAvailable).toBe(40);
    expect(first!.category).toBe("SEMEN"); // default for a genetics catalog
    expect(first!.priceUnit).toBe("DOSE"); // derived from category
    expect(first!.epd).toEqual({
      CED: { value: 8 }, BW: { value: 1.2 }, WW: { value: 72 }, Marb: { value: 0.82 },
    });
  });

  it("collects bad rows as errors without dropping the good ones", () => {
    const csv = [
      "Lot,Name,Opening Bid",
      "1,Good Bull,$25.00",
      ",Missing Lot Number,$30.00",
      "3,No Bid,",
      "4,Also Good,$40.00",
    ].join("\n");

    const parsed = parseCatalogCsv(csv);
    expect(parsed.lots.map((l) => l.lotNumber)).toEqual([1, 4]);
    expect(parsed.errors).toEqual([
      { row: 2, message: "Missing or invalid lot number" },
      { row: 3, message: "Missing or invalid opening bid" },
    ]);
  });

  it("rejects a duplicate lot number", () => {
    const csv = "Lot,Opening Bid\n1,$10.00\n1,$20.00";
    const parsed = parseCatalogCsv(csv);
    expect(parsed.lots).toHaveLength(1);
    expect(parsed.errors[0]!.message).toMatch(/Duplicate lot number 1/);
  });

  it("normalizes free-text categories and infers the price unit", () => {
    const csv = "Lot,Type,Opening Bid,Head\n1,Bulls,$3000.00,1";
    const parsed = parseCatalogCsv(csv, { defaultCategory: "SEMEN" });
    expect(parsed.lots[0]!.category).toBe("BULLS");
    expect(parsed.lots[0]!.priceUnit).toBe("HEAD");
  });

  it("handles an empty file", () => {
    expect(parseCatalogCsv("").errors[0]!.message).toBe("File is empty");
  });

  it("skips blank spreadsheet filler rows silently", () => {
    const csv = "Lot,Opening Bid\n1,$10.00\n,\n,";
    const parsed = parseCatalogCsv(csv);
    expect(parsed.lots).toHaveLength(1);
    expect(parsed.errors).toEqual([]);
  });
});
