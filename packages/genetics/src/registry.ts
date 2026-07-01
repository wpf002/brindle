import type { EpdSource } from "./traits.js";

// A bull's registration number is issued by its breed association, and its
// prefix identifies which one — the same signal a buyer reads at a glance on
// paper. Deriving the badge from the existing registration number means a
// seller never has to separately declare "which registry," and the two can
// never drift out of sync.
export interface RegistryInfo {
  source: EpdSource;
  code: string;
  name: string;
}

const REGISTRIES: Record<Exclude<EpdSource, "OTHER">, RegistryInfo> = {
  AAA: { source: "AAA", code: "AAA", name: "American Angus Association" },
  AHA: { source: "AHA", code: "AHA", name: "American Hereford Association" },
  ASA: { source: "ASA", code: "ASA", name: "American Simmental Association" },
};

/** Derive the breed registry from a registration number's prefix, e.g. "AAA20412207". */
export function deriveRegistry(regId: string | null | undefined): RegistryInfo | null {
  if (!regId) return null;
  const prefix = /^([A-Z]{2,4})/.exec(regId.trim().toUpperCase())?.[1];
  if (!prefix) return null;
  return (REGISTRIES as Record<string, RegistryInfo>)[prefix] ?? null;
}

/** De-duplicated, sorted registry badges for a set of registration numbers. */
export function registryBadges(regIds: Array<string | null | undefined>): RegistryInfo[] {
  const seen = new Map<string, RegistryInfo>();
  for (const id of regIds) {
    const r = deriveRegistry(id);
    if (r) seen.set(r.code, r);
  }
  return [...seen.values()].sort((a, b) => a.code.localeCompare(b.code));
}
