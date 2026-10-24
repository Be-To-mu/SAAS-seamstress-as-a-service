import { bbox, cutOutline, panelOutline, polyLength, signedArea } from "./geometry";
import type { Fabric, Garment, Panel, Pt } from "./types";

export interface Placed {
  panel: Panel;
  /** Translation applied to every point of the panel to place it on the sheet. */
  dx: number;
  dy: number;
  /** Outline and cut line already translated onto the sheet. */
  sew: Pt[];
  cut: Pt[];
  box: { minX: number; minY: number; maxX: number; maxY: number; w: number; h: number };
}

export interface Layout {
  placed: Placed[];
  width: number;
  height: number;
}

const GAP = 4;

/** Shelf-pack all pieces onto a sheet of the given width (cm). `gap` is the space between pieces and around the edge. */
export function layoutGarment(g: Garment, sheetWidth = 190, GAP_CM = GAP): Layout {
  const GAP = GAP_CM;
  const items = g.panels.map((panel) => {
    const cut = cutOutline(panel);
    const bb = bbox([...cut, ...panelOutline(panel)]);
    return { panel, cut, bb };
  });
  items.sort((a, b) => b.bb.h - a.bb.h);

  const placed: Placed[] = [];
  let x = GAP;
  let y = GAP;
  let rowH = 0;
  for (const it of items) {
    if (x + it.bb.w + GAP > sheetWidth && x > GAP) {
      x = GAP;
      y += rowH + GAP + 6;
      rowH = 0;
    }
    const dx = x - it.bb.minX;
    const dy = y - it.bb.minY;
    const move = (p: Pt): Pt => ({ x: p.x + dx, y: p.y + dy });
    const sew = panelOutline(it.panel).map(move);
    const cut = it.cut.map(move);
    placed.push({
      panel: it.panel,
      dx,
      dy,
      sew,
      cut,
      box: { minX: x, minY: y, maxX: x + it.bb.w, maxY: y + it.bb.h, w: it.bb.w, h: it.bb.h },
    });
    x += it.bb.w + GAP;
    rowH = Math.max(rowH, it.bb.h);
  }
  return { placed, width: sheetWidth, height: y + rowH + GAP + 8 };
}

export interface FabricEstimate {
  fabric: Fabric;
  /** Estimated metres of 150 cm wide cloth, including 30% for layout waste. */
  metres: number;
}

export function estimateFabric(g: Garment, clothWidth = 150): FabricEstimate[] {
  const area: Partial<Record<Fabric, number>> = {};
  for (const p of g.panels) {
    const a = Math.abs(signedArea(cutOutline(p)));
    const full = p.cut.onFold ? a * 2 : a;
    area[p.fabric] = (area[p.fabric] ?? 0) + full * p.cut.count;
  }
  return (Object.keys(area) as Fabric[]).map((fabric) => ({
    fabric,
    metres: Math.ceil((area[fabric]! / (clothWidth * 0.7)) / 5) * 0.05,
  }));
}

/** Plain-language description of the garment for a language model. */
export function describeGarment(g: Garment): string {
  const lines: string[] = [];
  lines.push("PANELS (all lengths in cm; y increases downward):");
  for (const p of g.panels) {
    const bb = bbox(panelOutline(p));
    lines.push(
      `- ${p.id} "${p.name}": ${bb.w.toFixed(1)} wide x ${bb.h.toFixed(1)} tall, cut ${p.cut.count}${p.cut.onFold ? " on fold" : ""}.`,
    );
    for (const e of p.edges) {
      const a = e.pts[0];
      const b = e.pts[e.pts.length - 1];
      lines.push(
        `    edge ${e.id}: ${polyLength(e.pts).toFixed(1)} cm, starts (${(a.x - bb.minX).toFixed(0)},${(a.y - bb.minY).toFixed(0)}) ends (${(b.x - bb.minX).toFixed(0)},${(b.y - bb.minY).toFixed(0)}) from the panel's top-left${e.kind === "fold" ? " [fold line]" : ""}`,
      );
    }
    for (const m of p.marks.filter((x) => x.kind === "slit" || x.kind === "placement")) {
      lines.push(`    mark ${m.id} (${m.kind}${m.label ? `: ${m.label}` : ""}): ${polyLength(m.pts).toFixed(1)} cm`);
    }
  }
  lines.push("", "SEAMS (side a is sewn to side b):");
  for (const s of g.seams) {
    const name = (r: (typeof s.a)[number]) => `${r.panel}.${"edge" in r ? r.edge : r.mark}`;
    lines.push(`- ${s.id} [${s.kind}]: ${s.a.map(name).join(" + ")}  <->  ${s.b.map(name).join(" + ")}`);
  }
  return lines.join("\n");
}
