import { describe, expect, it } from "vitest";
import { checkGarment } from "./check";
import { familyOf } from "./families";
import { panelOutline, signedArea } from "./geometry";
import { applyOps, opSchema, type OpInput } from "./ops";
import { DEFAULT_KNIT, DEFAULT_SKIRT, DEFAULT_SPEC, SAMPLE_BODY, type Spec } from "./spec";

const build = (spec: Spec) => familyOf(spec).build(spec, SAMPLE_BODY).garment;
const run = (spec: Spec, ops: OpInput[]) => applyOps(build(spec), ops.map((o) => opSchema.parse(o)));
const area = (g: ReturnType<typeof build>, id: string) =>
  g.panels.filter((p) => p.id === id || p.id.startsWith(id + ".")).reduce((s, p) => s + Math.abs(signedArea(panelOutline(p))), 0);

describe("splitPanel", () => {
  it("cuts a coat back into a yoke and a lower back, keeping the area and a valid check", () => {
    const base = build(DEFAULT_SPEC);
    const res = run(DEFAULT_SPEC, [{ op: "splitPanel", panel: "back", axis: "horizontal", at: 0.2, fabric: "contrast" }]);
    expect(res.error).toBeUndefined();
    const ids = res.garment.panels.map((p) => p.id);
    expect(ids).toContain("back.upper");
    expect(ids).toContain("back.lower");
    expect(ids).not.toContain("back");
    expect(res.garment.panels.find((p) => p.id === "back.lower")!.fabric).toBe("contrast");
    expect(area(res.garment, "back")).toBeCloseTo(area(base, "back"), 1);
    expect(res.garment.seams.some((s) => s.id === "back.split")).toBe(true);
    expect(checkGarment(res.garment).ok).toBe(true);
  });

  it("works on skirts and knit tops, front and back together", () => {
    for (const spec of [DEFAULT_SKIRT, DEFAULT_KNIT]) {
      const res = run(spec, [
        { op: "splitPanel", panel: "front", axis: "horizontal", at: 0.6, fabric: "contrast" },
        { op: "splitPanel", panel: "back", axis: "horizontal", at: 0.6, fabric: "contrast" },
      ]);
      expect(res.error).toBeUndefined();
      expect(checkGarment(res.garment).ok).toBe(true);
    }
  });

  it("splits a skirt panel vertically too", () => {
    const res = run({ ...DEFAULT_SKIRT, silhouette: "circle" }, [{ op: "splitPanel", panel: "front", axis: "vertical", at: 0.5 }]);
    expect(res.error).toBeUndefined();
    expect(res.garment.panels.map((p) => p.id)).toEqual(expect.arrayContaining(["front.left", "front.right"]));
  });

  it("refuses a cut that would run through a pocket", () => {
    const res = run(DEFAULT_SPEC, [{ op: "splitPanel", panel: "front", axis: "vertical", at: 0.5 }]);
    expect(res.error).toBeTruthy();
  });

  it("refuses a panel that does not exist, and a cut position that is off the panel", () => {
    expect(run(DEFAULT_SKIRT, [{ op: "splitPanel", panel: "nope", axis: "horizontal", at: 0.5 }]).error).toBeTruthy();
    expect(opSchema.safeParse({ op: "splitPanel", panel: "front", axis: "horizontal", at: 0.99 }).success).toBe(false);
  });
});
