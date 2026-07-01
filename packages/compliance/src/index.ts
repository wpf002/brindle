// Multi-state shipment compliance. As Brindle expands past its first state and
// past cattle, each sale has to clear the paperwork for moving live animals: an
// interstate health certificate (CVI), brand inspection in brand-law states,
// scrapie ID for small ruminants, and breeding-soundness tests. This is a pure
// rules layer — the console blocks activation / the buyer sees requirements off
// of it; nothing here talks to a database.

export type Species = "CATTLE" | "SHEEP" | "GOAT";

export type DocCode =
  | "CVI" // Certificate of Veterinary Inspection (interstate health cert)
  | "BRAND_INSPECTION"
  | "SCRAPIE_ID"
  | "TRICH_TEST" // trichomoniasis — breeding bulls
  | "BRUCELLOSIS_TEST";

export interface DocRequirement {
  code: DocCode;
  reason: string;
}

export interface ShipmentContext {
  species: Species;
  originState: string; // USPS abbr
  destState: string;
  /** Intact male sold for breeding — triggers trich/brucellosis rules. */
  breedingIntactMale?: boolean;
  /** Document codes already on file for the lot (disease certs, brand papers). */
  providedDocs?: DocCode[];
}

export interface ComplianceResult {
  interstate: boolean;
  required: DocRequirement[];
  missing: DocRequirement[];
  clear: boolean;
}

// Brand-inspection law states (cattle). Movement/change-of-ownership needs a
// brand inspection in these jurisdictions.
const BRAND_STATES = new Set([
  "MT", "WY", "CO", "ID", "NV", "UT", "NM", "AZ", "OR", "WA", "CA", "ND", "SD", "TX", "OK", "NE", "KS",
]);

export function requiredDocs(ctx: ShipmentContext): DocRequirement[] {
  const interstate = ctx.originState !== ctx.destState;
  const reqs: DocRequirement[] = [];

  if (interstate) {
    reqs.push({ code: "CVI", reason: "Interstate movement requires a Certificate of Veterinary Inspection" });
  }
  if (ctx.species === "CATTLE" && BRAND_STATES.has(ctx.originState)) {
    reqs.push({ code: "BRAND_INSPECTION", reason: `${ctx.originState} is a brand-inspection state` });
  }
  if (ctx.species === "SHEEP" || ctx.species === "GOAT") {
    reqs.push({ code: "SCRAPIE_ID", reason: "Sheep/goats require official scrapie identification" });
  }
  if (ctx.species === "CATTLE" && ctx.breedingIntactMale) {
    reqs.push({ code: "TRICH_TEST", reason: "Breeding bulls require a trichomoniasis test" });
    if (interstate) {
      reqs.push({ code: "BRUCELLOSIS_TEST", reason: "Intact breeding cattle moving interstate require brucellosis testing" });
    }
  }
  return reqs;
}

/** What's required, what's missing, and whether the shipment can clear. */
export function evaluateShipment(ctx: ShipmentContext): ComplianceResult {
  const interstate = ctx.originState !== ctx.destState;
  const required = requiredDocs(ctx);
  const provided = new Set(ctx.providedDocs ?? []);
  const missing = required.filter((r) => !provided.has(r.code));
  return { interstate, required, missing, clear: missing.length === 0 };
}
