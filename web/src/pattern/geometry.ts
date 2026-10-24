import type { Edge, Panel, Pt } from "./types";

export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

export function polyLength(p: Pt[]): number {
  let s = 0;
  for (let i = 1; i < p.length; i++) s += dist(p[i - 1], p[i]);
  return s;
}

export function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, n = 24): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    });
  }
  return out;
}

export const pt = (x: number, y: number): Pt => ({ x, y });

/** Point at distance d along a polyline, with the unit direction there. */
export function pointAt(pts: Pt[], d: number): { p: Pt; dir: Pt } {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = dist(pts[i - 1], pts[i]);
    if (acc + seg >= d || i === pts.length - 1) {
      const t = seg === 0 ? 0 : Math.min(1, Math.max(0, (d - acc) / seg));
      const a = pts[i - 1];
      const b = pts[i];
      const dir = seg === 0 ? { x: 1, y: 0 } : { x: (b.x - a.x) / seg, y: (b.y - a.y) / seg };
      return { p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, dir };
    }
    acc += seg;
  }
  return { p: pts[0], dir: { x: 1, y: 0 } };
}

/** Split a polyline at distance d. Both halves include the split point. */
export function splitAt(pts: Pt[], d: number): [Pt[], Pt[]] {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = dist(pts[i - 1], pts[i]);
    if (acc + seg >= d - 1e-9) {
      const t = seg === 0 ? 0 : (d - acc) / seg;
      const a = pts[i - 1];
      const b = pts[i];
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      return [[...pts.slice(0, i), p], [p, ...pts.slice(i)]];
    }
    acc += seg;
  }
  const last = pts[pts.length - 1];
  return [pts.slice(), [last, last]];
}

export function signedArea(poly: Pt[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export function pointInPoly(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function cross(o: Pt, a: Pt, b: Pt) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function segsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const d1 = cross(a, b, c);
  const d2 = cross(a, b, d);
  const d3 = cross(c, d, a);
  const d4 = cross(c, d, b);
  return d1 * d2 < -1e-9 && d3 * d4 < -1e-9;
}

export function selfIntersects(poly: Pt[]): boolean {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segsCross(a, b, poly[j], poly[(j + 1) % n])) return true;
    }
  }
  return false;
}

export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function distToPoly(p: Pt, poly: Pt[]): number {
  let m = Infinity;
  for (let i = 0; i < poly.length; i++) m = Math.min(m, distToSegment(p, poly[i], poly[(i + 1) % poly.length]));
  return m;
}

export function bbox(pts: Pt[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

/** Outline points of a panel (edges chained, no duplicated joints, not repeating the first point). */
export function panelOutline(panel: Panel): Pt[] {
  const out: Pt[] = [];
  panel.edges.forEach((e, i) => {
    e.pts.forEach((p, j) => {
      if (i > 0 && j === 0) return;
      out.push(p);
    });
  });
  const first = out[0];
  const last = out[out.length - 1];
  if (out.length > 1 && dist(first, last) < 0.05) out.pop();
  return out;
}

/** +1 or -1 so that sign * (dy, -dx) is the outward normal of a segment direction (dx, dy). */
export function outwardSign(panel: Panel): number {
  return signedArea(panelOutline(panel)) >= 0 ? 1 : -1;
}

export function outwardNormal(panel: Panel, dir: Pt): Pt {
  const s = outwardSign(panel);
  return { x: s * dir.y, y: -s * dir.x };
}

/** Outline offset outward by each edge's own allowance, using mitred corners. */
export function cutOutline(panel: Panel): Pt[] {
  const pts: Pt[] = [];
  const allow: number[] = []; // allowance of the segment starting at pts[i]
  panel.edges.forEach((e, i) => {
    for (let j = 0; j < e.pts.length - 1; j++) {
      pts.push(e.pts[j]);
      allow.push(e.allowance);
    }
    if (i === panel.edges.length - 1) {
      // closing point equals first point of the outline; skip it
    }
  });
  const n = pts.length;
  const s = outwardSign(panel);
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const cur = pts[i];
    const next = pts[(i + 1) % n];
    const a1 = allow[(i - 1 + n) % n];
    const a2 = allow[i];
    const d1 = norm({ x: cur.x - prev.x, y: cur.y - prev.y });
    const d2 = norm({ x: next.x - cur.x, y: next.y - cur.y });
    const n1 = { x: s * d1.y, y: -s * d1.x };
    const n2 = { x: s * d2.y, y: -s * d2.x };
    const det = n1.x * n2.y - n1.y * n2.x;
    let q: Pt;
    if (Math.abs(det) < 1e-4) {
      q = { x: (n1.x * a1 + n2.x * a2) / 2, y: (n1.y * a1 + n2.y * a2) / 2 };
    } else {
      q = {
        x: (a1 * n2.y - a2 * n1.y) / det,
        y: (n1.x * a2 - n2.x * a1) / det,
      };
      const limit = 3 * Math.max(a1, a2, 0.01);
      const len = Math.hypot(q.x, q.y);
      if (len > limit) q = { x: (q.x / len) * limit, y: (q.y / len) * limit };
    }
    out.push({ x: cur.x + q.x, y: cur.y + q.y });
  }
  return out;
}

function norm(v: Pt): Pt {
  const l = Math.hypot(v.x, v.y);
  return l === 0 ? { x: 1, y: 0 } : { x: v.x / l, y: v.y / l };
}

export const edgeLength = (e: Edge) => polyLength(e.pts);

export function translate(pts: Pt[], dx: number, dy: number): Pt[] {
  return pts.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}
