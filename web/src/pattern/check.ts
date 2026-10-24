import {
  bbox,
  dist,
  distToPoly,
  panelOutline,
  pointInPoly,
  polyLength,
  selfIntersects,
  signedArea,
} from "./geometry";
import { getEdge, getPanel, OpError, refLength } from "./ops";
import type { CheckResult, Garment, Issue, Ref } from "./types";

const refName = (g: Garment, r: Ref) => {
  const p = g.panels.find((x) => x.id === r.panel);
  return `${p?.name ?? r.panel} / ${"edge" in r ? r.edge : r.mark}`;
};

function sideLength(g: Garment, refs: Ref[]): number {
  return refs.reduce((s, r) => s + refLength(g, r), 0);
}

export function checkGarment(g: Garment): CheckResult {
  const issues: Issue[] = [];
  const err = (code: string, message: string, panel?: string) => issues.push({ severity: "error", code, message, panel });
  const warn = (code: string, message: string, panel?: string) => issues.push({ severity: "warn", code, message, panel });

  for (const panel of g.panels) {
    // 1. Edges chain and the outline closes.
    let chained = true;
    for (let i = 0; i < panel.edges.length; i++) {
      const a = panel.edges[i];
      const b = panel.edges[(i + 1) % panel.edges.length];
      if (dist(a.pts[a.pts.length - 1], b.pts[0]) > 0.05) {
        chained = false;
        err("open-outline", `${panel.name}: edge "${a.id}" does not meet edge "${b.id}", so the outline is not closed.`, panel.id);
        break;
      }
    }
    if (!chained) continue;

    const outline = panelOutline(panel);
    if (outline.length < 3 || Math.abs(signedArea(outline)) < 1) {
      err("empty-panel", `${panel.name}: the piece has no area.`, panel.id);
      continue;
    }
    if (selfIntersects(outline)) {
      err("self-intersection", `${panel.name}: the outline crosses itself.`, panel.id);
    }
    const bb = bbox(outline);
    if (bb.w < 2 || bb.h < 1) err("tiny-panel", `${panel.name}: the piece is only ${bb.w.toFixed(1)} x ${bb.h.toFixed(1)} cm.`, panel.id);

    // 2. Marks sit inside the piece.
    for (const m of panel.marks) {
      if (m.kind === "slit") {
        const len = polyLength(m.pts);
        if (len < 1.5) err("short-slit", `${panel.name}: opening "${m.id}" is only ${len.toFixed(1)} cm long.`, panel.id);
        for (const p of m.pts) {
          if (!pointInPoly(p, outline)) {
            err("slit-outside", `${panel.name}: opening "${m.id}" runs outside the piece.`, panel.id);
            break;
          }
          if (distToPoly(p, outline) < 1) {
            err("slit-near-edge", `${panel.name}: opening "${m.id}" is closer than 1 cm to the edge of the piece.`, panel.id);
            break;
          }
        }
      }
      if (m.kind === "placement") {
        if (!m.pts.every((p) => pointInPoly(p, outline))) {
          err("placement-outside", `${panel.name}: placement "${m.label ?? m.id}" does not fit on the piece.`, panel.id);
        }
      }
    }
    const slits = panel.marks.filter((m) => m.kind === "slit");
    for (let i = 0; i < slits.length; i++) {
      for (let j = i + 1; j < slits.length; j++) {
        const close = slits[i].pts.some((p) => slits[j].pts.some((q) => dist(p, q) < 2));
        if (close) warn("slits-close", `${panel.name}: openings "${slits[i].id}" and "${slits[j].id}" are very close together.`, panel.id);
      }
    }
    const placements = panel.marks.filter((m) => m.kind === "placement");
    for (let i = 0; i < placements.length; i++) {
      for (let j = i + 1; j < placements.length; j++) {
        const a = bbox(placements[i].pts);
        const b = bbox(placements[j].pts);
        const overlap = a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
        if (overlap && placements[i].label !== placements[j].label) {
          warn("placements-overlap", `${panel.name}: "${placements[i].label}" and "${placements[j].label}" overlap.`, panel.id);
        }
      }
    }
  }

  // 3. Every seam resolves and its two sides match.
  for (const seam of g.seams) {
    try {
      for (const r of [...seam.a, ...seam.b]) {
        const panel = getPanel(g, r.panel);
        if ("edge" in r) getEdge(panel, r.edge);
      }
    } catch (e) {
      if (e instanceof OpError) {
        err("bad-seam", `Seam "${seam.id}" points at something that no longer exists. ${e.message}`);
        continue;
      }
      throw e;
    }
    const la = sideLength(g, seam.a);
    const lb = sideLength(g, seam.b);
    const diff = lb - la;
    if (diff < seam.ease[0] - 1e-6 || diff > seam.ease[1] + 1e-6) {
      const names = `${seam.a.map((r) => refName(g, r)).join(" + ")}  <->  ${seam.b.map((r) => refName(g, r)).join(" + ")}`;
      const allowed = seam.ease[0] === -0.5 && seam.ease[1] === 0.5 ? "within 5 mm" : `a difference between ${seam.ease[0].toFixed(1)} and ${seam.ease[1].toFixed(1)} cm`;
      err(
        "seam-mismatch",
        `Seam "${seam.id}" (${names}): ${la.toFixed(1)} cm is sewn to ${lb.toFixed(1)} cm, but it must be ${allowed}.`,
      );
    }
    if (seam.kind === "zip" && la < 8) err("short-zip", `Zip opening "${seam.id}" is only ${la.toFixed(1)} cm.`);
  }

  return { ok: !issues.some((i) => i.severity === "error"), issues };
}
