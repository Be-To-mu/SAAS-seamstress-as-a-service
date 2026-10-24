import { describe, expect, it } from "vitest";
import { compose } from "./compose";
import { polyLength } from "./geometry";
import { defaultSpec, FAMILY_IDS, SAMPLE_BODY, type Fit } from "./spec";

const body = { ...SAMPLE_BODY, napeToHip: 66, waistToHip: 20 };
const edge = (c: ReturnType<typeof compose>, panel: string, id: string) =>
  c.garment.panels.find((p) => p.id === panel)!.edges.find((e) => e.id === id)!;
const height = (c: ReturnType<typeof compose>, panel: string) => {
  const ys = c.garment.panels.find((p) => p.id === panel)!.edges.flatMap((e) => e.pts.map((p) => p.y));
  return Math.max(...ys) - Math.min(...ys);
};

describe("fit adjustments", () => {
  const fits: Fit[] = [
    {},
    { length: 8 },
    { length: -10 },
    { waist: -10 },
    { waist: 8 },
    { shoulder: 3 },
    { shoulder: -3 },
    { sleeve: 6 },
    { sleeve: -6 },
    { length: -6, waist: -8, shoulder: 2, sleeve: 4 },
  ];

  for (const family of FAMILY_IDS) {
    it(`${family}: every adjustment still passes the seam check`, () => {
      for (const fit of fits) {
        const c = compose(defaultSpec(family), body, [], fit);
        const errors = c.check.issues.filter((i) => i.severity === "error");
        expect(errors, `${family} ${JSON.stringify(fit)}: ${errors.map((e) => e.message).join("; ")}`).toEqual([]);
      }
    });
  }

  it("length makes the body pieces longer or shorter by that much", () => {
    for (const family of FAMILY_IDS) {
      const panel = family === "skirt" ? compose(defaultSpec(family), body, []).garment.panels[0].id : "back";
      const base = height(compose(defaultSpec(family), body, []), panel);
      expect(height(compose(defaultSpec(family), body, [], { length: 8 }), panel)).toBeCloseTo(base + 8, 0);
    }
  });

  it("waist shaping takes the side seams in on coats and knits, front and back alike", () => {
    for (const family of ["coat", "knit"] as const) {
      const straight = compose(defaultSpec(family), body, []);
      const shaped = compose(defaultSpec(family), body, [], { waist: -8 });
      const minX = (c: typeof shaped, p: string) => Math.min(...edge(c, p, "side").pts.map((q) => q.x));
      expect(minX(straight, "back") - minX(shaped, "back")).toBeCloseTo(2, 1); // a quarter of 8 cm
      // front and back side seams stay the same length, so they still sew together
      expect(polyLength(edge(shaped, "front", "side").pts)).toBeCloseTo(polyLength(edge(shaped, "back", "side").pts), 1);
    }
  });

  it("shoulder and sleeve change the shoulder seam and the sleeve", () => {
    const spec = defaultSpec("coat");
    const base = compose(spec, body, []);
    const wider = compose(spec, body, [], { shoulder: 3 });
    const shoulderLen = (c: typeof base) => polyLength(edge(c, "back", "shoulder").pts);
    expect(shoulderLen(wider)).toBeGreaterThan(shoulderLen(base) + 1);
    expect(height(compose(spec, body, [], { sleeve: 6 }), "sleeve")).toBeCloseTo(height(base, "sleeve") + 6, 0);
  });

  it("clamps adjustments to sensible limits", () => {
    const c = compose(defaultSpec("coat"), body, [], { length: 500 });
    expect(height(c, "back")).toBeLessThan(height(compose(defaultSpec("coat"), body, []), "back") + 21);
  });
});
