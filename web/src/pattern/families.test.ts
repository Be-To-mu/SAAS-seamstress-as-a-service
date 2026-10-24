import { describe, expect, it } from "vitest";
import { compose } from "./compose";
import { FAMILIES } from "./families";
import { DEFAULT_KNIT, DEFAULT_SKIRT, DEFAULT_SPEC, FAMILY_IDS, SAMPLE_BODY, type KnitSpec, type Measurements, type SkirtSpec, type Spec } from "./spec";

const SMALL: Measurements = { chest: 80, waist: 64, hip: 88, shoulder: 38, neck: 33, backLength: 38, armLength: 56, bicep: 25, wrist: 15 };
const LARGE: Measurements = { chest: 125, waist: 112, hip: 128, shoulder: 54, neck: 45, backLength: 50, armLength: 72, bicep: 44, wrist: 21 };
const BODIES: Record<string, Measurements> = { small: SMALL, sample: SAMPLE_BODY, large: LARGE };

/** Every combination of the listed option values. */
function grid<T extends Spec>(base: T, options: Partial<Record<keyof T, unknown[]>>): T[] {
  let out: T[] = [base];
  for (const [key, values] of Object.entries(options) as [keyof T, unknown[]][]) {
    out = out.flatMap((s) => values.map((v) => ({ ...s, [key]: v }) as T));
  }
  return out;
}

function problems(spec: Spec, body: Measurements): string[] {
  try {
    const c = compose(spec, body, []);
    return c.check.issues.filter((i) => i.severity === "error").map((i) => i.message);
  } catch (e) {
    return [e instanceof Error ? e.message : String(e)];
  }
}

function sweep(specs: Spec[]) {
  const failures: string[] = [];
  for (const spec of specs) {
    for (const [name, body] of Object.entries(BODIES)) {
      const p = problems(spec, body);
      if (p.length) failures.push(`${name} ${JSON.stringify(spec)}: ${p[0]}`);
    }
  }
  return failures;
}

describe("knit top", () => {
  const specs = grid(DEFAULT_KNIT, {
    neck: ["crew", "scoop", "v", "hooded"],
    sleeve: ["sleeveless", "short", "long"],
    cuff: ["plain", "rib"],
    hem: ["plain", "band"],
    pocket: ["none", "patch", "kangaroo"],
    ease: ["fitted", "regular", "boxy"],
  });

  it(`passes every check for all ${specs.length} combinations on small, average and large bodies`, () => {
    const failures = sweep(specs);
    expect(failures.slice(0, 5)).toEqual([]);
  });

  it("has the pieces its choices call for", () => {
    const ids = (s: KnitSpec) => compose(s, SAMPLE_BODY, []).garment.panels.map((p) => p.id);
    expect(ids(DEFAULT_KNIT)).toEqual(expect.arrayContaining(["front", "back", "sleeve", "neckband"]));
    expect(ids({ ...DEFAULT_KNIT, sleeve: "sleeveless" })).not.toContain("sleeve");
    expect(ids({ ...DEFAULT_KNIT, sleeve: "long", cuff: "rib" })).toContain("cuff");
    expect(ids({ ...DEFAULT_KNIT, sleeve: "short", cuff: "rib" })).not.toContain("cuff");
    expect(ids({ ...DEFAULT_KNIT, hem: "band" })).toEqual(expect.arrayContaining(["hemband.front", "hemband.back"]));
    const hoodie = ids({ ...DEFAULT_KNIT, neck: "hooded", sleeve: "long", pocket: "kangaroo" });
    expect(hoodie).toEqual(expect.arrayContaining(["hood", "pocket.kangaroo"]));
    expect(hoodie).not.toContain("neckband");
  });

  it("makes a short sleeve shorter than a long one, and a fitted top narrower than a boxy one", () => {
    const width = (s: KnitSpec) => {
      const front = compose(s, SAMPLE_BODY, []).garment.panels.find((p) => p.id === "front")!;
      return Math.max(...front.edges.flatMap((e) => e.pts.map((p) => p.x)));
    };
    expect(width({ ...DEFAULT_KNIT, ease: "fitted" })).toBeLessThan(width({ ...DEFAULT_KNIT, ease: "boxy" }));
    const sleeveH = (s: KnitSpec) => {
      const sl = compose(s, SAMPLE_BODY, []).garment.panels.find((p) => p.id === "sleeve")!;
      const ys = sl.edges.flatMap((e) => e.pts.map((p) => p.y));
      return Math.max(...ys) - Math.min(...ys);
    };
    expect(sleeveH({ ...DEFAULT_KNIT, sleeve: "short" })).toBeLessThan(sleeveH({ ...DEFAULT_KNIT, sleeve: "long" }) * 0.6);
  });

  it("is wide enough at the neck for a head to pass", () => {
    // A head is about 56 cm round. A knit neckline stretches, but the cut opening must not be much smaller than the head.
    for (const neck of ["crew", "scoop", "v"] as const) {
      const c = compose({ ...DEFAULT_KNIT, neck }, SAMPLE_BODY, []);
      const line = Number(c.stats.find((s) => s.label === "Neckline")!.value.replace(" cm", ""));
      expect(line).toBeGreaterThan(46);
    }
  });
});

describe("skirt", () => {
  const specs = grid(DEFAULT_SKIRT, {
    silhouette: ["pencil", "a-line", "circle", "gathered"],
    length: ["mini", "knee", "midi", "maxi"],
    waist: ["band", "elastic"],
    pockets: ["none", "patch"],
    ease: ["fitted", "regular", "boxy"],
  });

  it(`passes every check for all ${specs.length} combinations on small, average and large bodies`, () => {
    const failures = sweep(specs);
    expect(failures.slice(0, 5)).toEqual([]);
  });

  it("fits the hips in every shape, and the waist when the band is fitted", () => {
    const failures: string[] = [];
    for (const spec of specs) {
      for (const [name, body] of Object.entries(BODIES)) {
        const stats = compose(spec, body, []).stats;
        const num = (label: string) => Number(stats.find((s) => s.label === label)?.value.replace(/[^\d.]/g, ""));
        if (num("Finished hip") < body.hip + 3) failures.push(`${name} ${JSON.stringify(spec)}: hip ${num("Finished hip")} < ${body.hip}`);
        if (spec.waist === "band" && Math.abs(num("Finished waist") - (body.waist + 1.5)) > 1) failures.push(`${name} ${JSON.stringify(spec)}: waist ${num("Finished waist")}`);
      }
    }
    expect(failures.slice(0, 5)).toEqual([]);
  });

  it("keeps gathers to a sewable amount", () => {
    for (const spec of specs.filter((s) => s.silhouette === "gathered")) {
      const c = compose(spec, SAMPLE_BODY, []);
      const g = c.stats.find((s) => s.label === "Gathers");
      if (g) expect(parseFloat(g.value)).toBeLessThan(3.2);
    }
  });

  it("opens a side zip on a fitted band and not on an elastic waist", () => {
    const zip = (s: SkirtSpec) => compose(s, SAMPLE_BODY, []).garment.seams.some((x) => x.kind === "zip");
    expect(zip({ ...DEFAULT_SKIRT, waist: "band" })).toBe(true);
    expect(zip({ ...DEFAULT_SKIRT, waist: "elastic" })).toBe(false);
    const notions = compose({ ...DEFAULT_SKIRT, waist: "band" }, SAMPLE_BODY, []).garment.notions;
    expect(notions.find((n) => n.name.includes("zip"))?.qty).toBe(1);
  });

  it("makes a longer skirt longer and a fuller circle skirt wider", () => {
    const len = (s: SkirtSpec) => Number(compose(s, SAMPLE_BODY, []).stats.find((x) => x.label === "Length from waist")!.value.replace(" cm", ""));
    expect(len({ ...DEFAULT_SKIRT, length: "mini" })).toBeLessThan(len({ ...DEFAULT_SKIRT, length: "maxi" }));
    const hem = (s: SkirtSpec) => {
      const fr = compose(s, SAMPLE_BODY, []).garment.panels.find((p) => p.id === "front")!;
      return Math.max(...fr.edges.flatMap((e) => e.pts.map((p) => p.x)));
    };
    expect(hem({ ...DEFAULT_SKIRT, silhouette: "circle", ease: "fitted" })).toBeLessThan(hem({ ...DEFAULT_SKIRT, silhouette: "circle", ease: "boxy" }));
  });
});

describe("garment families", () => {
  it("every family builds its default design and describes it for the picture model", () => {
    const defaults: Spec[] = [DEFAULT_SPEC, DEFAULT_KNIT, DEFAULT_SKIRT];
    expect(defaults.map((s) => s.family)).toEqual([...FAMILY_IDS]);
    for (const s of defaults) {
      const def = FAMILIES[s.family];
      expect(def.describe(s)).toMatch(/\S+/);
      expect(def.build(s, SAMPLE_BODY).garment.panels.length).toBeGreaterThanOrEqual(3);
    }
  });
});
