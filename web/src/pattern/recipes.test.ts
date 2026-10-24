import { describe, expect, it } from "vitest";
import { checkGarment } from "./check";
import { familyOf } from "./families";
import { applyOps } from "./ops";
import { pickRecipes, RECIPES, tryRecipe } from "./recipes";
import { DEFAULT_KNIT, DEFAULT_SKIRT, DEFAULT_SPEC, SAMPLE_BODY, type Spec } from "./spec";

const defaults: Spec[] = [DEFAULT_SPEC, DEFAULT_KNIT, DEFAULT_SKIRT];
const build = (s: Spec) => familyOf(s).build(s, SAMPLE_BODY).garment;

describe("recipes", () => {
  it("every recipe that applies does so cleanly, with a valid check, and each one applies somewhere", () => {
    for (const r of RECIPES) {
      let applied = 0;
      for (const spec of defaults.filter((s) => r.families.includes(s.family))) {
        const g = build(spec);
        const ops = tryRecipe(r, g, spec);
        if (!ops) continue; // e.g. no room left for another patch pocket
        applied++;
        const res = applyOps(g, ops!);
        expect(res.error, `${r.id} on ${spec.family}`).toBeUndefined();
        expect(checkGarment(res.garment).ok, `${r.id} on ${spec.family}`).toBe(true);
      }
      expect(applied, r.id).toBeGreaterThan(0);
    }
  });

  it("every garment family has at least two recipes", () => {
    for (const spec of defaults) expect(RECIPES.filter((r) => r.families.includes(spec.family)).length).toBeGreaterThanOrEqual(2);
  });

  it("ranks by the request and only offers recipes for that family", () => {
    const coat = pickRecipes("add a hood", build(DEFAULT_SPEC), DEFAULT_SPEC, 3);
    expect(coat[0].recipe.id).toBe("hood");
    expect(coat[0].score).toBeGreaterThan(0);
    const skirt = pickRecipes("add a hood", build(DEFAULT_SKIRT), DEFAULT_SKIRT, 5);
    expect(skirt.map((x) => x.recipe.id)).not.toContain("hood");
    const none = pickRecipes("", build(DEFAULT_SKIRT), DEFAULT_SKIRT, 8);
    expect(none.length).toBeGreaterThan(0);
  });
});
