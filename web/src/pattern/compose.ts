import { checkGarment } from "./check";
import { familyOf, type Stat } from "./families";
import type { Feature } from "./features";
import { applyOps } from "./ops";
import type { Measurements, Spec } from "./spec";
import type { CheckResult, Garment } from "./types";

export interface Composed {
  garment: Garment;
  /** A few headline numbers for the finished garment (finished chest, length, and so on). */
  stats: Stat[];
  check: CheckResult;
  /** Set when a saved feature no longer applies (for example after changing the body). */
  featureError?: string;
}

/** The base block for the design and body, with every feature's operations applied in order. */
export function compose(spec: Spec, m: Measurements, features: Feature[]): Composed {
  const { garment: base, stats } = familyOf(spec).build(spec, m);
  let garment = base;
  let featureError: string | undefined;
  for (const f of features) {
    const res = applyOps(garment, f.ops);
    if (res.error) {
      featureError = `Feature "${f.request}": ${res.error}`;
      break;
    }
    garment = res.garment;
  }
  return { garment, stats, check: checkGarment(garment), featureError };
}
