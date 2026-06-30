// Bids and events carry integer-cent bigints, which JSON can't represent. Tag
// them on the way out and revive them on the way in so the wire stays lossless
// and the engine never sees a float.
type Tagged = { __bigint__: string };

function isTagged(v: unknown): v is Tagged {
  return typeof v === "object" && v !== null && "__bigint__" in v;
}

export function stringify(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    typeof v === "bigint" ? { __bigint__: v.toString() } : v,
  );
}

export function parse<T>(text: string): T {
  return JSON.parse(text, (_k, v) => (isTagged(v) ? BigInt(v.__bigint__) : v)) as T;
}
