import { bandPanel, E, fr, placePatch } from "./blocks";
import { cubic, polyLength, pt } from "./geometry";
import { applyOps, opSchema, type Op, type OpInput } from "./ops";
import type { Measurements, SkirtSpec } from "./spec";
import type { Edge, Garment, Mark, Panel, Pt, Seam } from "./types";

export interface SkirtDerived {
  /** Finished waist, hip and length, in cm. */
  waist: number;
  hip: number;
  length: number;
  /** How much longer the skirt's top edge is than the band it is sewn to. 1 means no gathers. */
  gatherRatio: number;
}

const HIP_EASE = { fitted: 4, regular: 8, boxy: 14 } as const;
/** Length from the waist at the side seam. */
const LENGTHS = { mini: 40, knee: 58, midi: 75, maxi: 95 } as const;
/** How much extra flare an a-line skirt has at the hem, as a fraction of the length below the hip. */
const FLARE = { fitted: 0.1, regular: 0.14, boxy: 0.2 } as const;
/** Total angle of a circle skirt. A fuller skirt uses more of the circle. */
const CIRCLE = { fitted: Math.PI, regular: 1.5 * Math.PI, boxy: 2 * Math.PI } as const;
const GATHER = { fitted: 1.5, regular: 1.8, boxy: 2.2 } as const;
const HEM = 3.5;
const ZIP_CM = 18;

/** Points on a circle of radius r around the origin, from angle a0 to a1, where angle 0 points straight down. */
const arc = (r: number, a0: number, a1: number, n = 24): Pt[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return pt(r * Math.sin(a), r * Math.cos(a));
  });

/**
 * A skirt from the waist down. Front and back are each cut on the fold, so they are halves; the waistband is two halves that
 * close the ring. Pencil and a-line skirts take in the waist with a side shift and darts, a circle skirt is cut on an arc,
 * and a gathered skirt is a rectangle pulled in to the band.
 */
export function buildSkirt(spec: SkirtSpec, m: Measurements): { garment: Garment; derived: SkirtDerived } {
  const elastic = spec.waist === "elastic";
  const L = LENGTHS[spec.length];
  const h = m.waistToHip ?? 20;
  const waistQ = (m.waist + 1.5) / 4; // quarter of the finished waist on a fitted band
  const Wh = Math.max((m.hip + HIP_EASE[spec.ease]) / 4, waistQ + 1); // quarter hip, never narrower than the waist

  let edges: { waist: Pt[]; side: Pt[]; hem: Pt[]; fold: Pt[] };
  let waistEdge: number; // length of the top edge of one panel
  let dart = 0;
  const marks: Mark[] = [];
  let hipFinished = Wh * 4;

  if (spec.silhouette === "pencil" || spec.silhouette === "a-line") {
    const D = Wh - (elastic ? Wh : waistQ);
    dart = D > 2.2 ? D * 0.55 : 0;
    const sideIn = D - dart;
    const xw = Wh - sideIn;
    waistEdge = xw;
    const hemX = spec.silhouette === "pencil" ? Wh - 2.5 : Wh + FLARE[spec.ease] * (L - h);
    const toHip = cubic(pt(xw, 0), pt(xw + (Wh - xw) * 0.15, h * 0.4), pt(Wh, h * 0.55), pt(Wh, h), 12);
    edges = {
      waist: [pt(0, 0), pt(xw, 0)],
      side: [...toHip, pt(hemX, L)],
      hem: [pt(hemX, L), pt(0, L)],
      fold: [pt(0, L), pt(0, 0)],
    };
  } else if (spec.silhouette === "circle") {
    const total = CIRCLE[spec.ease];
    const theta = total / 4;
    const waistCirc = elastic ? m.hip + 4 : m.waist + 1.5;
    // The skirt must still be wide enough at hip level for the hips to pass.
    const r0 = Math.max(waistCirc / total, (m.hip + 4) / total - h);
    waistEdge = r0 * theta;
    edges = {
      waist: arc(r0, 0, theta),
      side: [pt(r0 * Math.sin(theta), r0 * Math.cos(theta)), pt((r0 + L) * Math.sin(theta), (r0 + L) * Math.cos(theta))],
      hem: arc(r0 + L, theta, 0),
      fold: [pt(0, r0 + L), pt(0, r0)],
    };
    hipFinished = total * (r0 + h);
  } else {
    // Gathered: a rectangle, as wide as the fullness asks for and never narrower than the hips need.
    const base = elastic ? m.hip + 4 : m.waist + 1.5;
    const w = Math.max((GATHER[spec.ease] * base) / 4, (m.hip + 10) / 4);
    waistEdge = w;
    hipFinished = w * 4;
    edges = {
      waist: [pt(0, 0), pt(w, 0)],
      side: [pt(w, 0), pt(w, L)],
      hem: [pt(w, L), pt(0, L)],
      fold: [pt(0, L), pt(0, 0)],
    };
  }

  const makePanel = (id: string, name: string, dartLen: number): Panel => {
    const pEdges: Edge[] = [
      E("waist", edges.waist),
      E("side", edges.side, 1.5),
      E("hem", edges.hem, HEM),
      E(id === "front" ? "cf" : "cb", edges.fold, 0, "fold"),
    ];
    const pMarks: Mark[] = [...marks];
    if (dart > 0) {
      const xd = waistEdge * 0.5;
      pMarks.push({ id: "dart", kind: "line", pts: [pt(xd - dart / 2, 0), pt(xd, dartLen), pt(xd + dart / 2, 0)], label: "dart" });
    }
    return {
      id,
      name,
      edges: pEdges,
      marks: pMarks,
      cut: { count: 1, mirror: false, onFold: true },
      fabric: "shell",
      grain: [pt(waistEdge * 0.5, L * 0.4), pt(waistEdge * 0.5, L * 0.8)],
    };
  };
  const front = makePanel("front", "Front", 10);
  const back = makePanel("back", "Back", 13);

  // ----- waistband: two halves, sewn to the skirt top edge and to each other -----
  const gathered = spec.silhouette === "gathered";
  const topTotal = waistEdge * 2; // front and back top edges together, as one half band sees them
  const bandHalf = elastic ? (gathered ? (m.hip + 4) / 2 : topTotal) : (m.waist + 1.5) / 2;
  const bandH = elastic ? 5 : 4;
  const waistband = bandPanel({ id: "waistband", name: elastic ? "Elastic casing" : "Waistband", length: bandHalf, height: bandH, count: 2, mirror: true });
  const diff = bandHalf - topTotal;

  const seams: Seam[] = [
    { id: "side", a: [{ panel: "front", edge: "side" }], b: [{ panel: "back", edge: "side" }], ease: [-0.5, 0.5], kind: "sewn" },
    {
      id: "waistband.attach",
      a: [{ panel: "front", edge: "waist" }, { panel: "back", edge: "waist" }],
      b: [{ panel: "waistband", edge: "top" }],
      ease: [diff - 0.5, diff + 0.5],
      kind: "sewn",
    },
    // Two half bands make a ring: each end is sewn to the same end of the other half.
    { id: "waistband.ends", a: [{ panel: "waistband", edge: "start" }], b: [{ panel: "waistband", edge: "start" }], ease: [-0.5, 0.5], kind: "sewn" },
    { id: "waistband.ends2", a: [{ panel: "waistband", edge: "end" }], b: [{ panel: "waistband", edge: "end" }], ease: [-0.5, 0.5], kind: "sewn" },
  ];
  const garment: Garment = { panels: [front, back, waistband], seams, notions: [] };

  // ----- closure and pockets, built with the same operations a generated feature uses -----
  const ops: OpInput[] = [];
  if (!elastic) {
    const sideLen = polyLength(edges.side);
    ops.push({ op: "openSeam", seam: "side", from: 0, length: Math.min(0.6, ZIP_CM / sideLen) });
  }
  if (spec.pockets === "patch") {
    const spot = placePatch(front, 13, 15, dart > 0 ? 16 : 8, "side");
    if (spot) ops.push({ op: "addPiece", id: "pocket.patch", name: "Patch pocket", shape: "rect", width: 13, height: 15, place: { panel: "front", ...fr(front, spot.x, spot.y) }, count: 2 });
  }
  const res = applyOps(garment, ops.map((o): Op => opSchema.parse(o)));
  if (res.error) throw new Error(`Base skirt failed to build: ${res.error}`);
  const out = res.garment;
  // The seam record stands for both side seams, but only one of them gets the zip.
  const zip = out.notions.find((n) => n.name.startsWith("Zip"));
  if (zip) {
    zip.name = `Invisible zip, ${ZIP_CM} cm, left side seam`;
    zip.qty = 1;
  }
  if (elastic) out.notions.push({ name: `Elastic, 3 cm wide, ${Math.round(m.waist - 4)} cm`, qty: 1, unit: "pc" });
  else out.notions.push({ name: "Hook and bar for the waistband", qty: 1, unit: "set" });
  out.notions.push({ name: "Thread", qty: 1, unit: "spool" });

  return {
    garment: out,
    derived: { waist: elastic ? m.waist : m.waist + 1.5, hip: hipFinished, length: L, gatherRatio: Math.max(1, topTotal / bandHalf) },
  };
}
