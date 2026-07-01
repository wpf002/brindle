export {
  ANGUS_TRAITS,
  TRAITS_BY_SOURCE,
  type TraitDef,
  type TraitDirection,
  type EpdSource,
  type EpdValue,
  type EpdSet,
} from "./traits.js";
export {
  compareBulls,
  summarizeWins,
  barFromPercentile,
  type BullEpdInput,
  type ComparisonCell,
  type TraitComparison,
} from "./compare.js";
export { parseEpdSet, type EpdParseResult } from "./ingest.js";
