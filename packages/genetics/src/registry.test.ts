import { describe, it, expect } from "vitest";
import { deriveRegistry, registryBadges } from "./registry.js";

describe("deriveRegistry", () => {
  it("maps a known prefix to its association", () => {
    expect(deriveRegistry("AAA20412207")).toEqual({ source: "AAA", code: "AAA", name: "American Angus Association" });
    expect(deriveRegistry("AHA1122334")).toEqual({ source: "AHA", code: "AHA", name: "American Hereford Association" });
    expect(deriveRegistry("ASA998877")).toEqual({ source: "ASA", code: "ASA", name: "American Simmental Association" });
  });

  it("is case-insensitive and tolerates whitespace", () => {
    expect(deriveRegistry("  aaa20412207  ")).toEqual({ source: "AAA", code: "AAA", name: "American Angus Association" });
  });

  it("returns null for an unknown prefix or missing id", () => {
    expect(deriveRegistry("ZZZ123")).toBeNull();
    expect(deriveRegistry(null)).toBeNull();
    expect(deriveRegistry(undefined)).toBeNull();
    expect(deriveRegistry("")).toBeNull();
  });
});

describe("registryBadges", () => {
  it("de-duplicates and sorts by code", () => {
    const badges = registryBadges(["AHA111", "AAA222", "AAA333", null, "ZZZ999"]);
    expect(badges.map((b) => b.code)).toEqual(["AAA", "AHA"]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(registryBadges([null, undefined, "ZZZ1"])).toEqual([]);
  });
});
