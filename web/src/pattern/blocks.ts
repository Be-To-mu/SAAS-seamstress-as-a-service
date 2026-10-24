import { bbox, cubic, distToPoly, panelOutline, pointInPoly, polyLength, pt } from "./geometry";
import { addNotchAt } from "./ops";
import type { Edge, Panel, Pt } from "./types";

/** Shared building pieces for every garment family: edges, sleeves, bands. */

export const E = (id: string, pts: Pt[], allowance = 1, kind?: "fold"): Edge => ({ id, pts, allowance, kind });

/** Fractions of a panel's bounding box for a point given in panel cm, as used by the pattern operations. */
export function fr(panel: Panel, x: number, y: number) {
  const bb = bbox(panelOutline(panel));
  return { x: Math.min(1, Math.max(0, (x - bb.minX) / bb.w)), y: Math.min(1, Math.max(0, (y - bb.minY) / bb.h)) };
}

/** The sleeve cap. The top of the cap sits at x0, a little off centre, so the front and back halves can have different lengths. */
export function capCurves(W: number, h: number, x0 = 0) {
  const front = cubic(pt(-W / 2, h), pt(-W / 2 + 0.05 * W, h * 0.45), pt(x0 - 0.22 * W, 0), pt(x0, 0), 28);
  const back = cubic(pt(x0, 0), pt(x0 + 0.22 * W, 0), pt(W / 2 - 0.05 * W, h * 0.45), pt(W / 2, h), 28);
  return { front, back };
}

/**
 * Find the cap height `h` and the off-centre top `x0` so the front half of the cap is `targetFront` long and the back half is `targetBack` long.
 * Each half then matches its half of the armhole (plus its own ease), which is what makes the sleeve notches line up.
 */
export function solveCap(W: number, targetFront: number, targetBack: number): { h: number; x0: number } {
  const limit = 0.3 * W;
  const frontLen = (h: number, x0: number) => polyLength(capCurves(W, h, x0).front);
  const topFor = (h: number) => {
    // The longer the front half, the further the top has moved toward the back, so this is a simple bisection.
    let lo = -limit;
    let hi = limit;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (frontLen(h, mid) < targetFront) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  let lo = 3;
  let hi = 30;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const c = capCurves(W, mid, topFor(mid));
    if (polyLength(c.front) + polyLength(c.back) < targetFront + targetBack) lo = mid;
    else hi = mid;
  }
  const h = (lo + hi) / 2;
  return { h, x0: topFor(h) };
}

/** Ease built into the cap, split between the two halves. The back takes more, as on a real sleeve. */
export const CAP_EASE_FRONT = 1;
export const CAP_EASE_BACK = 1.5;

export interface SleeveInput {
  frontArm: Pt[];
  backArm: Pt[];
  /** Width of the sleeve at the top of the arm. */
  width: number;
  hemW: number;
  /** Where the sleeve hem sits, measured down from the top of the cap. */
  hemY: number;
  hemAllowance: number;
  /** Knits stretch, so their cap is eased in less. */
  capEaseFront?: number;
  capEaseBack?: number;
}

/** A set-in sleeve whose cap is solved so its front and back halves match the front and back armholes. */
export function buildSleeve(i: SleeveInput) {
  const { h: capH, x0: capTop } = solveCap(i.width, polyLength(i.frontArm) + (i.capEaseFront ?? CAP_EASE_FRONT), polyLength(i.backArm) + (i.capEaseBack ?? CAP_EASE_BACK));
  const caps = capCurves(i.width, capH, capTop);
  const panel: Panel = {
    id: "sleeve",
    name: "Sleeve",
    edges: [
      E("cap.back", caps.back),
      E("under.r", [pt(i.width / 2, capH), pt(i.hemW / 2, i.hemY)]),
      E("hem", [pt(i.hemW / 2, i.hemY), pt(-i.hemW / 2, i.hemY)], i.hemAllowance),
      E("under.l", [pt(-i.hemW / 2, i.hemY), pt(-i.width / 2, capH)]),
      E("cap.front", caps.front),
    ],
    marks: [],
    cut: { count: 2, mirror: true, onFold: false },
    fabric: "shell",
    grain: [pt(0, capH + 4), pt(0, i.hemY - 4)],
  };
  return { panel, caps, capH };
}

/** Armhole matching notches: one on the front, two on the back. Each sits the same distance from the underarm on the body and on the sleeve. */
export function addArmholeNotches(front: Panel, back: Panel, sleeve: Panel, frontArm: Pt[], backArm: Pt[], caps: { front: Pt[]; back: Pt[] }) {
  const fLen = polyLength(frontArm);
  const bLen = polyLength(backArm);
  const capFrontLen = polyLength(caps.front);
  const capBackLen = polyLength(caps.back);
  addNotchAt(front, "armhole", 1 - 10 / fLen);
  addNotchAt(sleeve, "cap.front", 10 / capFrontLen);
  for (const d of [11, 12.2]) {
    addNotchAt(back, "armhole", 1 - d / bLen);
    addNotchAt(sleeve, "cap.back", 1 - d / capBackLen);
  }
}

/**
 * A straight band (a waistband, a rib hem band, a cuff). Its "top" edge is the one that is sewn to the garment.
 * When `fold` is true the band is drawn as a half and cut on the fold at its "fold" edge.
 */
export function bandPanel(opts: { id: string; name: string; length: number; height: number; fold?: boolean; count?: number; fabric?: "shell" | "contrast" | "lining"; mirror?: boolean }): Panel {
  const { length: w, height: h } = opts;
  const edges: Edge[] = opts.fold
    ? [E("top", [pt(0, 0), pt(w, 0)]), E("end", [pt(w, 0), pt(w, h)]), E("bottom", [pt(w, h), pt(0, h)], 1), E("fold", [pt(0, h), pt(0, 0)], 0, "fold")]
    : [E("top", [pt(0, 0), pt(w, 0)]), E("end", [pt(w, 0), pt(w, h)]), E("bottom", [pt(w, h), pt(0, h)]), E("start", [pt(0, h), pt(0, 0)])];
  return {
    id: opts.id,
    name: opts.name,
    edges,
    marks: [],
    cut: { count: opts.count ?? 1, mirror: opts.mirror ?? false, onFold: Boolean(opts.fold) },
    fabric: opts.fabric ?? "shell",
    grain: [pt(w * 0.3, h / 2), pt(w * 0.7, h / 2)],
  };
}

/**
 * Find a spot on a panel where a w x h patch pocket fits with 2 cm to spare. Searches down from `fromY` (measured from the top of the piece),
 * keeping to the side seam or to the centre line. Returns the top-left corner, or null when there is no room.
 */
export function placePatch(panel: Panel, w: number, h: number, fromY: number, prefer: "side" | "centre"): { x: number; y: number } | null {
  const poly = panelOutline(panel);
  const bb = bbox(poly);
  // Stay clear of anything already drawn there: another pocket, an opening.
  const taken = panel.marks.filter((m) => m.kind === "placement" || m.kind === "slit").map((m) => bbox(m.pts));
  const clear = (x: number, y: number) => taken.every((t) => x + w + 1.5 <= t.minX || x - 1.5 >= t.maxX || y + h + 1.5 <= t.minY || y - 1.5 >= t.maxY);
  const xs: number[] = [];
  if (prefer === "side") for (let x = bb.maxX - w - 2; x > bb.minX + 3; x -= 1) xs.push(x);
  else for (let x = bb.minX + 4; x < bb.maxX - w - 2; x += 1) xs.push(x);
  for (let y = bb.minY + fromY; y + h < bb.maxY - 8; y += 1) {
    for (const x of xs) {
      const corners: Pt[] = [pt(x, y), pt(x + w, y), pt(x + w, y + h), pt(x, y + h)];
      if (clear(x, y) && corners.every((c) => pointInPoly(c, poly) && distToPoly(c, poly) >= 2)) return { x, y };
    }
  }
  return null;
}

/**
 * A side seam from the underarm to the hem, taken in (inset > 0) or let out (inset < 0)
 * at the waist with a smooth taper. With no inset, or a waist outside the seam, it stays straight.
 */
export function shapedSide(top: Pt, bottom: Pt, waistY: number, inset: number): Pt[] {
  if (Math.abs(inset) < 0.05 || waistY <= top.y + 4 || waistY >= bottom.y - 4) return [top, bottom];
  const pts: Pt[] = [];
  const n = 16;
  for (let i = 0; i <= n; i++) {
    const y = top.y + ((bottom.y - top.y) * i) / n;
    const x = top.x + ((bottom.x - top.x) * (y - top.y)) / (bottom.y - top.y);
    const t = y <= waistY ? (y - top.y) / (waistY - top.y) : (bottom.y - y) / (bottom.y - waistY);
    pts.push(pt(x - inset * (0.5 - 0.5 * Math.cos(Math.PI * t)), y));
  }
  return pts;
}
