import { fr, placePatch } from "./blocks";
import { checkGarment } from "./check";
import { familyOf } from "./families";
import { hoodOps, sideZipOps } from "./features";
import { applyOps, opSchema, type Op, type OpInput } from "./ops";
import type { FamilyId, Spec } from "./spec";
import type { Garment } from "./types";

/**
 * A verified way to add something to a garment. Recipes do two jobs:
 * they are the worked examples the language model sees (adapted to the garment in front of it, so the ids are right),
 * and they are the built-in fallback when no model is available.
 */
export interface Recipe {
  id: string;
  title: string;
  /** Words in a request that point at this recipe. */
  keywords: string[];
  families: FamilyId[];
  explanation: string;
  /** The operations for this garment, or null when the recipe does not apply to it. */
  ops(g: Garment, spec: Spec): Op[] | null;
}

const parse = (ops: OpInput[]): Op[] => ops.map((o) => opSchema.parse(o));
const panel = (g: Garment, id: string) => g.panels.find((p) => p.id === id);
const hasSeam = (g: Garment, id: string) => g.seams.some((s) => s.id === id && s.kind === "sewn");

export const RECIPES: Recipe[] = [
  {
    id: "side-zip",
    title: "side zip",
    keywords: ["zip", "zipper", "side opening", "side vent"],
    families: ["coat", "knit"],
    explanation: "Open the lower half of the side seam for a zip and add a guard strip behind it.",
    ops: (g) => (hasSeam(g, "side") ? sideZipOps() : null),
  },
  {
    id: "hood",
    title: "hood",
    keywords: ["hood", "hooded", "cowl"],
    families: ["coat", "knit"],
    explanation: "Add a two-piece hood: a side panel cut twice as left and right, sewn together at the centre seam and to the neckline.",
    ops: (g, spec) => {
      const join = familyOf(spec).hoodJoin(spec);
      if (!join || panel(g, "hood") || !join.every((r) => panel(g, r.panel))) return null;
      return hoodOps(join);
    },
  },
  {
    id: "yoke",
    title: "yoke",
    keywords: ["yoke", "shoulder panel", "panel across the back", "hip panel", "hip yoke"],
    families: ["coat", "knit", "skirt"],
    explanation: "Cut the back across with a straight seam to make a yoke, the way workshirts and western shirts are made. A skirt gets a hip yoke on front and back.",
    ops: (g, spec) => {
      if (spec.family === "skirt") {
        if (spec.silhouette === "circle") return null;
        return parse([
          { op: "splitPanel", panel: "front", axis: "horizontal", at: 0.2 },
          { op: "splitPanel", panel: "back", axis: "horizontal", at: 0.2 },
        ]);
      }
      return panel(g, "back") ? parse([{ op: "splitPanel", panel: "back", axis: "horizontal", at: 0.18 }]) : null;
    },
  },
  {
    id: "colour-block",
    title: "contrast colour-block panel at the hem",
    keywords: ["colour block", "color block", "colourblock", "contrast", "two tone", "two-tone", "tiered", "panel"],
    families: ["knit", "skirt"],
    explanation: "Cut the front and back across low down and make the lower pieces in the contrast fabric, so the hem is a different colour.",
    ops: (g) =>
      panel(g, "front") && panel(g, "back")
        ? parse([
            { op: "splitPanel", panel: "front", axis: "horizontal", at: 0.65, fabric: "contrast" },
            { op: "splitPanel", panel: "back", axis: "horizontal", at: 0.65, fabric: "contrast" },
          ])
        : null,
  },
  {
    id: "zipped-pocket",
    title: "zipped chest pocket",
    keywords: ["zip pocket", "zipped pocket", "zipped chest", "zip chest", "welt pocket", "hidden pocket", "secret pocket"],
    families: ["coat", "knit"],
    explanation: "Cut a 15 cm opening in the front for the zip and sew a pocket bag behind it.",
    ops: (g) => {
      const front = panel(g, "front");
      if (!front) return null;
      const spot = placePatch(front, 15, 3, 6, "centre");
      if (!spot) return null;
      return parse([
        { op: "addSlit", panel: "front", at: fr(front, spot.x + 7.5, spot.y + 1.5), length: 15, angle: 0, id: "zip.pocket" },
        { op: "addPiece", id: "bag.zip", name: "Zip pocket bag", shape: "bag", height: 17, attach: { panel: "front", mark: "zip.pocket" }, count: 2 },
      ]);
    },
  },
  {
    id: "patch-pocket",
    title: "patch pockets",
    keywords: ["pocket", "patch", "pouch"],
    families: ["coat", "knit", "skirt"],
    explanation: "Add a pair of patch pockets: a square of cloth sewn onto the front, with a placement outline so you know where to put it.",
    ops: (g) => {
      const front = panel(g, "front");
      if (!front) return null;
      const spot = placePatch(front, 13, 15, 14, "side");
      if (!spot) return null;
      return parse([{ op: "addPiece", id: "pocket.extra", name: "Patch pocket", shape: "rect", width: 13, height: 15, place: { panel: "front", ...fr(front, spot.x, spot.y) }, count: 2 }]);
    },
  },
];

/** Run a recipe on a garment. Returns the operations only if they apply cleanly and keep the garment valid. */
export function tryRecipe(r: Recipe, g: Garment, spec: Spec): Op[] | null {
  if (!r.families.includes(spec.family)) return null;
  const ops = r.ops(g, spec);
  if (!ops) return null;
  const res = applyOps(g, ops);
  if (res.error) return null;
  return checkGarment(res.garment).ok ? ops : null;
}

/** How well a request matches a recipe: the number of its keywords the request contains, with a bonus for the recipe's own name. */
function score(r: Recipe, request: string): number {
  const q = request.toLowerCase();
  let s = r.keywords.filter((k) => q.includes(k)).length;
  if (q.includes(r.id.replace("-", " ")) || q.includes(r.title)) s += 1;
  return s;
}

/**
 * Choose worked examples for a request: the recipes that best match it first, then others so the model sees a spread of ideas
 * (a single example gets copied; several different ones show the range). Only recipes that work on this garment are returned.
 */
export function pickRecipes(request: string, g: Garment, spec: Spec, n = 3): { recipe: Recipe; ops: Op[]; score: number }[] {
  const usable = RECIPES.map((recipe) => ({ recipe, ops: tryRecipe(recipe, g, spec), score: score(recipe, request) })).filter(
    (x): x is { recipe: Recipe; ops: Op[]; score: number } => x.ops !== null,
  );
  const matched = usable.filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  const rest = usable.filter((x) => x.score === 0);
  return [...matched, ...rest].slice(0, n);
}
