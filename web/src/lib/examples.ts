import { FAMILIES } from "@/pattern/families";
import { DEFAULT_SPEC, FAMILY_IDS, specKeys, type FamilyId, type Spec } from "@/pattern/spec";

/**
 * Worked examples for the design model: what a person showed or wrote, and the correct answer.
 * They are the single source for the prompt and for the tests, so every example is guaranteed to be a design the pattern engine can build.
 */
export interface DesignExample {
  id: string;
  /** What the photos showed or the user wrote, written the way the model would see it. */
  input: string;
  garment: string;
  family: FamilyId;
  fitsFamily: boolean;
  reason: string;
  spec: Spec;
  /** Fields the model was unsure of, with how sure. Everything else is 0.9. */
  unsure?: Record<string, number>;
  /** Where a field came from, when it is not simply "text" or "photo 1". */
  from?: Record<string, string>;
  /** Fields nobody mentioned, so the default was used. */
  defaulted?: string[];
  unsupported?: string[];
  notes?: string;
}

export const EXAMPLES: DesignExample[] = [
  {
    id: "chore-coat-photo",
    input: `Photo 1: a tan duck-canvas chore coat shown from the front. Fold-over collar, five brass buttons down the front, two flapped chest pockets, two large square patch pockets low on the front with no flaps, buttoned cuffs, straight hem, roomy boxy shape ending a hand below the hip.\nThe user wrote: nothing.`,
    garment: "chore coat",
    family: "coat",
    fitsFamily: true,
    reason: "A classic boxy workwear chore coat, copied from the photo.",
    spec: { ...DEFAULT_SPEC, collar: "spread", closure: "buttons", closureCount: 5, chestPockets: 2, chestPocketStyle: "flap", lowerPockets: "patch", lowerPocketFlap: false, cuff: "button", hem: "straight", lengthFraction: 1.15, ease: "boxy", clothColor: "#b08a5a" },
    unsure: { lengthFraction: 0.6 },
    from: Object.fromEntries(["collar", "closure", "closureCount", "chestPockets", "chestPocketStyle", "lowerPockets", "lowerPocketFlap", "cuff", "hem", "lengthFraction", "ease", "clothColor"].map((k) => [k, "photo 1"])),
  },
  {
    id: "work-jacket-text",
    input: `No photos. The user wrote: "slim navy work jacket with snaps, no chest pockets, slanted pockets on the front, ribbed cuffs, curved hem like a shirt".`,
    garment: "work jacket",
    family: "coat",
    fitsFamily: true,
    reason: "A trim navy work jacket with snaps, slanted pockets and ribbed cuffs, as written.",
    spec: { ...DEFAULT_SPEC, collar: "spread", closure: "snaps", closureCount: 5, chestPockets: 0, chestPocketStyle: "open", lowerPockets: "welt", lowerPocketFlap: false, cuff: "rib", hem: "curved", lengthFraction: 1.0, ease: "fitted", clothColor: "#1f3352" },
    unsure: { lengthFraction: 0.4, collar: 0.4, closureCount: 0.4 },
    defaulted: ["collar", "closureCount", "lengthFraction", "chestPocketStyle", "lowerPocketFlap"],
  },
  {
    id: "hooded-jacket",
    input: `No photos. The user wrote: "olive hooded work jacket with a front zip, two flap chest pockets, ribbed cuffs".`,
    garment: "hooded work jacket",
    family: "coat",
    fitsFamily: true,
    reason: "A zip-front work jacket in olive. The hood is not part of the coat form, so it is listed to be added to the pattern.",
    spec: { ...DEFAULT_SPEC, collar: "band", closure: "zip", closureCount: 5, chestPockets: 2, chestPocketStyle: "flap", lowerPockets: "none", lowerPocketFlap: false, cuff: "rib", hem: "straight", lengthFraction: 1.05, ease: "regular", clothColor: "#5a6240" },
    unsure: { lowerPockets: 0.4, collar: 0.4 },
    defaulted: ["closureCount", "hem", "lowerPocketFlap", "lowerPockets"],
    unsupported: ["add a hood"],
  },
  {
    id: "hoodie-photo",
    input: `Photo 1: a heather grey pullover hoodie, hood down. Large pouch pocket across the front, ribbed cuffs and a ribbed hem band, long sleeves, roomy fit, hip length.\nThe user wrote: nothing.`,
    garment: "hoodie",
    family: "knit",
    fitsFamily: true,
    reason: "A grey pullover hoodie with a kangaroo pocket, copied from the photo.",
    spec: { family: "knit", neck: "hooded", sleeve: "long", cuff: "rib", hem: "band", pocket: "kangaroo", lengthFraction: 1.0, ease: "boxy", clothColor: "#9a9ea6" },
    from: Object.fromEntries(["neck", "sleeve", "cuff", "hem", "pocket", "lengthFraction", "ease", "clothColor"].map((k) => [k, "photo 1"])),
  },
  {
    id: "tee-text",
    input: `No photos. The user wrote: "a plain white t-shirt, crew neck, short sleeves, normal fit".`,
    garment: "t-shirt",
    family: "knit",
    fitsFamily: true,
    reason: "A plain white short-sleeve crew-neck tee.",
    spec: { family: "knit", neck: "crew", sleeve: "short", cuff: "plain", hem: "plain", pocket: "none", lengthFraction: 1.0, ease: "regular", clothColor: "#f4f4f2" },
    unsure: { lengthFraction: 0.5 },
    defaulted: ["cuff", "hem", "pocket", "lengthFraction"],
  },
  {
    id: "tank-text",
    input: `No photos. The user wrote: "fitted black v-neck tank top, cropped, with a little chest pocket".`,
    garment: "tank top",
    family: "knit",
    fitsFamily: true,
    reason: "A short, close-fitting sleeveless v-neck top with one chest patch pocket.",
    spec: { family: "knit", neck: "v", sleeve: "sleeveless", cuff: "plain", hem: "plain", pocket: "patch", lengthFraction: 0.85, ease: "fitted", clothColor: "#161616" },
    unsure: { lengthFraction: 0.6 },
    defaulted: ["cuff", "hem"],
  },
  {
    id: "pencil-skirt-photo",
    input: `Photo 1: a dark green wool pencil skirt, front view. Fitted through the hips, narrow at the hem, ending just below the knee, plain waistband, a zip at the side.\nThe user wrote: nothing.`,
    garment: "pencil skirt",
    family: "skirt",
    fitsFamily: true,
    reason: "A fitted knee-length pencil skirt with a waistband and side zip.",
    spec: { family: "skirt", silhouette: "pencil", length: "knee", waist: "band", pockets: "none", ease: "fitted", clothColor: "#23402f" },
    from: Object.fromEntries(["silhouette", "length", "waist", "pockets", "ease", "clothColor"].map((k) => [k, "photo 1"])),
  },
  {
    id: "circle-skirt-text",
    input: `No photos. The user wrote: "a big red twirly skirt, midi length, elastic waist, no pockets".`,
    garment: "circle skirt",
    family: "skirt",
    fitsFamily: true,
    reason: "A full circle skirt in red with an elastic waist, as described.",
    spec: { family: "skirt", silhouette: "circle", length: "midi", waist: "elastic", pockets: "none", ease: "boxy", clothColor: "#b3202a" },
    unsure: { ease: 0.6 },
  },
  {
    id: "gathered-skirt-photo",
    input: `Photo 1: a long cotton skirt in faded blue, gathered at an elasticated waist, falls in soft vertical folds to the ankle, two patch pockets at the hips.\nThe user wrote: nothing.`,
    garment: "gathered skirt",
    family: "skirt",
    fitsFamily: true,
    reason: "A long gathered skirt with an elastic waist and patch pockets.",
    spec: { family: "skirt", silhouette: "gathered", length: "maxi", waist: "elastic", pockets: "patch", ease: "regular", clothColor: "#6d8cb5" },
    from: Object.fromEntries(["silhouette", "length", "waist", "pockets", "ease", "clothColor"].map((k) => [k, "photo 1"])),
    unsure: { ease: 0.5 },
  },
  {
    id: "mix-two-photos",
    input: `Photo 1: a black boxy chore coat with a spread collar, five buttons and two flapped chest pockets, no lower pockets, open cuffs.\nPhoto 2: a brown corduroy work jacket with a band collar, snaps, big patch lower pockets and ribbed cuffs, trim fit.\nMode: mix the two into one new jacket.`,
    garment: "chore coat",
    family: "coat",
    fitsFamily: true,
    reason: "The boxy black coat's shape and chest pockets, with the corduroy jacket's snaps, patch lower pockets and ribbed cuffs.",
    spec: { ...DEFAULT_SPEC, collar: "spread", closure: "snaps", closureCount: 5, chestPockets: 2, chestPocketStyle: "flap", lowerPockets: "patch", lowerPocketFlap: false, cuff: "rib", hem: "straight", lengthFraction: 1.1, ease: "boxy", clothColor: "#2b2b2b" },
    from: {
      collar: "photo 1", closure: "photo 2", closureCount: "photo 1", chestPockets: "photo 1", chestPocketStyle: "photo 1", lowerPockets: "photo 2", lowerPocketFlap: "photo 2",
      cuff: "photo 2", hem: "photo 1", lengthFraction: "photo 1", ease: "photo 1", clothColor: "photo 1",
    },
    unsure: { lengthFraction: 0.6 },
  },
  {
    id: "trousers-not-supported",
    input: `No photos. The user wrote: "wide-leg linen trousers, high waist".`,
    garment: "trousers",
    family: "skirt",
    fitsFamily: false,
    reason: "Trousers need legs and a crotch seam, which the skirt block cannot make. The closest shape available is a long skirt, shown so you can still see something.",
    spec: { family: "skirt", silhouette: "a-line", length: "maxi", waist: "band", pockets: "none", ease: "regular", clothColor: "#d8cdb4" },
    unsure: { silhouette: 0.2, length: 0.3 },
    unsupported: ["trousers with two legs"],
    notes: "This app can pattern coats, knit tops and skirts. Trousers and dresses are not available yet.",
  },
  {
    id: "dress-not-supported",
    input: `No photos. The user wrote: "a summer dress with a fitted top and a gathered skirt, sleeveless".`,
    garment: "dress",
    family: "skirt",
    fitsFamily: false,
    reason: "A dress joins a bodice to a skirt, and the skirt block has no bodice. Only the gathered skirt half can be patterned.",
    spec: { family: "skirt", silhouette: "gathered", length: "midi", waist: "band", pockets: "none", ease: "regular", clothColor: "#e7b9c4" },
    unsure: { length: 0.4 },
    unsupported: ["add a fitted sleeveless bodice"],
    notes: "This app can pattern coats, knit tops and skirts. A dress is not available yet; this is the skirt half.",
  },
];

/** What to look at in a photo for each family. Short, concrete, and written from how these garments are actually told apart. */
export const READING_GUIDE = `How to read a garment:
- COAT (woven jacket with a collar and an opening down the front). Count the visible buttons or snaps for closureCount. "Flapped" pockets have a lid over them. Welt pockets are slanted slots with no patch on the outside. A coat that ends well below the belt line is lengthFraction 1.15 or more; one that ends at the belt is 1.0. Boxy means straight sides and a dropped, roomy shoulder; fitted means the sides follow the body.
- KNIT TOP (pulled on over the head). A hood means neck "hooded". A kangaroo pocket is the big single pouch across the belly of a hoodie. Ribbed cuffs and a ribbed hem band are the stretchy tubes at the wrist and waist of a sweatshirt. A plain tee has a thin ribbed neckband only.
- SKIRT. Pencil: narrow, tapers to the hem. A-line: smooth triangle flaring from the hip. Circle: swirls and ripples evenly in flutes all round the hem. Gathered: falls in many small vertical folds from the waist. Mini ends above the knee, knee at the knee, midi mid-calf, maxi at the ankle. An elastic waist shows gathering or stretch at the waist and no zip.
- Anything else (dress, trousers, shorts, jumpsuit, a coat with a cape): choose the closest family, set fitsFamily to false, and say what is missing in notes. Never pretend it fits.`;

/** Render one example as the answer the model should give. */
export function exampleAnswer(ex: DesignExample): Record<string, unknown> {
  const keys = specKeys(ex.family);
  const defaulted = new Set(ex.defaulted ?? []);
  return {
    garment: ex.garment,
    family: ex.family,
    fitsFamily: ex.fitsFamily,
    reason: ex.reason,
    spec: ex.spec,
    confidence: Object.fromEntries(keys.map((k) => [k, defaulted.has(k) ? (ex.unsure?.[k] ?? 0.3) : (ex.unsure?.[k] ?? 0.9)])),
    sources: Object.fromEntries(keys.map((k) => [k, defaulted.has(k) ? "default" : (ex.from?.[k] ?? (ex.input.startsWith("Photo") ? "photo 1" : "text"))])),
    unsupported: ex.unsupported ?? [],
    notes: ex.notes ?? "",
  };
}

/** The examples as prompt text. `exclude` leaves one out, so an example can be used to test the model without it seeing its own answer. */
export function examplesPrompt(exclude?: string): string {
  return EXAMPLES.filter((e) => e.id !== exclude)
    .map((e, i) => `EXAMPLE ${i + 1}\nInput:\n${e.input}\nCorrect answer:\n${JSON.stringify(exampleAnswer(e))}`)
    .join("\n\n");
}

/** The family blocks, for the prompt. */
export function familiesPrompt(): string {
  return FAMILY_IDS.map((id) => `FAMILY "${id}" (${FAMILIES[id].label}). ${FAMILIES[id].scope}\n"spec" for this family:\n${FAMILIES[id].promptShape}`).join("\n\n");
}
