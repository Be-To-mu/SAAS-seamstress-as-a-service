/**
 * The pattern studio's engine for the iPhone app. `npm run bundle:ios` packs
 * this into ios/Seamstress/Engine/engine.js, which the app runs in
 * JavaScriptCore, so patterns are made by exactly the same code as on the web.
 *
 * Every function takes and returns plain JSON-able values.
 */
import { DESIGN_MODES, MAX_REFERENCES } from "@/lib/design";
import { demoExtract, extractRequest, extractResult, type ExtractInput } from "@/lib/extractCore";
import { buildPatternPdf } from "@/lib/pdf";
import { previewParts, tryOnParts, VIEW_ANGLES, viewParts, type PreviewInput, type TryOnInput, type ViewInput } from "@/lib/previewCore";
import { compose as composeGarment } from "@/pattern/compose";
import { FAMILIES, familyOf } from "@/pattern/families";
import type { Feature } from "@/pattern/features";
import { estimateFabric } from "@/pattern/layout";
import { RECIPES, tryRecipe } from "@/pattern/recipes";
import { defaultSpec, measurementsSchema, SAMPLE_BODY, type FamilyId, type Measurements, type Spec } from "@/pattern/spec";

export const version = 1;

/** The garment kinds, with the form fields for each. */
export function families() {
  return Object.values(FAMILIES).map((f) => ({ id: f.id, label: f.label, blurb: f.blurb, fields: f.fields }));
}

export const designModes = () => DESIGN_MODES;
export const maxReferences = () => MAX_REFERENCES;
export const sampleBody = () => SAMPLE_BODY;
export const defaultSpecFor = (family: FamilyId) => defaultSpec(family);

/** Check measurements against the web's limits; returns the problems, or none. */
export function checkMeasurements(m: Measurements): string[] {
  const r = measurementsSchema.safeParse(m);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
}

/** The pattern for a design on a body, with its seam check and headline numbers. */
export function compose(spec: Spec, m: Measurements, features: Feature[]) {
  const c = composeGarment(spec, m, features);
  return {
    garment: c.garment,
    stats: c.stats,
    check: c.check,
    featureError: c.featureError ?? null,
    description: familyOf(spec).describe(spec),
    fabric: estimateFabric(c.garment),
  };
}

/** Ready-made features (hood, yoke, side zip…) that apply to this garment, with their operations. */
export function recipes(spec: Spec, m: Measurements, features: Feature[]) {
  const g = composeGarment(spec, m, features).garment;
  return RECIPES.filter((r) => r.families.includes(spec.family))
    .map((r) => ({ id: r.id, title: r.title, explanation: r.explanation, ops: tryRecipe(r, g, spec) }))
    .filter((r) => r.ops !== null);
}

/** The 1:1 tiled PDF, as base64. */
export function patternPdf(spec: Spec, m: Measurements, features: Feature[], title: string): string {
  const doc = buildPatternPdf({ composed: composeGarment(spec, m, features), spec, measurements: m, title });
  const bytes = new Uint8Array(doc.output("arraybuffer"));
  return base64(bytes);
}

export const designDemo = (input: ExtractInput) => demoExtract(input);
export const designRequest = (input: ExtractInput) => extractRequest(input);
/** The prompt and images for a picture of the garment (the image model). */
export const pictureRequest = (input: PreviewInput) => previewParts(input);
/** The angles of the 8-view turnaround, and the request for one of them. */
export const viewAngles = () => VIEW_ANGLES;
export const viewRequest = (input: ViewInput) => viewParts(input);
/** The person wearing the garment (Virtual Fitting Room style). */
export const tryOnRequest = (input: TryOnInput) => tryOnParts(input);

export const designResult = (raw: unknown, input: ExtractInput, model: string) => extractResult(raw, input, model);

function base64(bytes: Uint8Array): string {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += abc[(n >> 18) & 63] + abc[(n >> 12) & 63];
    out += i + 1 < bytes.length ? abc[(n >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? abc[n & 63] : "=";
  }
  return out;
}
