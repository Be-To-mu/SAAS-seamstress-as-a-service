import { z } from "zod";

/**
 * A design is one of several garment families. Each family has its own small set of choices (the "spec"),
 * and its own block: a verified base pattern that the spec and the body measurements fit.
 * Everything beyond the spec (a hood, a yoke, a side zip) is added afterwards as pattern operations.
 */
export const FAMILY_IDS = ["coat", "knit", "skirt"] as const;
export type FamilyId = (typeof FAMILY_IDS)[number];

const colour = z.string();

/** A workwear coat or shirt-jacket: collar, button or zip front, pockets, set-in sleeves. */
export const coatSpecSchema = z.object({
  family: z.literal("coat"),
  collar: z.enum(["band", "spread"]),
  closure: z.enum(["buttons", "snaps", "zip"]),
  closureCount: z.number().int().min(3).max(9),
  chestPockets: z.number().int().min(0).max(2),
  chestPocketStyle: z.enum(["flap", "open"]),
  lowerPockets: z.enum(["none", "patch", "welt"]),
  lowerPocketFlap: z.boolean(),
  cuff: z.enum(["button", "rib", "open"]),
  hem: z.enum(["straight", "curved"]),
  /** Jacket length as a fraction of nape-to-hip. 1.0 is hip length. */
  lengthFraction: z.number().min(0.85).max(1.4),
  ease: z.enum(["fitted", "regular", "boxy"]),
  clothColor: colour,
});

/** A pull-over knit top: tee, long-sleeve tee, sweatshirt or hoodie. */
export const knitSpecSchema = z.object({
  family: z.literal("knit"),
  neck: z.enum(["crew", "scoop", "v", "hooded"]),
  sleeve: z.enum(["sleeveless", "short", "long"]),
  cuff: z.enum(["plain", "rib"]),
  hem: z.enum(["plain", "band"]),
  pocket: z.enum(["none", "patch", "kangaroo"]),
  /** Top length as a fraction of nape-to-hip. 1.0 is hip length. */
  lengthFraction: z.number().min(0.8).max(1.3),
  ease: z.enum(["fitted", "regular", "boxy"]),
  clothColor: colour,
});

/** A skirt cut from waist to hem, with a waistband. */
export const skirtSpecSchema = z.object({
  family: z.literal("skirt"),
  silhouette: z.enum(["pencil", "a-line", "circle", "gathered"]),
  length: z.enum(["mini", "knee", "midi", "maxi"]),
  /** A fitted band closes with a side zip. An elastic waist is pulled on over the hips. */
  waist: z.enum(["band", "elastic"]),
  pockets: z.enum(["none", "patch"]),
  ease: z.enum(["fitted", "regular", "boxy"]),
  clothColor: colour,
});

export type CoatSpec = z.infer<typeof coatSpecSchema>;
export type KnitSpec = z.infer<typeof knitSpecSchema>;
export type SkirtSpec = z.infer<typeof skirtSpecSchema>;
export type Spec = CoatSpec | KnitSpec | SkirtSpec;

export const FAMILY_SCHEMAS = { coat: coatSpecSchema, knit: knitSpecSchema, skirt: skirtSpecSchema } as const;

/** A spec with no "family" is a coat. That is what every saved design and every older client sends. */
const withFamily = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) && !("family" in v) ? { family: "coat", ...v } : v);

export const specSchema = z.preprocess(withFamily, z.discriminatedUnion("family", [coatSpecSchema, knitSpecSchema, skirtSpecSchema])) as z.ZodType<Spec>;

/** The choices of a family, without the family tag itself. */
export function specKeys(family: FamilyId): string[] {
  return Object.keys(FAMILY_SCHEMAS[family].shape).filter((k) => k !== "family");
}

export const DEFAULT_SPEC: CoatSpec = {
  family: "coat",
  collar: "spread",
  closure: "buttons",
  closureCount: 5,
  chestPockets: 2,
  chestPocketStyle: "flap",
  lowerPockets: "patch",
  lowerPocketFlap: false,
  cuff: "button",
  hem: "straight",
  lengthFraction: 1.15,
  ease: "boxy",
  clothColor: "#a9794a",
};

export const DEFAULT_KNIT: KnitSpec = {
  family: "knit",
  neck: "crew",
  sleeve: "short",
  cuff: "plain",
  hem: "plain",
  pocket: "none",
  lengthFraction: 1.0,
  ease: "regular",
  clothColor: "#3b4a6b",
};

export const DEFAULT_SKIRT: SkirtSpec = {
  family: "skirt",
  silhouette: "a-line",
  length: "knee",
  waist: "band",
  pockets: "none",
  ease: "regular",
  clothColor: "#5a2d3c",
};

export function defaultSpec(family: FamilyId): Spec {
  return family === "coat" ? DEFAULT_SPEC : family === "knit" ? DEFAULT_KNIT : DEFAULT_SKIRT;
}

export const measurementsSchema = z.object({
  chest: z.number().min(70).max(160),
  waist: z.number().min(55).max(150),
  hip: z.number().min(75).max(160),
  /** Across the back, shoulder point to shoulder point. */
  shoulder: z.number().min(34).max(60),
  neck: z.number().min(30).max(50),
  /** Nape to waist. */
  backLength: z.number().min(35).max(55),
  /** Shoulder point to wrist. */
  armLength: z.number().min(50).max(80),
  bicep: z.number().min(22).max(50),
  wrist: z.number().min(14).max(24).optional(),
  napeToHip: z.number().min(50).max(90).optional(),
  /** Waist to the fullest part of the hip. Skirts use it. */
  waistToHip: z.number().min(14).max(30).optional(),
});

export type Measurements = z.infer<typeof measurementsSchema>;

export const SAMPLE_BODY: Measurements = {
  chest: 100,
  waist: 88,
  hip: 102,
  shoulder: 46,
  neck: 39,
  backLength: 44,
  armLength: 64,
  bicep: 33,
  wrist: 17,
};

export const EASE_CM = { fitted: 12, regular: 18, boxy: 26 } as const;

/**
 * Adjustments the wearer makes on the 3D fitting, in cm on the finished garment:
 * longer/shorter, wider/narrower at the waist (total girth) and across the shoulders,
 * longer/shorter sleeves. Zero or missing means "as designed".
 */
export interface Fit {
  length?: number;
  waist?: number;
  shoulder?: number;
  sleeve?: number;
}

export const FIT_LIMITS: Record<keyof Fit, [number, number]> = {
  length: [-20, 20],
  waist: [-16, 16],
  shoulder: [-4, 4],
  sleeve: [-10, 10],
};

export function clampFit(f: Fit = {}): Required<Fit> {
  const c = (k: keyof Fit) => Math.min(FIT_LIMITS[k][1], Math.max(FIT_LIMITS[k][0], Number(f[k]) || 0));
  return { length: c("length"), waist: c("waist"), shoulder: c("shoulder"), sleeve: c("sleeve") };
}
