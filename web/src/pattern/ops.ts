import { z } from "zod";
import {
  bbox,
  outwardNormal,
  panelOutline,
  pointAt,
  pointInPoly,
  polyLength,
  splitAt,
} from "./geometry";
import type { Edge, Fabric, Garment, Mark, Panel, Pt, Ref, Seam } from "./types";

export class OpError extends Error {}

const frac = z.number().min(0).max(1);

const attachSchema = z.union([
  z.object({ panel: z.string(), edge: z.string() }),
  z.object({ panel: z.string(), mark: z.string() }),
  z.object({ seam: z.string(), side: z.enum(["a", "b"]) }),
]);

export const opSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("openSeam"),
    seam: z.string(),
    /** Where the opening starts, as a fraction of the seam length from the start of its edge. */
    from: frac,
    /** Opening length as a fraction of the seam length. */
    length: frac,
  }),
  z.object({
    op: z.literal("addSlit"),
    panel: z.string(),
    /** Position as fractions of the panel's bounding box (0,0 is top-left). */
    at: z.object({ x: frac, y: frac }),
    length: z.number().min(1).max(40),
    angle: z.number().min(-90).max(90).default(0),
    id: z.string().optional(),
  }),
  z.object({
    op: z.literal("addPiece"),
    id: z.string(),
    name: z.string().optional(),
    shape: z.enum(["rect", "flap", "bag"]),
    /** Ignored when `attach` is given: the piece is as wide as the thing it attaches to. */
    width: z.number().min(2).max(60).optional(),
    height: z.number().min(1).max(60),
    attach: attachSchema.optional(),
    /** Draw a placement outline for this piece on a panel. */
    place: z.object({ panel: z.string(), x: frac, y: frac }).optional(),
    count: z.number().int().min(1).max(8).default(2),
    fabric: z.enum(["shell", "contrast", "lining"]).default("shell"),
  }),
  z.object({
    op: z.literal("addShape"),
    id: z.string(),
    name: z.string().optional(),
    /** The finished outline, drawn as named edges that chain end to start and return to the start. Centimetres, y points down. */
    edges: z
      .array(
        z.object({
          id: z.string(),
          pts: z.array(z.tuple([z.number().min(-300).max(300), z.number().min(-300).max(300)])).min(2).max(60),
          /** A fold line: the piece is cut on this edge. */
          fold: z.boolean().optional(),
        }),
      )
      .min(3)
      .max(12),
    /**
     * The one edge that is sewn to the existing coat. The whole piece is scaled so this edge is exactly as long as the edges it
     * is sewn to, so the model only needs to get the shape and rough size right.
     */
    join: z.object({ edge: z.string(), to: z.array(z.object({ panel: z.string(), edge: z.string() })).min(1).max(3) }).optional(),
    /** Edges sewn to their own mirror image (for example the centre seam of a two-piece hood). */
    mirrorSeams: z.array(z.string()).max(4).optional(),
    count: z.number().int().min(1).max(8).default(2),
    /** Cut half of the pieces as the mirror image (a left and a right). */
    mirror: z.boolean().default(false),
    fabric: z.enum(["shell", "contrast", "lining"]).default("shell"),
  }),
  z.object({
    op: z.literal("splitPanel"),
    panel: z.string(),
    /** "horizontal" cuts straight across (a yoke, a hem panel); "vertical" cuts straight down (a centre panel, a side panel). */
    axis: z.enum(["horizontal", "vertical"]),
    /** Where the cut sits, as a fraction of the piece's height (horizontal) or width (vertical), from the top or the left. */
    at: z.number().min(0.08).max(0.92),
    /** Fabric for the lower (horizontal) or right (vertical) piece. The other piece keeps the original fabric. */
    fabric: z.enum(["shell", "contrast", "lining"]).optional(),
  }),
  z.object({
    op: z.literal("addNotch"),
    panel: z.string(),
    edge: z.string(),
    at: frac,
    label: z.string().optional(),
  }),
  z.object({
    op: z.literal("offsetEdge"),
    panel: z.string(),
    edge: z.string(),
    /** Positive moves the edge outward (longer piece), negative inward. */
    amount: z.number().min(-15).max(15),
  }),
]);

export type Op = z.infer<typeof opSchema>;
export type OpInput = z.input<typeof opSchema>;

// ---------- helpers ----------

export function getPanel(g: Garment, id: string): Panel {
  const p = g.panels.find((x) => x.id === id);
  if (!p) throw new OpError(`Unknown panel "${id}". Panels are: ${g.panels.map((x) => x.id).join(", ")}.`);
  return p;
}

export function getEdge(panel: Panel, id: string): { edge: Edge; index: number } {
  const index = panel.edges.findIndex((e) => e.id === id);
  if (index < 0) throw new OpError(`Panel "${panel.id}" has no edge "${id}". Its edges are: ${panel.edges.map((e) => e.id).join(", ")}.`);
  return { edge: panel.edges[index], index };
}

export function refLength(g: Garment, ref: Ref): number {
  const panel = getPanel(g, ref.panel);
  if ("edge" in ref) return polyLength(getEdge(panel, ref.edge).edge.pts);
  const m = panel.marks.find((x) => x.id === ref.mark);
  if (!m) throw new OpError(`Panel "${panel.id}" has no mark "${ref.mark}".`);
  return polyLength(m.pts);
}

function refEq(a: Ref, b: Ref): boolean {
  if (a.panel !== b.panel) return false;
  if ("edge" in a && "edge" in b) return a.edge === b.edge;
  if ("mark" in a && "mark" in b) return a.mark === b.mark;
  return false;
}

function uniqueMarkId(panel: Panel, base: string): string {
  let id = base;
  let k = 2;
  while (panel.marks.some((m) => m.id === id)) id = `${base}.${k++}`;
  return id;
}

function addTick(panel: Panel, p: Pt, dir: Pt, label: string | undefined, baseId: string) {
  const n = outwardNormal(panel, dir);
  const mark: Mark = {
    id: uniqueMarkId(panel, baseId),
    kind: "notch",
    pts: [p, { x: p.x + n.x * 0.8, y: p.y + n.y * 0.8 }],
    label,
  };
  panel.marks.push(mark);
}

export function addNotchAt(panel: Panel, edgeId: string, at: number, label?: string) {
  const { edge } = getEdge(panel, edgeId);
  const len = polyLength(edge.pts);
  const { p, dir } = pointAt(edge.pts, Math.min(Math.max(at, 0), 1) * len);
  addTick(panel, p, dir, label, `notch.${edgeId}`);
}

interface Piece {
  id: string;
  start: number;
  end: number;
}

function splitEdge(g: Garment, panelId: string, edgeId: string, cuts: number[]): Piece[] {
  const panel = getPanel(g, panelId);
  const { edge, index } = getEdge(panel, edgeId);
  const len = polyLength(edge.pts);
  const ds = cuts.filter((d) => d > 0.05 && d < len - 0.05).sort((a, b) => a - b);
  if (ds.length === 0) return [{ id: edge.id, start: 0, end: len }];
  const bounds = [0, ...ds, len];
  const parts: Pt[][] = [];
  let rest = edge.pts;
  let consumed = 0;
  for (const d of ds) {
    const [a, b] = splitAt(rest, d - consumed);
    parts.push(a);
    rest = b;
    consumed = d;
  }
  parts.push(rest);
  const edges: Edge[] = parts.map((pts, i) => ({ ...edge, id: `${edge.id}.${i + 1}`, pts }));
  panel.edges.splice(index, 1, ...edges);
  const old: Ref = { panel: panelId, edge: edgeId };
  for (const seam of g.seams) {
    for (const side of ["a", "b"] as const) {
      const list = seam[side];
      const at = list.findIndex((r) => refEq(r, old));
      if (at >= 0) list.splice(at, 1, ...edges.map((e): Ref => ({ panel: panelId, edge: e.id })));
    }
  }
  return edges.map((e, i) => ({ id: e.id, start: bounds[i], end: bounds[i + 1] }));
}

function resolveAttach(g: Garment, a: z.infer<typeof attachSchema>): { ref: Ref; len: number } {
  if ("seam" in a) {
    const seam = g.seams.find((s) => s.id === a.seam);
    if (!seam) throw new OpError(`Unknown seam "${a.seam}". Seams are: ${g.seams.map((s) => s.id).join(", ")}.`);
    const side = seam[a.side];
    if (side.length !== 1) throw new OpError(`Seam "${a.seam}" side ${a.side} is not a single edge; attach to an edge instead.`);
    return { ref: side[0], len: refLength(g, side[0]) };
  }
  const ref: Ref = "edge" in a ? { panel: a.panel, edge: a.edge } : { panel: a.panel, mark: a.mark };
  return { ref, len: refLength(g, ref) };
}

function buildPieceEdges(shape: "rect" | "flap" | "bag", w: number, h: number): Edge[] {
  const e = (id: string, pts: Pt[]): Edge => ({ id, pts, allowance: 1 });
  const P = (x: number, y: number): Pt => ({ x, y });
  if (shape === "rect") {
    return [
      e("top", [P(0, 0), P(w, 0)]),
      e("right", [P(w, 0), P(w, h)]),
      e("bottom", [P(w, h), P(0, h)]),
      e("left", [P(0, h), P(0, 0)]),
    ];
  }
  if (shape === "flap") {
    const s = h * 0.75;
    return [
      e("top", [P(0, 0), P(w, 0)]),
      e("right", [P(w, 0), P(w, s)]),
      e("bottom.r", [P(w, s), P(w / 2, h)]),
      e("bottom.l", [P(w / 2, h), P(0, s)]),
      e("left", [P(0, s), P(0, 0)]),
    ];
  }
  const r = Math.min(3, w / 4, h / 3);
  const arc = (cx: number, cy: number, from: number, to: number) => {
    const out: Pt[] = [];
    for (let i = 0; i <= 6; i++) {
      const t = from + ((to - from) * i) / 6;
      out.push(P(cx + r * Math.cos(t), cy + r * Math.sin(t)));
    }
    return out;
  };
  const bottom = [...arc(w - r, h - r, 0, Math.PI / 2), ...arc(r, h - r, Math.PI / 2, Math.PI)];
  return [
    e("top", [P(0, 0), P(w, 0)]),
    e("right", [P(w, 0), P(w, h - r)]),
    e("bottom", bottom),
    e("left", [P(0, h - r), P(0, 0)]),
  ];
}

/** How far apart two edge ends may be and still be snapped together. Anything wider is a drawing mistake the model should fix. */
const SNAP_CM = 2;
/** How far from the target length the joining edge may be drawn. Beyond this the shape is wrong, not just slightly off. */
const FIT_RANGE: [number, number] = [0.6, 1.6];

/**
 * Smooth a hand-drawn polyline: a centripetal Catmull-Rom spline that passes through every point the model gave,
 * so a curve drawn with 5 points looks like a curve, not a row of straight lines. The two end points do not move,
 * so edges still meet where the model said they do.
 */
export function smoothPolyline(pts: Pt[], perSegment = 6): Pt[] {
  if (pts.length < 3) return pts;
  const knot = (a: Pt, b: Pt) => Math.max(Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y)), 1e-6);
  const out: Pt[] = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    // Extend the ends by reflection so the first and last segments curve naturally.
    const p0 = pts[i - 1] ?? { x: 2 * pts[0].x - pts[1].x, y: 2 * pts[0].y - pts[1].y };
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const last = pts[pts.length - 1];
    const prev = pts[pts.length - 2];
    const p3 = pts[i + 2] ?? { x: 2 * last.x - prev.x, y: 2 * last.y - prev.y };
    const t0 = 0;
    const t1 = t0 + knot(p0, p1);
    const t2 = t1 + knot(p1, p2);
    const t3 = t2 + knot(p2, p3);
    const lerp = (a: Pt, b: Pt, ta: number, tb: number, t: number): Pt => {
      const w = (t - ta) / (tb - ta);
      return { x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w };
    };
    for (let s = 1; s <= perSegment; s++) {
      if (s === perSegment) {
        out.push(p2);
        continue;
      }
      const t = t1 + ((t2 - t1) * s) / perSegment;
      const a1 = lerp(p0, p1, t0, t1, t);
      const a2 = lerp(p1, p2, t1, t2, t);
      const a3 = lerp(p2, p3, t2, t3, t);
      const b1 = lerp(a1, a2, t0, t2, t);
      const b2 = lerp(a2, a3, t1, t3, t);
      out.push(lerp(b1, b2, t1, t2, t));
    }
  }
  return out;
}

/**
 * Add a freely drawn piece. Code does the exact work the model is bad at: it snaps the outline closed and scales the piece
 * so its joining edge matches the coat's edge to the millimetre. The model only has to get the shape right.
 */
function addShape(g: Garment, op: Extract<Op, { op: "addShape" }>) {
  if (g.panels.some((p) => p.id === op.id)) throw new OpError(`A piece called "${op.id}" already exists.`);
  const ids = op.edges.map((e) => e.id);
  const dupe = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dupe) throw new OpError(`Edge id "${dupe}" is used twice. Give every edge its own id.`);

  let edges: Edge[] = op.edges.map((e) => ({
    id: e.id,
    // A fold line is straight by definition; every other multi-point edge is smoothed.
    pts: e.fold ? e.pts.map(([x, y]): Pt => ({ x, y })) : smoothPolyline(e.pts.map(([x, y]): Pt => ({ x, y }))),
    allowance: e.fold ? 0 : 1,
    ...(e.fold ? { kind: "fold" as const } : {}),
  }));

  // The outline must close. Small gaps are rounding in the drawing, so snap them; big gaps are a mistake to report.
  for (let i = 0; i < edges.length; i++) {
    const a = edges[i];
    const b = edges[(i + 1) % edges.length];
    const end = a.pts[a.pts.length - 1];
    const gap = Math.hypot(end.x - b.pts[0].x, end.y - b.pts[0].y);
    if (gap > SNAP_CM) {
      throw new OpError(
        `Edge "${a.id}" ends at (${end.x.toFixed(1)}, ${end.y.toFixed(1)}) but the next edge "${b.id}" starts at (${b.pts[0].x.toFixed(1)}, ${b.pts[0].y.toFixed(1)}), ${gap.toFixed(1)} cm apart. Edges must chain end to start, and the last edge must end where the first starts.`,
      );
    }
    b.pts[0] = { ...end };
  }

  const seams: Seam[] = [];
  if (op.join) {
    const joinEdge = edges.find((e) => e.id === op.join!.edge);
    if (!joinEdge) throw new OpError(`The join edge "${op.join.edge}" is not one of the new piece's edges (${ids.join(", ")}).`);
    const refs: Ref[] = op.join.to.map((r) => ({ panel: r.panel, edge: r.edge }));
    const target = refs.reduce((s, r) => s + refLength(g, r), 0);
    const drawn = polyLength(joinEdge.pts);
    if (drawn < 1) throw new OpError(`The join edge "${joinEdge.id}" is almost zero length. Draw it as a real edge of the piece.`);
    const k = target / drawn;
    if (k < FIT_RANGE[0] || k > FIT_RANGE[1]) {
      throw new OpError(
        `The join edge "${joinEdge.id}" is ${drawn.toFixed(1)} cm long but it is sewn to ${target.toFixed(1)} cm of the coat. Redraw the whole piece so that edge is about ${target.toFixed(0)} cm.`,
      );
    }
    // Scale the whole piece about the start of the join edge so the join edge is exactly the right length.
    const o = joinEdge.pts[0];
    edges = edges.map((e) => ({ ...e, pts: e.pts.map((p) => ({ x: o.x + (p.x - o.x) * k, y: o.y + (p.y - o.y) * k })) }));
    seams.push({ id: `${op.id}.join`, a: refs, b: [{ panel: op.id, edge: joinEdge.id }], ease: [-0.5, 0.5], kind: "sewn" });
  }
  for (const edgeId of op.mirrorSeams ?? []) {
    if (!ids.includes(edgeId)) throw new OpError(`mirrorSeams names "${edgeId}", which is not one of the new piece's edges (${ids.join(", ")}).`);
    seams.push({ id: `${op.id}.${edgeId}`, a: [{ panel: op.id, edge: edgeId }], b: [{ panel: op.id, edge: edgeId }], ease: [-0.5, 0.5], kind: "sewn" });
  }

  const panel: Panel = {
    id: op.id,
    name: op.name ?? op.id,
    edges,
    marks: [],
    cut: { count: op.count, mirror: op.mirror, onFold: edges.some((e) => e.kind === "fold") },
    fabric: op.fabric as Fabric,
    grain: [],
  };
  // Off-centre, so the printed label does not sit on top of the arrow.
  const bb = bbox(panelOutline(panel));
  panel.grain = [{ x: bb.minX + bb.w * 0.62, y: bb.minY + bb.h * 0.3 }, { x: bb.minX + bb.w * 0.62, y: bb.minY + bb.h * 0.7 }];
  g.panels.push(panel);
  g.seams.push(...seams);
}

/**
 * Cut a piece in two along a straight horizontal or vertical line and sew the halves back together with a new seam.
 * The edges the line crosses are split in two, and every seam that used them is updated to name the new halves.
 */
function splitPanel(g: Garment, op: Extract<Op, { op: "splitPanel" }>) {
  const panel = getPanel(g, op.panel);
  const bb = bbox(panelOutline(panel));
  const horizontal = op.axis === "horizontal";
  const along = (p: Pt) => (horizontal ? p.y : p.x);
  // A cut that passes exactly through a corner would be counted twice; nudge it a hair.
  let c = (horizontal ? bb.minY : bb.minX) + op.at * (horizontal ? bb.h : bb.w);
  if (panel.edges.some((e) => e.pts.some((p) => Math.abs(along(p) - c) < 1e-6))) c += 0.0137;

  type Sub = { edge: Edge; side: 1 | -1; from: string; part: number; parts: number };
  const subs: Sub[] = [];
  let crossings = 0;
  for (const edge of panel.edges) {
    const pieces: Pt[][] = [[edge.pts[0]]];
    for (let i = 1; i < edge.pts.length; i++) {
      const a = edge.pts[i - 1];
      const b = edge.pts[i];
      if ((along(a) - c) * (along(b) - c) < 0) {
        crossings++;
        const t = (c - along(a)) / (along(b) - along(a));
        const p: Pt = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        pieces[pieces.length - 1].push(p);
        pieces.push([p, b]);
      } else {
        pieces[pieces.length - 1].push(b);
      }
    }
    pieces.forEach((pts, k) => {
      const mid = pts[Math.floor(pts.length / 2)];
      const midSide = along(pts.length > 2 ? mid : { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 }) < c ? -1 : 1;
      subs.push({ edge: { ...edge, id: pieces.length === 1 ? edge.id : `${edge.id}.${k + 1}`, pts }, side: midSide, from: edge.id, part: k, parts: pieces.length });
    });
  }
  const dir = horizontal ? "across" : "down";
  if (crossings !== 2) {
    throw new OpError(
      `A cut ${dir} "${panel.id}" at ${op.at} crosses the outline ${crossings} times, but it must cross exactly twice to make two pieces. Try a different position.`,
    );
  }

  // Walk the outline from the start of a run, so each side is one unbroken run of edges.
  let start = subs.findIndex((s, i) => s.side !== subs[(i - 1 + subs.length) % subs.length].side);
  if (start < 0) start = 0;
  const walk = [...subs.slice(start), ...subs.slice(0, start)];
  const firstSide = walk[0].side;
  const run1 = walk.filter((_, i) => walk.slice(0, i + 1).every((s) => s.side === firstSide));
  const run2 = walk.slice(run1.length);
  if (run2.length === 0 || run2.some((s) => s.side === firstSide)) throw new OpError(`The cut ${dir} "${panel.id}" does not split the piece cleanly. Try a different position.`);

  const closing = (run: Sub[]): Edge => {
    const a = run[run.length - 1].edge.pts[run[run.length - 1].edge.pts.length - 1];
    const b = run[0].edge.pts[0];
    return { id: "split", pts: [{ ...a }, { ...b }], allowance: 1 };
  };
  const makePiece = (id: string, name: string, run: Sub[], fabric: Fabric): Panel => ({
    id,
    name,
    edges: [...run.map((s) => ({ ...s.edge, pts: s.edge.pts.map((p) => ({ ...p })) })), closing(run)],
    marks: [],
    cut: { count: panel.cut.count, mirror: panel.cut.mirror, onFold: run.some((s) => s.edge.kind === "fold") },
    fabric,
    grain: [],
  });
  const upperRun = run1[0].side === -1 ? run1 : run2;
  const lowerRun = run1[0].side === -1 ? run2 : run1;
  const [nameA, nameB, idA, idB] = horizontal ? ["upper", "lower", `${panel.id}.upper`, `${panel.id}.lower`] : ["left", "right", `${panel.id}.left`, `${panel.id}.right`];
  if (g.panels.some((p) => p.id === idA || p.id === idB)) throw new OpError(`"${panel.id}" has already been split.`);
  const A = makePiece(idA, `${panel.name} (${nameA})`, upperRun, panel.fabric);
  const B = makePiece(idB, `${panel.name} (${nameB})`, lowerRun, (op.fabric ?? panel.fabric) as Fabric);

  // The two new closing edges are the same line, so they are the seam between the pieces.
  const near = (m: Mark) => (m.pts.every((p) => along(p) < c) ? A : m.pts.every((p) => along(p) >= c) ? B : null);
  for (const m of panel.marks) {
    const owner = near(m);
    if (owner) {
      owner.marks.push(m);
      continue;
    }
    if (m.kind !== "line") throw new OpError(`The cut would run through "${m.label ?? m.id}" on the ${panel.name}. Choose a position that avoids it.`);
    // A drawn line (a fold line, a button line) is simply cut where the new seam is.
    for (const [owner2, keep] of [[A, (p: Pt) => along(p) < c], [B, (p: Pt) => along(p) >= c]] as const) {
      const pts: Pt[] = [];
      for (let i = 0; i < m.pts.length; i++) {
        const p = m.pts[i];
        const q = m.pts[i - 1];
        if (q && keep(p) !== keep(q)) {
          const t = (c - along(q)) / (along(p) - along(q));
          pts.push({ x: q.x + (p.x - q.x) * t, y: q.y + (p.y - q.y) * t });
        }
        if (keep(p)) pts.push(p);
      }
      if (pts.length >= 2) owner2.marks.push({ ...m, pts });
    }
  }
  for (const piece of [A, B]) {
    const outline = panelOutline(piece);
    const pb = bbox(outline);
    const [g0, g1] = panel.grain;
    piece.grain =
      g0 && g1 && pointInPoly(g0, outline) && pointInPoly(g1, outline)
        ? panel.grain
        : [{ x: pb.minX + pb.w * 0.55, y: pb.minY + pb.h * 0.3 }, { x: pb.minX + pb.w * 0.55, y: pb.minY + pb.h * 0.7 }];
  }

  // Seams that used the old piece now point at whichever new piece holds that edge or mark.
  const edgeHome = new Map<string, Ref[]>();
  for (const s of subs) {
    const home = upperRun.includes(s) ? idA : idB;
    const list = edgeHome.get(s.from) ?? [];
    list.push({ panel: home, edge: s.edge.id });
    edgeHome.set(s.from, list);
  }
  const markHome = (id: string): string => (A.marks.some((m) => m.id === id) ? idA : idB);
  for (const seam of g.seams) {
    for (const side of ["a", "b"] as const) {
      seam[side] = seam[side].flatMap((r): Ref[] => {
        if (r.panel !== panel.id) return [r];
        if ("edge" in r) return edgeHome.get(r.edge) ?? [r];
        return [{ panel: markHome(r.mark), mark: r.mark }];
      });
    }
  }
  g.seams.push({ id: `${panel.id}.split`, a: [{ panel: idA, edge: "split" }], b: [{ panel: idB, edge: "split" }], ease: [-0.5, 0.5], kind: "sewn" });
  addNotchAt(A, "split", 0.5);
  addNotchAt(B, "split", 0.5);

  const at = g.panels.indexOf(panel);
  g.panels.splice(at, 1, A, B);
}

// ---------- apply ----------

function applyOne(g: Garment, op: Op) {
  switch (op.op) {
    case "openSeam": {
      const seam = g.seams.find((s) => s.id === op.seam);
      if (!seam) throw new OpError(`Unknown seam "${op.seam}". Seams are: ${g.seams.map((s) => s.id).join(", ")}.`);
      if (seam.kind !== "sewn") throw new OpError(`Seam "${seam.id}" is already an opening.`);
      if (seam.a.length !== 1 || seam.b.length !== 1) {
        throw new OpError(`openSeam needs a seam with one edge on each side, but "${seam.id}" has ${seam.a.length} and ${seam.b.length}.`);
      }
      const ra = seam.a[0];
      const rb = seam.b[0];
      if (!("edge" in ra) || !("edge" in rb)) throw new OpError(`Seam "${seam.id}" cannot be opened.`);
      const lenA = refLength(g, ra);
      const lenB = refLength(g, rb);
      const d1 = op.from * lenA;
      const d2 = (op.from + op.length) * lenA;
      if (op.from + op.length > 1.0001) throw new OpError("from + length must not go past the end of the seam.");
      if (d2 - d1 < 8) throw new OpError(`An opening of ${(d2 - d1).toFixed(1)} cm is too short for a zip; use at least 8 cm.`);
      if (d2 > lenB + 0.05) throw new OpError(`The other side of seam "${seam.id}" is only ${lenB.toFixed(1)} cm long.`);
      const piecesA = splitEdge(g, ra.panel, ra.edge, [d1, d2]);
      const piecesB = splitEdge(g, rb.panel, rb.edge, [d1, d2]);
      const inside = (p: Piece) => Math.abs(p.start - d1) < 0.1 && Math.abs(p.end - d2) < 0.1;
      const openA = piecesA.find(inside);
      const openB = piecesB.find(inside);
      if (!openA || !openB) throw new OpError("Could not isolate the opening on both sides of the seam.");
      seam.a = piecesA.filter((p) => p !== openA).map((p): Ref => ({ panel: ra.panel, edge: p.id }));
      seam.b = piecesB.filter((p) => p !== openB).map((p): Ref => ({ panel: rb.panel, edge: p.id }));
      g.seams.push({
        id: `${seam.id}.zip`,
        a: [{ panel: ra.panel, edge: openA.id }],
        b: [{ panel: rb.panel, edge: openB.id }],
        ease: [-0.5, 0.5],
        kind: "zip",
      });
      if (seam.a.length === 0 || seam.b.length === 0) g.seams = g.seams.filter((s) => s !== seam);
      // zip stops: a notch at each end of the opening that is not the end of the seam itself
      for (const [pid, open, total] of [
        [ra.panel, openA, lenA],
        [rb.panel, openB, lenB],
      ] as const) {
        const panel = getPanel(g, pid);
        if (open.start > 0.1) addNotchAt(panel, open.id, 0, "zip stop");
        if (open.end < total - 0.1) addNotchAt(panel, open.id, 1, "zip stop");
      }
      g.notions.push({ name: `Zip, ${Math.round(d2 - d1)} cm, side opening (both sides)`, qty: 2, unit: "pcs" });
      return;
    }
    case "addSlit": {
      const panel = getPanel(g, op.panel);
      const bb = bbox(panelOutline(panel));
      const cx = bb.minX + op.at.x * bb.w;
      const cy = bb.minY + op.at.y * bb.h;
      const a = (op.angle * Math.PI) / 180;
      const hx = (Math.cos(a) * op.length) / 2;
      const hy = (Math.sin(a) * op.length) / 2;
      const id = op.id ?? uniqueMarkId(panel, "slit");
      if (panel.marks.some((m) => m.id === id)) throw new OpError(`Panel "${panel.id}" already has a mark "${id}".`);
      panel.marks.push({ id, kind: "slit", pts: [{ x: cx - hx, y: cy - hy }, { x: cx + hx, y: cy + hy }], label: "opening" });
      return;
    }
    case "addPiece": {
      if (g.panels.some((p) => p.id === op.id)) throw new OpError(`A piece called "${op.id}" already exists.`);
      let width = op.width;
      let attachRef: Ref | undefined;
      if (op.attach) {
        const r = resolveAttach(g, op.attach);
        attachRef = r.ref;
        width = r.len;
      }
      if (width === undefined) throw new OpError("addPiece needs a width when it is not attached to anything.");
      if (width < 2 || width > 60) throw new OpError(`The piece would be ${width.toFixed(1)} cm wide; it must be between 2 and 60 cm.`);
      const edges = buildPieceEdges(op.shape, width, op.height);
      const panel: Panel = {
        id: op.id,
        name: op.name ?? op.id,
        edges,
        marks: [],
        cut: { count: op.count, mirror: false, onFold: false },
        fabric: op.fabric as Fabric,
        // Off-centre so the printed label does not sit on top of the arrow.
        grain: [{ x: width * 0.8, y: op.height * 0.22 }, { x: width * 0.8, y: op.height * 0.78 }],
      };
      g.panels.push(panel);
      if (attachRef) {
        g.seams.push({
          id: `${op.id}.attach`,
          a: [attachRef],
          b: [{ panel: op.id, edge: "top" }],
          ease: [-0.5, 0.5],
          kind: "sewn",
        });
      }
      if (op.place) {
        const target = getPanel(g, op.place.panel);
        const bb = bbox(panelOutline(target));
        const x0 = bb.minX + op.place.x * bb.w;
        const y0 = bb.minY + op.place.y * bb.h;
        target.marks.push({
          id: uniqueMarkId(target, `place.${op.id}`),
          kind: "placement",
          pts: [
            { x: x0, y: y0 },
            { x: x0 + width, y: y0 },
            { x: x0 + width, y: y0 + op.height },
            { x: x0, y: y0 + op.height },
            { x: x0, y: y0 },
          ],
          label: panel.name,
        });
      }
      return;
    }
    case "addShape": {
      addShape(g, op);
      return;
    }
    case "splitPanel": {
      splitPanel(g, op);
      return;
    }
    case "addNotch": {
      addNotchAt(getPanel(g, op.panel), op.edge, op.at, op.label);
      return;
    }
    case "offsetEdge": {
      const panel = getPanel(g, op.panel);
      const { edge, index } = getEdge(panel, op.edge);
      if (edge.kind === "fold") throw new OpError(`Edge "${edge.id}" is a fold line and cannot be moved.`);
      const first = edge.pts[0];
      const last = edge.pts[edge.pts.length - 1];
      const l = Math.hypot(last.x - first.x, last.y - first.y);
      if (l < 0.1) throw new OpError(`Edge "${edge.id}" is too short to move.`);
      const n = outwardNormal(panel, { x: (last.x - first.x) / l, y: (last.y - first.y) / l });
      edge.pts = edge.pts.map((p) => ({ x: p.x + n.x * op.amount, y: p.y + n.y * op.amount }));
      const prev = panel.edges[(index - 1 + panel.edges.length) % panel.edges.length];
      const next = panel.edges[(index + 1) % panel.edges.length];
      prev.pts[prev.pts.length - 1] = { ...edge.pts[0] };
      next.pts[0] = { ...edge.pts[edge.pts.length - 1] };
      return;
    }
  }
}

export interface ApplyResult {
  garment: Garment;
  /** Set when an operation could not be applied. The garment is the state before that operation. */
  error?: string;
  applied: number;
}

export function applyOps(base: Garment, ops: Op[]): ApplyResult {
  const g = structuredClone(base);
  let applied = 0;
  for (const op of ops) {
    const snapshot = structuredClone(g);
    try {
      applyOne(g, op);
      applied++;
    } catch (e) {
      if (e instanceof OpError) {
        return { garment: snapshot, error: `Operation ${applied + 1} (${op.op}) failed: ${e.message}`, applied };
      }
      throw e;
    }
  }
  return { garment: g, applied };
}
