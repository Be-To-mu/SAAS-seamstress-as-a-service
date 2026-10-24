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
import { dressParts, mannequinParts, previewParts, tryOnParts, VIEW_ANGLES, viewParts, type DressInput, type MannequinInput, type PreviewInput, type TryOnInput, type ViewInput } from "@/lib/previewCore";
import { compose as composeGarment } from "@/pattern/compose";
import { FAMILIES, familyOf } from "@/pattern/families";
import type { Feature } from "@/pattern/features";
import { estimateFabric } from "@/pattern/layout";
import { RECIPES, tryRecipe } from "@/pattern/recipes";
import { defaultSpec, FIT_LIMITS, measurementsSchema, SAMPLE_BODY, type FamilyId, type Fit, type Measurements, type Spec } from "@/pattern/spec";

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
export function compose(spec: Spec, m: Measurements, features: Feature[], fit: Fit = {}) {
  const c = composeGarment(spec, m, features, fit);
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
export function recipes(spec: Spec, m: Measurements, features: Feature[], fit: Fit = {}) {
  const g = composeGarment(spec, m, features, fit).garment;
  return RECIPES.filter((r) => r.families.includes(spec.family))
    .map((r) => ({ id: r.id, title: r.title, explanation: r.explanation, ops: tryRecipe(r, g, spec) }))
    .filter((r) => r.ops !== null);
}

/** The 1:1 tiled PDF, as base64. */
export function patternPdf(spec: Spec, m: Measurements, features: Feature[], title: string, fit: Fit = {}): string {
  const doc = buildPatternPdf({ composed: composeGarment(spec, m, features, fit), spec, measurements: m, title });
  const bytes = new Uint8Array(doc.output("arraybuffer"));
  return base64(bytes);
}

/** How far each fit adjustment may go, in cm. */
export const fitLimits = () => FIT_LIMITS;

/**
 * The finished garment's shape, for drawing it on the wearer in 3D: girths at chest, waist
 * and hem, the length from the nape (or waist, for skirts), the shoulder half-width and the
 * sleeve length, all in cm, read from the pattern pieces themselves.
 */
export function fitShape(spec: Spec, m: Measurements, features: Feature[], fit: Fit = {}) {
  const g = composeGarment(spec, m, features, fit).garment;
  const panel = (id: string) => g.panels.find((p) => p.id === id);
  const pts = (id: string) => panel(id)?.edges.flatMap((e) => e.pts) ?? [];
  const span = (id: string) => {
    const ys = pts(id).map((p) => p.y);
    return ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
  };
  const sideX = (id: string, y: number) => {
    const side = panel(id)?.edges.find((e) => e.id === "side")?.pts ?? [];
    for (let i = 1; i < side.length; i++) {
      const a = side[i - 1], b = side[i];
      if ((a.y - y) * (b.y - y) <= 0 && a.y !== b.y) return a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y);
    }
    return side.length ? side[side.length - 1].x : 0;
  };
  if (spec.family === "skirt") {
    const top = pts(g.panels[0].id);
    const width = (y: "top" | "bottom") => {
      const ys = top.map((p) => p.y), target = y === "top" ? Math.min(...ys) : Math.max(...ys);
      const xs = top.filter((p) => Math.abs(p.y - target) < 1).map((p) => p.x);
      return xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
    };
    const panels = g.panels.filter((p) => p.id !== "waistband").length;
    return { family: spec.family, length: span(g.panels[0].id), waist: m.waist + (fit.waist ?? 0),
             hem: Math.max(width("bottom") * Math.max(2, panels) * (panel(g.panels[0].id)?.cut.count ?? 1), m.hip),
             chest: 0, shoulderHalf: 0, sleeve: 0 };
  }
  const back = panel("back"), side = back?.edges.find((e) => e.id === "side")?.pts ?? [];
  const top = side[0]?.y ?? 0, bottom = side[side.length - 1]?.y ?? span("back");
  const girthAt = (y: number) => 2 * (sideX("back", y) + sideX("front", y));
  const shoulder = back?.edges.find((e) => e.id === "shoulder")?.pts ?? [];
  return {
    family: spec.family,
    length: span("back"),
    chest: girthAt(top + 1),
    waist: girthAt(Math.min(Math.max(m.backLength, top + 1), bottom - 1)),
    hem: girthAt(bottom),
    shoulderHalf: shoulder.length ? Math.max(...shoulder.map((p) => p.x)) : m.shoulder / 2,
    sleeve: panel("sleeve") ? span("sleeve") : 0,
  };
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
/** A scan photo → the wearer's mannequin from that angle; and the mannequin dressed in the garment. */
export const mannequinRequest = (input: MannequinInput) => mannequinParts(input);
export const dressRequest = (input: DressInput) => dressParts(input);

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
