import { describe, it, expect } from "vitest";
import { evaluateShipment, requiredDocs, type DocCode } from "./index.js";

describe("evaluateShipment", () => {
  it("requires nothing extra for an in-state non-breeding cattle sale outside brand law", () => {
    const r = evaluateShipment({ species: "CATTLE", originState: "IA", destState: "IA" });
    expect(r.interstate).toBe(false);
    expect(r.required).toHaveLength(0);
    expect(r.clear).toBe(true);
  });

  it("requires a CVI for interstate movement", () => {
    const r = evaluateShipment({ species: "CATTLE", originState: "IA", destState: "NE" });
    // NE is a brand state but IA (origin) is not -> only CVI here
    expect(r.required.map((x) => x.code)).toContain("CVI");
  });

  it("requires brand inspection when the ORIGIN is a brand-law state", () => {
    const r = evaluateShipment({ species: "CATTLE", originState: "MT", destState: "MN" });
    const codes = r.required.map((x) => x.code);
    expect(codes).toEqual(expect.arrayContaining(["CVI", "BRAND_INSPECTION"]));
  });

  it("requires scrapie ID for sheep and goats", () => {
    for (const species of ["SHEEP", "GOAT"] as const) {
      const r = evaluateShipment({ species, originState: "IA", destState: "IA" });
      expect(r.required.map((x) => x.code)).toContain("SCRAPIE_ID");
    }
  });

  it("adds trich + interstate brucellosis for breeding bulls", () => {
    const r = evaluateShipment({ species: "CATTLE", originState: "TX", destState: "KS", breedingIntactMale: true });
    const codes = r.required.map((x) => x.code);
    expect(codes).toEqual(expect.arrayContaining(["CVI", "BRAND_INSPECTION", "TRICH_TEST", "BRUCELLOSIS_TEST"]));
  });

  it("does not require brucellosis for an in-state breeding bull", () => {
    const r = evaluateShipment({ species: "CATTLE", originState: "TX", destState: "TX", breedingIntactMale: true });
    const codes = r.required.map((x) => x.code);
    expect(codes).toContain("TRICH_TEST");
    expect(codes).not.toContain("BRUCELLOSIS_TEST");
  });

  it("clears once every required doc is provided", () => {
    const provided: DocCode[] = ["CVI", "BRAND_INSPECTION", "TRICH_TEST", "BRUCELLOSIS_TEST"];
    const r = evaluateShipment({ species: "CATTLE", originState: "MT", destState: "KS", breedingIntactMale: true, providedDocs: provided });
    expect(r.missing).toHaveLength(0);
    expect(r.clear).toBe(true);
  });

  it("reports exactly the missing docs", () => {
    const r = evaluateShipment({ species: "SHEEP", originState: "CO", destState: "NM", providedDocs: ["CVI"] });
    // interstate sheep -> CVI + SCRAPIE_ID; CVI provided, scrapie missing
    expect(r.missing.map((x) => x.code)).toEqual(["SCRAPIE_ID"]);
    expect(r.clear).toBe(false);
  });

  it("requiredDocs is pure and matches evaluateShipment", () => {
    const ctx = { species: "GOAT" as const, originState: "ID", destState: "WA" };
    expect(requiredDocs(ctx)).toEqual(evaluateShipment(ctx).required);
  });
});
