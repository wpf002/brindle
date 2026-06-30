// USDA AMS video/internet auction reports -> comparable-sale context shown
// inline at the bid box. Same ingestion-plus-valuation pattern as Furlong.
export interface ComparableSale {
  reportDate: string;
  region: string;
  category: string;       // e.g. "STEERS Medium/Large 1"
  weightBandLbs: [number, number];
  weightedAvgCentsPerCwt: number;
  headCount: number;
  source: string;         // AMS report id
}

export interface ComparablesQuery {
  category: string;
  weightLbs: number;
  region?: string;
  asOf?: string;
}

// Phase 3: implement AMS ingest + basis-from-futures. Interface is stable now.
export interface MarketDataSource {
  comparables(q: ComparablesQuery): Promise<ComparableSale[]>;
}
