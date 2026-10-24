import { addArmholeNotches, bandPanel, buildSleeve, E, fr, placePatch, solveCap } from "./blocks";
import { hoodOps } from "./features";
import { cubic, polyLength, pt } from "./geometry";
import { applyOps, opSchema, type Op, type OpInput } from "./ops";
import type { KnitSpec, Measurements } from "./spec";
import type { Garment, Panel, Pt, Seam } from "./types";

export interface KnitDerived {
  girth: number;
  length: number;
  /** Full neckline, front and back together. */
  neckline: number;
  /** Cap ease, or 0 for a sleeveless top. */
  capEase: number;
}

/** Extra room around the chest. A knit stretches, so even the roomy fit is smaller than a woven coat's. */
const KNIT_EASE = { fitted: 4, regular: 14, boxy: 24 } as const;
const SLEEVE_EASE = { fitted: 6, regular: 9, boxy: 14 } as const;
const FRONT_NECK_DEPTH = { crew: 8, scoop: 11.5, v: 16, hooded: 8 } as const;
const HEM = 2.5;
const BAND_H = 6;
/** Rib is cut shorter than the edge it is stretched onto. */
const RIB = 0.9;

/**
 * A pull-over knit top: tee, long-sleeve tee, sweatshirt or hoodie. The torso is cut as two halves on the fold,
 * so the front and back are each one piece. Neck and hem finishes are separate bands, as they are in real knitwear.
 */
export function buildKnit(spec: KnitSpec, m: Measurements): { garment: Garment; derived: KnitDerived } {
  const girth = m.chest + KNIT_EASE[spec.ease];
  const Wb = girth / 4 + 0.5;
  const Wf = girth / 4 - 0.5;
  const sleeveless = spec.sleeve === "sleeveless";
  const hooded = spec.neck === "hooded";
  const N = m.neck / 6 + 3;
  const AD = m.chest / 6 + 8 + (spec.ease === "boxy" ? 1.5 : 0) + (sleeveless ? 1.5 : 0);
  const shoulderHalf = m.shoulder / 2 + { fitted: 0, regular: 1, boxy: 2.5 }[spec.ease] - (sleeveless ? 3 : 0);
  const S = pt(shoulderHalf, 2.5);
  const napeToHip = m.napeToHip ?? m.backLength + 20;
  const L = napeToHip * spec.lengthFraction;
  const band = spec.hem === "band";
  const Lb = band ? L - BAND_H : L; // the body ends where the band begins
  const fd = FRONT_NECK_DEPTH[spec.neck];

  // ----- torso -----
  const backNeck = cubic(pt(0, 0), pt(N * 0.5, 0), pt(N * 0.9, -0.8), pt(N, -2), 16);
  const frontNeck = spec.neck === "v" ? [pt(0, fd), pt(N, -2)] : cubic(pt(0, fd), pt(N * 0.55, fd), pt(N, 2), pt(N, -2), 20);
  const backArm = cubic(S, pt(S.x - 0.2, S.y + 9), pt(Wb - 5, AD - 1), pt(Wb, AD), 28);
  const frontArm = cubic(S, pt(S.x - 1.5, S.y + 8), pt(Wf - 5, AD - 3), pt(Wf, AD), 28);
  const hemAllowance = band ? 1 : HEM;

  const back: Panel = {
    id: "back",
    name: "Back",
    edges: [
      E("neck", backNeck),
      E("shoulder", [pt(N, -2), S]),
      E("armhole", backArm),
      E("side", [pt(Wb, AD), pt(Wb, Lb)]),
      E("hem", [pt(Wb, Lb), pt(0, Lb)], hemAllowance),
      E("cb", [pt(0, Lb), pt(0, 0)], 0, "fold"),
    ],
    marks: [],
    cut: { count: 1, mirror: false, onFold: true },
    fabric: "shell",
    grain: [pt(Wb * 0.4, AD * 0.7), pt(Wb * 0.4, Lb * 0.9)],
  };
  const front: Panel = {
    id: "front",
    name: "Front",
    edges: [
      E("neck", frontNeck),
      E("shoulder", [pt(N, -2), S]),
      E("armhole", frontArm),
      E("side", [pt(Wf, AD), pt(Wf, Lb)]),
      E("hem", [pt(Wf, Lb), pt(0, Lb)], hemAllowance),
      E("cf", [pt(0, Lb), pt(0, fd)], 0, "fold"),
    ],
    marks: [],
    cut: { count: 1, mirror: false, onFold: true },
    fabric: "shell",
    grain: [pt(Wf * 0.4, AD * 0.7), pt(Wf * 0.4, Lb * 0.9)],
  };

  const panels: Panel[] = [back, front];
  const seams: Seam[] = [
    { id: "shoulder", a: [{ panel: "front", edge: "shoulder" }], b: [{ panel: "back", edge: "shoulder" }], ease: [-0.5, 0.5], kind: "sewn" },
    { id: "side", a: [{ panel: "front", edge: "side" }], b: [{ panel: "back", edge: "side" }], ease: [-0.5, 0.5], kind: "sewn" },
  ];
  const notions: Garment["notions"] = [];
  const armholeLen = polyLength(frontArm) + polyLength(backArm);
  const neckHalf = polyLength(frontNeck) + polyLength(backNeck);
  let capEase = 0;

  // ----- sleeve -----
  if (!sleeveless) {
    const wrist = m.wrist ?? 17;
    const width = Math.max(m.bicep + 6, Math.min(m.bicep + SLEEVE_EASE[spec.ease], 0.9 * armholeLen));
    const long = spec.sleeve === "long";
    const cuffH = long && spec.cuff === "rib" ? 6 : 0;
    // The cap height is needed to place the hem, so solve it once here and let buildSleeve solve it again.
    const { h: capGuess } = solveCap(width, polyLength(frontArm) + 0.5, polyLength(backArm) + 1);
    const fullLen = m.armLength + 1.5;
    const hemY = long ? fullLen - cuffH : Math.max(0.34 * m.armLength, capGuess + 6);
    // The arm narrows from the bicep to the wrist; a short sleeve ends part-way down that taper.
    const taper = Math.min(1, Math.max(0, (hemY - capGuess) / (fullLen - capGuess)));
    const hemW = Math.max(wrist + 8, width - (width - (wrist + 9)) * taper);
    const { panel: sleeve, caps, capH } = buildSleeve({ frontArm, backArm, width, hemW, hemY, hemAllowance: long && spec.cuff === "rib" ? 1 : HEM, capEaseFront: 0.5, capEaseBack: 1 });
    panels.push(sleeve);
    addArmholeNotches(front, back, sleeve, frontArm, backArm, caps);
    capEase = polyLength(caps.front) + polyLength(caps.back) - armholeLen;
    seams.push(
      {
        id: "armhole",
        a: [{ panel: "front", edge: "armhole" }, { panel: "back", edge: "armhole" }],
        b: [{ panel: "sleeve", edge: "cap.front" }, { panel: "sleeve", edge: "cap.back" }],
        ease: [0.5, 4.5],
        kind: "sewn",
      },
      { id: "sleeve.under", a: [{ panel: "sleeve", edge: "under.r" }], b: [{ panel: "sleeve", edge: "under.l" }], ease: [-0.5, 0.5], kind: "sewn" },
    );
    if (long && spec.cuff === "rib") {
      const cuffLen = hemW * 0.8;
      const cuff = bandPanel({ id: "cuff", name: "Rib cuff", length: cuffLen, height: cuffH, count: 2, fabric: "contrast" });
      panels.push(cuff);
      seams.push(
        { id: "cuff.attach", a: [{ panel: "sleeve", edge: "hem" }], b: [{ panel: "cuff", edge: "top" }], ease: [-0.25 * hemW - 0.5, -0.15 * hemW + 0.5], kind: "sewn" },
        { id: "cuff.join", a: [{ panel: "cuff", edge: "start" }], b: [{ panel: "cuff", edge: "end" }], ease: [-0.5, 0.5], kind: "sewn" },
      );
    }
  } else {
    notions.push({ name: "Bias binding for the armholes", qty: Math.ceil((armholeLen * 2) / 100 + 0.1), unit: "m" });
  }

  // ----- neck finish -----
  if (!hooded) {
    const bandLen = neckHalf * RIB;
    const nb = bandPanel({ id: "neckband", name: "Neckband", length: bandLen, height: 3.2, count: 2, mirror: true, fabric: "contrast" });
    panels.push(nb);
    seams.push(
      { id: "neckband.attach", a: [{ panel: "front", edge: "neck" }, { panel: "back", edge: "neck" }], b: [{ panel: "neckband", edge: "top" }], ease: [-0.15 * neckHalf - 0.5, -0.05 * neckHalf + 0.5], kind: "sewn" },
      // Two half-bands make a ring: each end is sewn to the same end of the other half.
      { id: "neckband.ends", a: [{ panel: "neckband", edge: "start" }], b: [{ panel: "neckband", edge: "start" }], ease: [-0.5, 0.5], kind: "sewn" },
      { id: "neckband.ends2", a: [{ panel: "neckband", edge: "end" }], b: [{ panel: "neckband", edge: "end" }], ease: [-0.5, 0.5], kind: "sewn" },
    );
  }

  // ----- hem band -----
  if (band) {
    const fb = bandPanel({ id: "hemband.front", name: "Front hem band", length: Wf * RIB, height: BAND_H, fold: true, fabric: "contrast" });
    const bb = bandPanel({ id: "hemband.back", name: "Back hem band", length: Wb * RIB, height: BAND_H, fold: true, fabric: "contrast" });
    panels.push(fb, bb);
    seams.push(
      { id: "hemband.front.attach", a: [{ panel: "front", edge: "hem" }], b: [{ panel: "hemband.front", edge: "top" }], ease: [-0.15 * Wf - 0.5, -0.05 * Wf + 0.5], kind: "sewn" },
      { id: "hemband.back.attach", a: [{ panel: "back", edge: "hem" }], b: [{ panel: "hemband.back", edge: "top" }], ease: [-0.15 * Wb - 0.5, -0.05 * Wb + 0.5], kind: "sewn" },
      { id: "hemband.side", a: [{ panel: "hemband.front", edge: "end" }], b: [{ panel: "hemband.back", edge: "end" }], ease: [-0.5, 0.5], kind: "sewn" },
    );
  }

  const garment: Garment = { panels, seams, notions };

  // ----- pocket and hood, built with the same operations a generated feature uses -----
  const ops: OpInput[] = [];
  if (spec.pocket === "patch") {
    // Near the centre front, a hand's width below the armhole start, wherever the neckline and armhole leave room.
    const spot = placePatch(front, 11, 12.5, AD - 2, "centre");
    if (spot) ops.push({ op: "addPiece", id: "pocket.chest", name: "Chest pocket", shape: "rect", width: 11, height: 12.5, place: { panel: "front", ...fr(front, spot.x, spot.y) }, count: 1 });
  } else if (spec.pocket === "kangaroo") {
    // Half of a wide pouch pocket, cut on the fold so it is one piece across the whole front.
    const ph = Math.min(26, Lb * 0.34);
    const pw = Math.min(Wf - 3, 20);
    const y0 = Math.min(AD + 10, Lb - ph - 3);
    const pocket = bandPanel({ id: "pocket.kangaroo", name: "Kangaroo pocket", length: pw, height: ph, fold: true });
    panels.push(pocket);
    front.marks.push({ id: "place.pocket.kangaroo", kind: "placement", pts: [pt(0.05, y0), pt(pw, y0), pt(pw, y0 + ph), pt(0.05, y0 + ph), pt(0.05, y0)], label: pocket.name });
    notions.push({ name: "Topstitch thread for the pocket", qty: 1, unit: "spool" });
  }
  if (hooded) ops.push(...(hoodOps([{ panel: "front", edge: "neck" }, { panel: "back", edge: "neck" }]) as OpInput[]));
  const parsed: Op[] = ops.map((o) => opSchema.parse(o));
  const res = applyOps(garment, parsed);
  if (res.error) throw new Error(`Base knit top failed to build: ${res.error}`);
  const out = res.garment;

  if (out.panels.some((p) => p.fabric === "contrast")) out.notions.push({ name: "Rib knit for the contrast bands", qty: 1, unit: "piece" });
  out.notions.push({ name: "Stretch needle and thread", qty: 1, unit: "spool" });
  if (hooded) out.notions.push({ name: "Drawcord (optional)", qty: 1, unit: "pc" });

  return { garment: out, derived: { girth, length: L, neckline: neckHalf * 2, capEase } };
}
