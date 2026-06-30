import { describe, it, expect } from "vitest";
import { formatBuyerNumber, parseBuyerNumber, nextBuyerNumber } from "./buyers.js";
import { stringify, parse } from "./sequencer/json.js";

describe("buyer number format", () => {
  it("zero-pads to a fixed width", () => {
    expect(formatBuyerNumber(1)).toBe("B-000001");
    expect(formatBuyerNumber(123456)).toBe("B-123456");
  });

  it("round-trips through parse", () => {
    expect(parseBuyerNumber("B-000042")).toBe(42);
    expect(parseBuyerNumber("nope")).toBeNull();
    expect(parseBuyerNumber("B-")).toBeNull();
  });
});

describe("nextBuyerNumber", () => {
  it("starts at 1 when none issued", () => {
    expect(nextBuyerNumber([])).toBe("B-000001");
  });

  it("takes one past the current max, ignoring junk", () => {
    expect(nextBuyerNumber(["B-000001", "B-000007", "garbage", "B-000003"])).toBe("B-000008");
  });
});

describe("bigint-safe wire JSON", () => {
  it("round-trips integer-cent bigints losslessly", () => {
    const bid = { amountCents: 525_00n, proxyMaxCents: 999_999_999_999n, lotId: "x" };
    const back = parse<typeof bid>(stringify(bid));
    expect(back.amountCents).toBe(525_00n);
    expect(typeof back.amountCents).toBe("bigint");
    expect(back.proxyMaxCents).toBe(999_999_999_999n);
    expect(back.lotId).toBe("x");
  });
});
