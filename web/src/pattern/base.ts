import { addArmholeNotches, buildSleeve, E, fr } from "./blocks";
import { cubic, polyLength, pt } from "./geometry";
import { applyOps, type OpInput, opSchema, type Op } from "./ops";
import { EASE_CM, type CoatSpec, type Measurements } from "./spec";
import type { Garment, Panel, Pt } from "./types";

export { solveCap } from "./blocks";

export interface Derived {
  girth: number;
  length: number;
  backHalf: number;
  frontHalf: number;
  armholeDepth: number;
  sleeveCapHeight: number;
  sleeveWidth: number;
  capEase: number;
  sleeveLength: number;
}

const HEM_ALLOWANCE = 3.5;
const WRAP = 2.5; // finished front edge to button line
const FACING = 4; // facing folded back behind the finished edge
/** How much wider than the bicep the sleeve is cut. A trim coat needs less room, and so gets a taller cap. */
const SLEEVE_EASE = { fitted: 10, regular: 13, boxy: 16 } as const;

export function buildCoat(spec: CoatSpec, m: Measurements): { garment: Garment; derived: Derived } {
  const girth = m.chest + EASE_CM[spec.ease];
  const Wb = girth / 4 + 1;
  const Wf = girth / 4 - 1;
  const N = m.neck / 6 + 0.5;
  const ND = N + 1;
  const AD = m.chest / 6 + 9 + (spec.ease === "boxy" ? 1.5 : 0);
  const shoulderHalf = m.shoulder / 2 + { fitted: 0, regular: 0.8, boxy: 2 }[spec.ease];
  const S = pt(shoulderHalf, -2 + 4.5);
  const napeToHip = m.napeToHip ?? m.backLength + 20;
  const L = napeToHip * spec.lengthFraction;
  const hemGirth = Math.max(girth, m.hip + 16);
  const flare = (hemGirth - girth) / 4;
  const curve = spec.hem === "curved" ? 4 : 0;
  const hemSideY = L - curve;

  const hemCurve = (xMax: number, xEnd: number): Pt[] => {
    if (curve === 0) return [pt(xMax, hemSideY), pt(xEnd, L)];
    const pts: Pt[] = [];
    const n = 20;
    for (let i = 0; i <= n; i++) {
      const x = xMax * (1 - i / n);
      pts.push(pt(x, L - curve * (x / xMax) ** 2));
    }
    if (xEnd < 0) pts.push(pt(xEnd, L));
    return pts;
  };

  // ----- back (half, cut on the fold at centre back) -----
  const backNeck = cubic(pt(0, 0), pt(N * 0.5, 0), pt(N * 0.9, -0.8), pt(N, -2), 16);
  const backArm = cubic(S, pt(S.x - 0.2, S.y + 9), pt(Wb - 5, AD - 1), pt(Wb, AD), 28);
  const back: Panel = {
    id: "back",
    name: "Back",
    edges: [
      E("neck", backNeck),
      E("shoulder", [pt(N, -2), S]),
      E("armhole", backArm),
      E("side", [pt(Wb, AD), pt(Wb + flare, hemSideY)]),
      E("hem", hemCurve(Wb + flare, 0), HEM_ALLOWANCE),
      E("cb", [pt(0, L), pt(0, 0)], 0, "fold"),
    ],
    marks: [],
    cut: { count: 1, mirror: false, onFold: true },
    fabric: "shell",
    grain: [pt(Wb * 0.4, AD * 0.7), pt(Wb * 0.4, L * 0.9)],
  };

  // ----- front (half; includes the folded-back facing) -----
  const frontNeck = [pt(-WRAP, ND), pt(0, ND), ...cubic(pt(0, ND), pt(N * 0.5, ND), pt(N, 2), pt(N, -2), 20).slice(1)];
  const frontArm = cubic(S, pt(S.x - 1.5, S.y + 8), pt(Wf - 5, AD - 3), pt(Wf, AD), 28);
  const rawX = -(WRAP + FACING);
  const front: Panel = {
    id: "front",
    name: "Front",
    edges: [
      E("neck", frontNeck),
      E("shoulder", [pt(N, -2), S]),
      E("armhole", frontArm),
      E("side", [pt(Wf, AD), pt(Wf + flare, hemSideY)]),
      E("hem", hemCurve(Wf + flare, rawX), HEM_ALLOWANCE),
      E("cf", [pt(rawX, L), pt(rawX, ND)]),
      E("top", [pt(rawX, ND), pt(-WRAP, ND)]),
    ],
    marks: [
      { id: "fold", kind: "line", pts: [pt(-WRAP, ND), pt(-WRAP, L)], label: "fold facing back" },
      { id: "cfline", kind: "line", pts: [pt(0, ND), pt(0, L - 3)], label: "button line" },
    ],
    cut: { count: 2, mirror: true, onFold: false },
    fabric: "shell",
    grain: [pt(Wf * 0.55, AD * 0.7), pt(Wf * 0.55, L * 0.9)],
  };

  if (spec.closure !== "zip") {
    const y1 = ND + 4;
    const y2 = L - 10;
    for (let i = 0; i < spec.closureCount; i++) {
      const y = y1 + ((y2 - y1) * i) / (spec.closureCount - 1);
      front.marks.push({ id: `button.${i + 1}`, kind: "button", pts: [pt(0, y)] });
    }
  }

  // ----- sleeve -----
  const armholeLen = polyLength(frontArm) + polyLength(backArm);
  // A sleeve nearly as wide as the armhole is long gets a flat cap that drags when the arm lifts, so cap the width at 90% of the armhole,
  // but never leave less than 8 cm of room around the arm.
  const sleeveW = Math.max(m.bicep + 8, Math.min(m.bicep + SLEEVE_EASE[spec.ease], 0.9 * armholeLen));
  const wrist = m.wrist ?? 17;
  const hemW = wrist + 9;
  const cuffH = spec.cuff === "open" ? 0 : spec.cuff === "rib" ? 7 : 6.5;
  const hemY = m.armLength + 1.5 - cuffH;
  const { panel: sleeve, caps, capH } = buildSleeve({ frontArm, backArm, width: sleeveW, hemW, hemY, hemAllowance: spec.cuff === "open" ? HEM_ALLOWANCE : 1 });

  // ----- collar -----
  const neckLen = polyLength(frontNeck) + polyLength(backNeck);
  const collarH = spec.collar === "band" ? 4.5 : 8;
  const spread = spec.collar === "band" ? 0 : 3;
  const collar: Panel = {
    id: "collar",
    name: "Collar",
    edges: [
      E("top", [pt(0, 0), pt(neckLen + spread, 0)]),
      E("end", [pt(neckLen + spread, 0), pt(neckLen, collarH)]),
      E("neck", [pt(neckLen, collarH), pt(0, collarH)]),
      E("cb", [pt(0, collarH), pt(0, 0)], 0, "fold"),
    ],
    marks: [],
    cut: { count: 2, mirror: false, onFold: true },
    fabric: "contrast",
    grain: [pt(neckLen * 0.3, collarH / 2), pt(neckLen * 0.7, collarH / 2)],
  };

  const garment: Garment = {
    panels: [back, front, sleeve, collar],
    seams: [
      { id: "shoulder", a: [{ panel: "front", edge: "shoulder" }], b: [{ panel: "back", edge: "shoulder" }], ease: [-0.5, 0.5], kind: "sewn" },
      { id: "side", a: [{ panel: "front", edge: "side" }], b: [{ panel: "back", edge: "side" }], ease: [-0.5, 0.5], kind: "sewn" },
      {
        id: "armhole",
        a: [{ panel: "front", edge: "armhole" }, { panel: "back", edge: "armhole" }],
        b: [{ panel: "sleeve", edge: "cap.front" }, { panel: "sleeve", edge: "cap.back" }],
        ease: [0.5, 4.5],
        kind: "sewn",
      },
      { id: "sleeve.under", a: [{ panel: "sleeve", edge: "under.r" }], b: [{ panel: "sleeve", edge: "under.l" }], ease: [-0.5, 0.5], kind: "sewn" },
      {
        id: "collar.neck",
        a: [{ panel: "front", edge: "neck" }, { panel: "back", edge: "neck" }],
        b: [{ panel: "collar", edge: "neck" }],
        ease: [-0.5, 0.5],
        kind: "sewn",
      },
    ],
    notions: [],
  };

  addArmholeNotches(front, back, sleeve, frontArm, backArm, caps);

  // ----- pockets and cuffs, built with the same operations a generated feature uses -----
  const ops: OpInput[] = [];
  const chestTop = AD - 6;
  // Pockets are sized from the front panel width so they still fit on small, fitted coats.
  const chestX = 5.5;
  const chestW = Math.min(14, Wf - 5 - chestX);
  if (spec.chestPockets > 0) {
    ops.push({
      op: "addPiece",
      id: "pocket.chest",
      name: "Chest pocket",
      shape: "rect",
      width: chestW,
      height: 15.5,
      place: { panel: "front", ...fr(front, chestX, chestTop) },
      count: spec.chestPockets,
    });
    if (spec.chestPocketStyle === "flap") {
      ops.push({
        op: "addPiece",
        id: "flap.chest",
        name: "Chest pocket flap",
        shape: "flap",
        width: chestW + 0.5,
        height: 5.5,
        place: { panel: "front", ...fr(front, chestX - 0.25, chestTop - 5.7) },
        count: spec.chestPockets,
      });
    }
  }
  const lowerH = Math.min(20, L * 0.28);
  const lowerTop = L - 8 - lowerH;
  const lowerX = 6;
  const lowerW = Math.min(18, Wf - 5 - lowerX);
  if (spec.lowerPockets === "patch") {
    ops.push({
      op: "addPiece",
      id: "pocket.lower",
      name: "Lower pocket",
      shape: "rect",
      width: lowerW,
      height: lowerH,
      place: { panel: "front", ...fr(front, lowerX, lowerTop) },
      count: 2,
    });
    if (spec.lowerPocketFlap) {
      ops.push({
        op: "addPiece",
        id: "flap.lower",
        name: "Lower pocket flap",
        shape: "flap",
        width: lowerW + 0.5,
        height: 5.5,
        place: { panel: "front", ...fr(front, lowerX - 0.25, lowerTop - 5.7) },
        count: 2,
      });
    }
  } else if (spec.lowerPockets === "welt") {
    const weltLen = Math.min(18, Wf - 5 - lowerX - 2);
    ops.push({ op: "addSlit", panel: "front", at: fr(front, lowerX + 1 + weltLen / 2, L - 18), length: weltLen, angle: 0, id: "welt.lower" });
    ops.push({
      op: "addPiece",
      id: "bag.lower",
      name: "Lower pocket bag",
      shape: "bag",
      height: 22,
      attach: { panel: "front", mark: "welt.lower" },
      count: 4,
    });
  }
  if (spec.cuff === "button") {
    ops.push({
      op: "addPiece",
      id: "cuff",
      name: "Cuff",
      shape: "rect",
      height: cuffH,
      attach: { panel: "sleeve", edge: "hem" },
      count: 2,
    });
  } else if (spec.cuff === "rib") {
    ops.push({ op: "addPiece", id: "cuff", name: "Rib cuff", shape: "rect", width: hemW * 0.7, height: cuffH, count: 2, fabric: "contrast" });
  }

  const parsed: Op[] = ops.map((o) => opSchema.parse(o));
  const res = applyOps(garment, parsed);
  if (res.error) throw new Error(`Base coat failed to build: ${res.error}`);
  const out = res.garment;
  if (spec.cuff === "rib") {
    out.seams.push({
      id: "cuff.attach",
      a: [{ panel: "sleeve", edge: "hem" }],
      b: [{ panel: "cuff", edge: "top" }],
      ease: [-0.35 * hemW, -0.25 * hemW],
      kind: "sewn",
    });
  }

  // ----- notions -----
  const flaps = (spec.chestPockets > 0 && spec.chestPocketStyle === "flap" ? spec.chestPockets : 0) + (spec.lowerPockets === "patch" && spec.lowerPocketFlap ? 2 : 0);
  const buttons = (spec.closure === "buttons" ? spec.closureCount : 0) + (spec.cuff === "button" ? 4 : 0) + flaps;
  if (buttons > 0) out.notions.push({ name: "Buttons", qty: buttons, unit: "pcs" });
  if (spec.closure === "snaps") out.notions.push({ name: "Snap fasteners (front)", qty: spec.closureCount, unit: "sets" });
  if (spec.closure === "zip") out.notions.push({ name: `Zip, ${Math.round(L - ND)} cm, front`, qty: 1, unit: "pc" });
  out.notions.push({ name: "Thread", qty: 1, unit: "spool" });

  return {
    garment: out,
    derived: {
      girth,
      length: L,
      backHalf: Wb,
      frontHalf: Wf,
      armholeDepth: AD,
      sleeveCapHeight: capH,
      sleeveWidth: sleeveW,
      capEase: polyLength(caps.front) + polyLength(caps.back) - armholeLen,
      sleeveLength: m.armLength + 1.5,
    },
  };
}
