import { describe, expect, it } from "vitest";
import { buildCoat } from "./base";
import { checkGarment } from "./check";
import { hoodOps, sideZipOps } from "./features";
import { polyLength } from "./geometry";
import { applyOps, opSchema, smoothPolyline } from "./ops";
import { DEFAULT_SPEC, SAMPLE_BODY, type CoatSpec, type Measurements, type Spec } from "./spec";

const body = (chest: number): Measurements => ({
  ...SAMPLE_BODY,
  chest,
  waist: chest - 12,
  hip: chest + 2,
  shoulder: 46 + (chest - 100) * 0.25,
  neck: 39 + (chest - 100) * 0.12,
  bicep: 33 + (chest - 100) * 0.2,
});

const specs: Record<string, Partial<CoatSpec>> = {
  default: {},
  fitted: { ease: "fitted", collar: "band", cuff: "rib", hem: "curved" },
  welt: { lowerPockets: "welt", chestPockets: 1, chestPocketStyle: "open", cuff: "open" },
  zip: { closure: "zip", lowerPockets: "patch", lowerPocketFlap: true },
  short: { lengthFraction: 0.9 },
  long: { lengthFraction: 1.35 },
};

describe("base chore coat", () => {
  for (const chest of [88, 96, 104, 112, 124]) {
    for (const [name, patch] of Object.entries(specs)) {
      it(`passes every check: chest ${chest}, ${name}`, () => {
        const { garment, derived } = buildCoat({ ...DEFAULT_SPEC, ...patch }, body(chest));
        const result = checkGarment(garment);
        const errors = result.issues.filter((i) => i.severity === "error");
        expect(errors.map((e) => e.message)).toEqual([]);
        expect(derived.capEase).toBeGreaterThan(0.5);
        expect(derived.capEase).toBeLessThan(4.5);
      });
    }
  }
});

describe("sleeve", () => {
  const len = (g: ReturnType<typeof buildCoat>["garment"], panel: string, edge: string) =>
    polyLength(g.panels.find((p) => p.id === panel)!.edges.find((e) => e.id === edge)!.pts);

  for (const chest of [88, 100, 112, 124]) {
    for (const ease of ["fitted", "regular", "boxy"] as const) {
      it(`each half of the cap matches its half of the armhole: chest ${chest}, ${ease}`, () => {
        const { garment, derived } = buildCoat({ ...DEFAULT_SPEC, ease }, body(chest));
        const front = len(garment, "sleeve", "cap.front") - len(garment, "front", "armhole");
        const back = len(garment, "sleeve", "cap.back") - len(garment, "back", "armhole");
        expect(front).toBeCloseTo(1, 1);
        expect(back).toBeCloseTo(1.5, 1);
        const armhole = len(garment, "front", "armhole") + len(garment, "back", "armhole");
        const ratio = derived.sleeveCapHeight / armhole;
        // A cap between a quarter and a fifth of the armhole is the usual range for shirts and workwear.
        expect(ratio).toBeGreaterThan(0.19);
        expect(ratio).toBeLessThan(0.3);
      });
    }
  }

  it("a fitted coat gets a narrower sleeve and a taller cap than a boxy one", () => {
    const fitted = buildCoat({ ...DEFAULT_SPEC, ease: "fitted" }, SAMPLE_BODY).derived;
    const boxy = buildCoat({ ...DEFAULT_SPEC, ease: "boxy" }, SAMPLE_BODY).derived;
    expect(fitted.sleeveWidth).toBeLessThan(boxy.sleeveWidth);
    expect(fitted.sleeveCapHeight).toBeGreaterThan(boxy.sleeveCapHeight);
  });
});

describe("addShape: freely drawn pieces", () => {
  const base = () => buildCoat(DEFAULT_SPEC, SAMPLE_BODY).garment;
  const len = (g: ReturnType<typeof base>, panel: string, edge: string) =>
    polyLength(g.panels.find((p) => p.id === panel)!.edges.find((e) => e.id === edge)!.pts);
  const hoodWith = (patch: Record<string, unknown>) => opSchema.parse({ ...hoodOps()[0], ...patch });

  it("the hood passes every check and its join edge matches the collar to the millimetre", () => {
    const res = applyOps(base(), hoodOps());
    expect(res.error).toBeUndefined();
    const errors = checkGarment(res.garment).issues.filter((i) => i.severity === "error");
    expect(errors.map((e) => e.message)).toEqual([]);
    expect(Math.abs(len(res.garment, "hood", "neck") - len(res.garment, "collar", "top"))).toBeLessThan(0.01);
    const hood = res.garment.panels.find((p) => p.id === "hood")!;
    expect(hood.cut).toEqual({ count: 2, mirror: true, onFold: false });
  });

  it("smooths curves through the points the model drew, without moving the ends", () => {
    const pts = [{ x: 0, y: 0 }, { x: 4, y: 3 }, { x: 8, y: 4 }, { x: 12, y: 3 }, { x: 16, y: 0 }];
    const smooth = smoothPolyline(pts);
    expect(smooth.length).toBeGreaterThan(pts.length * 4);
    expect(smooth[0]).toEqual(pts[0]);
    expect(smooth[smooth.length - 1]).toEqual(pts[pts.length - 1]);
    for (const p of pts) expect(smooth.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 1e-9)).toBe(true);
    // No overshoot: a gentle arch stays an arch.
    expect(Math.max(...smooth.map((p) => p.y))).toBeLessThan(4.6);
    expect(smoothPolyline([pts[0], pts[1]])).toEqual([pts[0], pts[1]]);

    const res = applyOps(base(), hoodOps());
    expect(res.garment.panels.find((p) => p.id === "hood")!.edges.find((e) => e.id === "centre")!.pts.length).toBeGreaterThan(30);
  });

  it("scales a piece drawn too big or too small so it still fits", () => {
    for (const k of [0.75, 1.35]) {
      const big = hoodOps()[0] as Extract<ReturnType<typeof hoodOps>[number], { op: "addShape" }>;
      const scaled = hoodWith({ edges: big.edges.map((e) => ({ ...e, pts: e.pts.map(([x, y]) => [x * k, y * k]) })) });
      const res = applyOps(base(), [scaled]);
      expect(res.error).toBeUndefined();
      expect(checkGarment(res.garment).ok).toBe(true);
      expect(Math.abs(len(res.garment, "hood", "neck") - len(res.garment, "collar", "top"))).toBeLessThan(0.01);
    }
  });

  it("snaps small gaps between edges but reports big ones", () => {
    const big = hoodOps()[0] as Extract<ReturnType<typeof hoodOps>[number], { op: "addShape" }>;
    const nudge = (gap: number) => hoodWith({ edges: big.edges.map((e, i) => (i === 1 ? { ...e, pts: e.pts.map(([x, y], j) => (j === 0 ? [x + gap, y] : [x, y])) } : e)) });
    expect(applyOps(base(), [nudge(1)]).error).toBeUndefined();
    const bad = applyOps(base(), [nudge(6)]);
    expect(bad.error).toMatch(/cm apart/);
    expect(bad.error).toMatch(/chain end to start/);
  });

  it("rejects a join edge that is nowhere near the right length, saying what length to aim for", () => {
    const big = hoodOps()[0] as Extract<ReturnType<typeof hoodOps>[number], { op: "addShape" }>;
    const huge = hoodWith({ edges: big.edges.map((e) => ({ ...e, pts: e.pts.map(([x, y]) => [x * 3, y * 3]) })) });
    const res = applyOps(base(), [huge]);
    expect(res.error).toMatch(/Redraw the whole piece/);
    expect(res.error).toMatch(/about 2\d cm/);
  });

  it("rejects unknown join targets and unknown edges", () => {
    expect(applyOps(base(), [hoodWith({ join: { edge: "neck", to: [{ panel: "collar", edge: "nope" }] } })]).error).toMatch(/no edge "nope"/);
    expect(applyOps(base(), [hoodWith({ join: { edge: "nope", to: [{ panel: "collar", edge: "top" }] } })]).error).toMatch(/not one of the new piece's edges/);
    expect(applyOps(base(), [hoodWith({ mirrorSeams: ["nope"] })]).error).toMatch(/mirrorSeams/);
  });

  it("the checker still catches a drawn piece that crosses itself", () => {
    const bow = opSchema.parse({
      op: "addShape",
      id: "bow",
      edges: [
        { id: "a", pts: [[0, 0], [10, 10]] },
        { id: "b", pts: [[10, 10], [10, 0]] },
        { id: "c", pts: [[10, 0], [0, 10]] },
        { id: "d", pts: [[0, 10], [0, 0]] },
      ],
    });
    const res = applyOps(base(), [bow]);
    expect(res.error).toBeUndefined();
    // A perfect bow-tie has no net area, so it is reported as an empty piece; a lopsided one is reported as crossing itself.
    const codes = checkGarment(res.garment).issues.filter((i) => i.severity === "error").map((i) => i.code);
    expect(codes.some((c) => c === "self-intersection" || c === "empty-panel")).toBe(true);

    const lopsided = opSchema.parse({
      op: "addShape",
      id: "twist",
      edges: [
        { id: "a", pts: [[0, 0], [14, 12]] },
        { id: "b", pts: [[14, 12], [14, 0]] },
        { id: "c", pts: [[14, 0], [4, 10]] },
        { id: "d", pts: [[4, 10], [0, 0]] },
      ],
    });
    const res2 = applyOps(base(), [lopsided]);
    expect(checkGarment(res2.garment).issues.some((i) => i.code === "self-intersection")).toBe(true);
  });
});

describe("operations", () => {
  const base = () => buildCoat(DEFAULT_SPEC, SAMPLE_BODY).garment;

  it("side zip opens the seam, adds a guard, and still passes", () => {
    const res = applyOps(base(), sideZipOps());
    expect(res.error).toBeUndefined();
    expect(res.garment.seams.some((s) => s.id === "side.zip")).toBe(true);
    expect(res.garment.panels.some((p) => p.id === "zip.guard")).toBe(true);
    const check = checkGarment(res.garment);
    expect(check.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("side zip from the hem works too", () => {
    const res = applyOps(base(), [opSchema.parse({ op: "openSeam", seam: "side", from: 0.6, length: 0.4 })]);
    expect(res.error).toBeUndefined();
    expect(checkGarment(res.garment).ok).toBe(true);
  });

  it("rejects an unknown seam with a helpful message", () => {
    const res = applyOps(base(), [opSchema.parse({ op: "openSeam", seam: "nope", from: 0.2, length: 0.4 })]);
    expect(res.error).toMatch(/Unknown seam "nope"/);
  });

  it("rejects an opening that is too short", () => {
    const res = applyOps(base(), [opSchema.parse({ op: "openSeam", seam: "side", from: 0.2, length: 0.05 })]);
    expect(res.error).toMatch(/too short/);
  });

  it("flags a slit placed outside the piece", () => {
    const res = applyOps(base(), [opSchema.parse({ op: "addSlit", panel: "front", at: { x: 1, y: 1 }, length: 10 })]);
    expect(res.error).toBeUndefined();
    const check = checkGarment(res.garment);
    expect(check.ok).toBe(false);
    expect(check.issues.some((i) => i.code === "slit-outside" || i.code === "slit-near-edge")).toBe(true);
  });

  it("flags a seam mismatch when only one side of a hem is moved", () => {
    const res = applyOps(base(), [opSchema.parse({ op: "offsetEdge", panel: "back", edge: "hem", amount: 5 })]);
    expect(res.error).toBeUndefined();
    const check = checkGarment(res.garment);
    expect(check.ok).toBe(false);
    expect(check.issues.some((i) => i.code === "seam-mismatch")).toBe(true);
  });

  it("moving both hems by the same amount stays valid", () => {
    const res = applyOps(base(), [
      opSchema.parse({ op: "offsetEdge", panel: "back", edge: "hem", amount: 4 }),
      opSchema.parse({ op: "offsetEdge", panel: "front", edge: "hem", amount: 4 }),
    ]);
    expect(res.error).toBeUndefined();
    expect(checkGarment(res.garment).ok).toBe(true);
  });
});
