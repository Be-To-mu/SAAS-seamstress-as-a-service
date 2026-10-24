import { checkGarment } from "./check";
import { familyOf, type Stat } from "./families";
import type { Feature } from "./features";
import { applyOps } from "./ops";
import { clampFit, type Fit, type Measurements, type Spec } from "./spec";
import type { CheckResult, Garment } from "./types";

export interface Composed {
  garment: Garment;
  /** A few headline numbers for the finished garment (finished chest, length, and so on). */
  stats: Stat[];
  check: CheckResult;
  /** Set when a saved feature no longer applies (for example after changing the body). */
  featureError?: string;
}

/**
 * The base block for the design and body, with every feature's operations applied in order.
 * `fit` carries the wearer's adjustments: shoulder and sleeve go in through the measurements the
 * blocks already use, length and waist shaping through the block itself (skirts take the waist
 * through their waist measurement).
 */
export function compose(spec: Spec, m: Measurements, features: Feature[], fit: Fit = {}): Composed {
  const f = clampFit(fit);
  const body: Measurements = {
    ...m,
    shoulder: m.shoulder + f.shoulder,
    armLength: m.armLength + f.sleeve,
    waist: spec.family === "skirt" ? m.waist + f.waist : m.waist,
  };
  const { garment: base, stats } = familyOf(spec).build(spec, body, f);
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
