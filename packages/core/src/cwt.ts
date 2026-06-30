// All cattle pricing math lives here and NOWHERE else.
// cwt = hundredweight = 100 lbs. Cattle sell per-cwt or per-head.
// Weight is carried in integer hundredths-of-a-pound ("centilbs") to stay exact.
import { type Cents, divRound } from "./money.js";

export function lbsToCentilbs(lbs: number): bigint {
  return BigInt(Math.round(lbs * 100));
}

/** Total for a per-cwt lot. centsPerCwt is integer cents per hundredweight. */
export function totalFromCwt(centsPerCwt: Cents, avgWeightLbs: number, head: number): Cents {
  const totalCentilbs = lbsToCentilbs(avgWeightLbs) * BigInt(head); // hundredths of a lb
  // cwt = lbs / 100 ; centilbs / 100 = lbs ; lbs / 100 = cwt -> cwt = centilbs / 10_000
  return divRound(centsPerCwt * totalCentilbs, 10_000n);
}

/** Total for a per-head lot. */
export function totalFromHead(centsPerHead: Cents, head: number): Cents {
  return centsPerHead * BigInt(head);
}

/** Total for a per-dose genetics lot. */
export function totalFromDose(centsPerDose: Cents, doses: number): Cents {
  return centsPerDose * BigInt(doses);
}
