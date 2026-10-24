import { buildCoat } from "./base";
import { buildKnit } from "./knit";
import { buildSkirt } from "./skirt";
import { FAMILY_IDS, type CoatSpec, type FamilyId, type KnitSpec, type Measurements, type SkirtSpec, type Spec } from "./spec";
import type { Garment } from "./types";

export { FAMILY_IDS };
export type { FamilyId };

export interface Stat {
  label: string;
  value: string;
}

export type FieldDef =
  | { key: string; label: string; kind: "select"; options: string[] }
  | { key: string; label: string; kind: "count"; min: number; max: number }
  | { key: string; label: string; kind: "number"; min: number; max: number; step: number; hint?: string }
  | { key: string; label: string; kind: "color" };

export interface Built {
  garment: Garment;
  stats: Stat[];
}

export interface FamilyDef {
  id: FamilyId;
  label: string;
  /** One line for the picker. */
  blurb: string;
  fields: FieldDef[];
  build(spec: Spec, m: Measurements): Built;
  /** The design as a plain sentence, for the picture model. */
  describe(spec: Spec): string;
  /** The edges a hood is sewn to, or null when this garment cannot take one. */
  hoodJoin(spec: Spec): { panel: string; edge: string }[] | null;
  /** The shape of the "spec" object, as shown to the language model. */
  promptShape: string;
  /** What kind of garment this block can and cannot do, for the language model. */
  scope: string;
}

const cm = (n: number) => `${n.toFixed(0)} cm`;
const fit = { fitted: "a trim fit", regular: "a regular fit", boxy: "a roomy fit" } as const;

const coat: FamilyDef = {
  id: "coat",
  label: "Coat or shirt-jacket",
  blurb: "Chore coat, work jacket, overshirt",
  fields: [
    { key: "collar", label: "Collar", kind: "select", options: ["band", "spread"] },
    { key: "closure", label: "Front closure", kind: "select", options: ["buttons", "snaps", "zip"] },
    { key: "closureCount", label: "Buttons / snaps", kind: "count", min: 3, max: 9 },
    { key: "chestPockets", label: "Chest pockets", kind: "select", options: ["0", "1", "2"] },
    { key: "chestPocketStyle", label: "Chest pocket style", kind: "select", options: ["flap", "open"] },
    { key: "lowerPockets", label: "Lower pockets", kind: "select", options: ["none", "patch", "welt"] },
    { key: "lowerPocketFlap", label: "Lower pocket flap", kind: "select", options: ["false", "true"] },
    { key: "cuff", label: "Cuff", kind: "select", options: ["button", "rib", "open"] },
    { key: "hem", label: "Hem", kind: "select", options: ["straight", "curved"] },
    { key: "lengthFraction", label: "Length (1.0 = hip)", kind: "number", min: 0.85, max: 1.4, step: 0.05 },
    { key: "ease", label: "Fit", kind: "select", options: ["fitted", "regular", "boxy"] },
    { key: "clothColor", label: "Cloth colour", kind: "color" },
  ],
  build(spec, m) {
    const { garment, derived } = buildCoat(spec as CoatSpec, m);
    return {
      garment,
      stats: [
        { label: "Finished chest", value: cm(derived.girth) },
        { label: "Back length", value: cm(derived.length) },
        { label: "Sleeve, shoulder to cuff", value: `${cm(derived.sleeveLength)} (your arm ${cm(m.armLength)})` },
        { label: "Sleeve cap ease", value: `${derived.capEase.toFixed(1)} cm` },
      ],
    };
  },
  describe(spec) {
    const s = spec as CoatSpec;
    const closure = s.closure === "zip" ? "a front zip" : `${s.closureCount} ${s.closure} down the front`;
    const chest =
      s.chestPockets === 0 ? "no chest pockets" : `${s.chestPockets === 1 ? "one" : "two"} ${s.chestPocketStyle === "flap" ? "flapped" : "open patch"} chest pocket${s.chestPockets === 1 ? "" : "s"}`;
    const lower = s.lowerPockets === "none" ? "no lower pockets" : `${s.lowerPockets === "welt" ? "slanted welt" : "large patch"} lower pockets${s.lowerPocketFlap ? " with flaps" : ""}`;
    const cuff = s.cuff === "rib" ? "ribbed knit cuffs" : s.cuff === "button" ? "buttoned cuffs" : "plain open cuffs";
    const collar = s.collar === "band" ? "a small stand-up band collar" : "a fold-over spread collar";
    const length = s.lengthFraction < 1 ? "cropped, ending above the hip" : s.lengthFraction < 1.12 ? "ending at the hip" : "long, ending below the hip";
    const coatFit = { fitted: "a trim fit", regular: "a regular fit", boxy: "a boxy, roomy fit" }[s.ease];
    return `a workwear chore coat in colour ${s.clothColor} with ${collar}, ${closure}, ${chest}, ${lower}, ${cuff}, a ${s.hem} hem, ${length}, and ${coatFit}`;
  },
  hoodJoin: () => [{ panel: "collar", edge: "top" }],
  promptShape: `{
    "family": "coat",
    "collar": "band" | "spread",            // band = small stand-up collar, spread = fold-over collar
    "closure": "buttons" | "snaps" | "zip",
    "closureCount": integer 3-9,            // number of buttons or snaps down the front (ignored for zip)
    "chestPockets": 0 | 1 | 2,
    "chestPocketStyle": "flap" | "open",
    "lowerPockets": "none" | "patch" | "welt",
    "lowerPocketFlap": boolean,
    "cuff": "button" | "rib" | "open",
    "hem": "straight" | "curved",
    "lengthFraction": number 0.85-1.4,      // jacket length vs hip length. 1.0 = ends at the hip, 1.15 = a hand below
    "ease": "fitted" | "regular" | "boxy",
    "clothColor": string                    // main fabric colour as a #rrggbb hex
  }`,
  scope: "Woven coats and jackets with a collar and a front opening: chore coats, work jackets, overshirts, shirt-jackets, field jackets.",
};

const knit: FamilyDef = {
  id: "knit",
  label: "Tee, sweatshirt or hoodie",
  blurb: "Pull-over knit top",
  fields: [
    { key: "neck", label: "Neckline", kind: "select", options: ["crew", "scoop", "v", "hooded"] },
    { key: "sleeve", label: "Sleeve", kind: "select", options: ["sleeveless", "short", "long"] },
    { key: "cuff", label: "Cuff (long sleeve)", kind: "select", options: ["plain", "rib"] },
    { key: "hem", label: "Hem", kind: "select", options: ["plain", "band"] },
    { key: "pocket", label: "Pocket", kind: "select", options: ["none", "patch", "kangaroo"] },
    { key: "lengthFraction", label: "Length (1.0 = hip)", kind: "number", min: 0.8, max: 1.3, step: 0.05 },
    { key: "ease", label: "Fit", kind: "select", options: ["fitted", "regular", "boxy"] },
    { key: "clothColor", label: "Cloth colour", kind: "color" },
  ],
  build(spec, m) {
    const { garment, derived } = buildKnit(spec as KnitSpec, m);
    const stats: Stat[] = [
      { label: "Finished chest", value: cm(derived.girth) },
      { label: "Length", value: cm(derived.length) },
      { label: "Neckline", value: cm(derived.neckline) },
    ];
    if ((spec as KnitSpec).sleeve !== "sleeveless") stats.push({ label: "Sleeve cap ease", value: `${derived.capEase.toFixed(1)} cm` });
    return { garment, stats };
  },
  describe(spec) {
    const s = spec as KnitSpec;
    const name = s.neck === "hooded" ? "hoodie" : s.sleeve === "long" ? "long-sleeve knit top" : s.sleeve === "short" ? "t-shirt" : "sleeveless knit top";
    const neck = { crew: "a crew neck with a ribbed neckband", scoop: "a wide scoop neck with a ribbed neckband", v: "a v-neck with a ribbed neckband", hooded: "a two-piece hood" }[s.neck];
    const sleeve = s.sleeve === "sleeveless" ? "no sleeves" : `${s.sleeve} sleeves${s.sleeve === "long" ? (s.cuff === "rib" ? " with ribbed cuffs" : " with plain hems") : ""}`;
    const pocket = { none: "no pockets", patch: "one small chest patch pocket", kangaroo: "a large front pouch (kangaroo) pocket" }[s.pocket];
    const length = s.lengthFraction < 0.95 ? "cropped" : s.lengthFraction < 1.1 ? "hip length" : "long, below the hip";
    return `a ${name} in colour ${s.clothColor} with ${neck}, ${sleeve}, ${pocket}, a ${s.hem === "band" ? "ribbed hem band" : "plain stitched hem"}, ${length}, and ${fit[s.ease]}`;
  },
  hoodJoin: (spec) => ((spec as KnitSpec).neck === "hooded" ? null : [{ panel: "neckband", edge: "bottom" }]),
  promptShape: `{
    "family": "knit",
    "neck": "crew" | "scoop" | "v" | "hooded",   // hooded = a hoodie with a two-piece hood
    "sleeve": "sleeveless" | "short" | "long",
    "cuff": "plain" | "rib",                        // only matters for long sleeves
    "hem": "plain" | "band",                        // band = ribbed hem band, as on a sweatshirt
    "pocket": "none" | "patch" | "kangaroo",        // kangaroo = big pouch pocket on the front
    "lengthFraction": number 0.8-1.3,               // 1.0 = ends at the hip
    "ease": "fitted" | "regular" | "boxy",
    "clothColor": string                            // main fabric colour as a #rrggbb hex
  }`,
  scope: "Pull-over knit tops: t-shirts, tanks, long-sleeve tees, sweatshirts, hoodies. Not zip-front or button-front knits.",
};

const skirt: FamilyDef = {
  id: "skirt",
  label: "Skirt",
  blurb: "Pencil, a-line, circle or gathered",
  fields: [
    { key: "silhouette", label: "Shape", kind: "select", options: ["pencil", "a-line", "circle", "gathered"] },
    { key: "length", label: "Length", kind: "select", options: ["mini", "knee", "midi", "maxi"] },
    { key: "waist", label: "Waist", kind: "select", options: ["band", "elastic"] },
    { key: "pockets", label: "Pockets", kind: "select", options: ["none", "patch"] },
    { key: "ease", label: "Fit / fullness", kind: "select", options: ["fitted", "regular", "boxy"] },
    { key: "clothColor", label: "Cloth colour", kind: "color" },
  ],
  build(spec, m) {
    const { garment, derived } = buildSkirt(spec as SkirtSpec, m);
    const stats: Stat[] = [
      { label: "Finished waist", value: cm(derived.waist) },
      { label: "Finished hip", value: cm(derived.hip) },
      { label: "Length from waist", value: cm(derived.length) },
    ];
    if (derived.gatherRatio > 1.05) stats.push({ label: "Gathers", value: `${derived.gatherRatio.toFixed(1)} : 1` });
    return { garment, stats };
  },
  describe(spec) {
    const s = spec as SkirtSpec;
    const shape = {
      pencil: "a slim pencil skirt that tapers to the hem",
      "a-line": "an a-line skirt that flares gently from the hip",
      circle: `a ${s.ease === "fitted" ? "half" : s.ease === "regular" ? "three-quarter" : "full"} circle skirt with soft swirling folds`,
      gathered: "a gathered skirt with a full, rectangular drape",
    }[s.silhouette];
    const length = { mini: "mini length, well above the knee", knee: "knee length", midi: "midi length, below the knee", maxi: "maxi length, reaching the ankle" }[s.length];
    return `${shape} in colour ${s.clothColor}, ${length}, with ${s.waist === "elastic" ? "a plain elasticated waist" : "a fitted waistband and a side zip"} and ${s.pockets === "patch" ? "two patch pockets on the front" : "no pockets"}`;
  },
  hoodJoin: () => null,
  promptShape: `{
    "family": "skirt",
    "silhouette": "pencil" | "a-line" | "circle" | "gathered",
    "length": "mini" | "knee" | "midi" | "maxi",
    "waist": "band" | "elastic",                    // band = fitted waistband with a side zip, elastic = pull-on
    "pockets": "none" | "patch",
    "ease": "fitted" | "regular" | "boxy",          // for a circle skirt: fitted = half circle, regular = three-quarter, boxy = full circle; for gathered: how full
    "clothColor": string                            // main fabric colour as a #rrggbb hex
  }`,
  scope: "Skirts hung from a waistband or an elastic waist. Not dresses, shorts or trousers.",
};

export const FAMILIES: Record<FamilyId, FamilyDef> = { coat, knit, skirt };

export const familyOf = (spec: Spec): FamilyDef => FAMILIES[spec.family];

/** The choices of a design, without the family tag. */
export function specValues(spec: Spec): Record<string, unknown> {
  const { family: _family, ...rest } = spec;
  void _family;
  return rest;
}
