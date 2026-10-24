import { jsPDF } from "jspdf";
import type { Composed } from "@/pattern/compose";
import { estimateFabric, layoutGarment, type Placed } from "@/pattern/layout";
import type { Measurements, Spec } from "@/pattern/spec";
import type { Pt } from "@/pattern/types";

const MARGIN = 8; // mm
const A4_W = 210;
const A4_H = 297;
const USABLE_W = A4_W - 2 * MARGIN;
const USABLE_H = A4_H - 2 * MARGIN;
const OVERLAP = 10; // mm shared between neighbouring sheets
const STEP_X = USABLE_W - OVERLAP;
const STEP_Y = USABLE_H - OVERLAP;
const SHEET_CM = 90; // wide enough for the front and back to share a row

const colName = (c: number) => String.fromCharCode(65 + c);
const tileName = (r: number, c: number) => `${colName(c)}${r + 1}`;

export function buildPatternPdf(opts: {
  composed: Composed;
  spec: Spec;
  measurements: Measurements;
  title: string;
  /** Print only these piece ids (for example one pocket as a test). All pieces when omitted. */
  only?: string[];
}): jsPDF {
  const { composed, spec, measurements, title, only } = opts;
  const printed = only?.length ? { ...composed.garment, panels: composed.garment.panels.filter((p) => only.includes(p.id)) } : composed.garment;
  const layout = layoutGarment(printed, only?.length ? 40 : SHEET_CM, 1.5);
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });

  // ----- cover -----
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text(title, MARGIN, 20);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  let y = 28;
  const line = (text: string, size = 10, bold = false) => {
    if (y > A4_H - 16) {
      doc.addPage();
      y = 20;
    }
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    const wrapped = doc.splitTextToSize(text, A4_W - 2 * MARGIN) as string[];
    doc.text(wrapped, MARGIN, y);
    y += wrapped.length * size * 0.42 + 2;
  };
  if (only?.length) line(`Selected pieces only: ${printed.panels.map((p) => p.name).join(", ")}`, 10, true);
  line("PRINT AT 100% (ACTUAL SIZE). Do not use 'fit to page'. Check the square below measures 5 cm.", 10, true);
  doc.setDrawColor(0);
  doc.setLineWidth(0.3);
  doc.rect(MARGIN, y, 50, 50);
  doc.setFontSize(9);
  doc.text("5 cm x 5 cm", MARGIN + 25, y + 26, { align: "center" });
  y += 58;
  line("Assembly", 12, true);
  line("Print the sheets, trim along the page edge, and tape neighbouring sheets together by matching the labels (A1 to B1, and so on).");
  line("Solid line = stitching line. Dashed line = cutting line (includes seam allowance). Arrow = straight grain.");
  line("Blue thick line = cut on the fold. Short ticks = notches to match. Circles = button positions.");
  y += 2;
  line("Body measurements (cm)", 12, true);
  line(
    `Chest ${measurements.chest}   Waist ${measurements.waist}   Hip ${measurements.hip}   Shoulder ${measurements.shoulder}   Neck ${measurements.neck}`,
  );
  line(`Back length ${measurements.backLength}   Arm ${measurements.armLength}   Bicep ${measurements.bicep}   Wrist ${measurements.wrist ?? 17}`);
  line(`${composed.stats.map((x) => `${x.label} ${x.value}`).join("   ")}   Fit: ${spec.ease}`);
  y += 2;
  line("Pieces", 12, true);
  for (const p of composed.garment.panels) {
    line(`${p.name}: cut ${p.cut.count}${p.cut.onFold ? " on fold" : p.cut.mirror ? " (mirrored pair)" : ""} in ${p.fabric}`);
  }
  y += 2;
  line("Fabric (estimate, 150 cm wide cloth)", 12, true);
  for (const f of estimateFabric(composed.garment)) line(`${f.fabric}: about ${f.metres.toFixed(2)} m`);
  y += 2;
  line("Notions", 12, true);
  for (const n of composed.garment.notions) line(`${n.name}: ${n.qty} ${n.unit}`);
  y += 2;
  const errors = composed.check.issues.filter((i) => i.severity === "error").length;
  line(
    errors === 0
      ? "Automatic checks passed: every piece is closed and every seam matches its partner."
      : `Automatic checks FAILED (${errors} problems). Do not cut this pattern.`,
    10,
    true,
  );
  line("These checks do not prove fit. Make a test garment (toile) before cutting good fabric.");

  // ----- tiles -----
  const sheetW = layout.width * 10;
  const sheetH = layout.height * 10;
  const cols = Math.max(1, Math.ceil((sheetW - OVERLAP) / STEP_X));
  const rows = Math.max(1, Math.ceil((sheetH - OVERLAP) / STEP_Y));

  const tileHasContent = (r: number, c: number) => {
    const x0 = c * STEP_X;
    const y0 = r * STEP_Y;
    return layout.placed.some(
      (it) =>
        it.box.minX * 10 - 2 < x0 + USABLE_W && it.box.maxX * 10 + 2 > x0 && it.box.minY * 10 - 2 < y0 + USABLE_H && it.box.maxY * 10 + 2 > y0 + 0,
    );
  };

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!tileHasContent(r, c)) continue;
      doc.addPage();
      const x0 = c * STEP_X;
      const y0 = r * STEP_Y;
      const toPage = (p: Pt): [number, number] => [MARGIN + p.x * 10 - x0, MARGIN + p.y * 10 - y0];

      doc.saveGraphicsState();
      doc.rect(MARGIN, MARGIN, USABLE_W, USABLE_H, null as unknown as string);
      doc.clip();
      doc.discardPath();
      drawPieces(doc, layout.placed, toPage);
      doc.restoreGraphicsState();

      // frame, registration marks and join labels
      doc.setDrawColor(150);
      doc.setLineWidth(0.15);
      doc.setLineDashPattern([], 0);
      doc.rect(MARGIN, MARGIN, USABLE_W, USABLE_H);
      for (const [cx, cy] of [
        [MARGIN, MARGIN],
        [MARGIN + USABLE_W, MARGIN],
        [MARGIN, MARGIN + USABLE_H],
        [MARGIN + USABLE_W, MARGIN + USABLE_H],
      ]) {
        doc.line(cx - 4, cy, cx + 4, cy);
        doc.line(cx, cy - 4, cx, cy + 4);
      }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(60);
      doc.text(`Sheet ${tileName(r, c)}`, MARGIN + 2, MARGIN - 2.5);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.text(`${title} - print at 100% - ${cols} x ${rows} grid`, A4_W - MARGIN, MARGIN - 2.5, { align: "right" });
      if (c + 1 < cols && tileHasContent(r, c + 1)) doc.text(`join to ${tileName(r, c + 1)} >`, A4_W - MARGIN, A4_H / 2, { align: "right", angle: 90 });
      if (c > 0 && tileHasContent(r, c - 1)) doc.text(`< join to ${tileName(r, c - 1)}`, MARGIN - 2, A4_H / 2, { align: "left", angle: 90 });
      if (r + 1 < rows && tileHasContent(r + 1, c)) doc.text(`join to ${tileName(r + 1, c)} v`, A4_W / 2, A4_H - MARGIN + 5, { align: "center" });
      if (r > 0 && tileHasContent(r - 1, c)) doc.text(`^ join to ${tileName(r - 1, c)}`, A4_W / 2, MARGIN - 0.5, { align: "center" });
      doc.setTextColor(0);
    }
  }
  return doc;
}

function stroke(doc: jsPDF, pts: Pt[], toPage: (p: Pt) => [number, number], closed: boolean) {
  if (pts.length < 2) return;
  const [sx, sy] = toPage(pts[0]);
  const segs: number[][] = [];
  let px = sx;
  let py = sy;
  for (let i = 1; i < pts.length; i++) {
    const [x, y] = toPage(pts[i]);
    segs.push([x - px, y - py]);
    px = x;
    py = y;
  }
  doc.lines(segs, sx, sy, [1, 1], "S", closed);
}

function drawPieces(doc: jsPDF, placed: Placed[], toPage: (p: Pt) => [number, number]) {
  for (const it of placed) {
    const { panel, dx, dy } = it;
    const mv = (p: Pt): Pt => ({ x: p.x + dx, y: p.y + dy });

    doc.setDrawColor(110);
    doc.setLineWidth(0.2);
    doc.setLineDashPattern([2, 1.5], 0);
    stroke(doc, it.cut, toPage, true);

    doc.setDrawColor(0);
    doc.setLineWidth(0.35);
    doc.setLineDashPattern([], 0);
    stroke(doc, it.sew, toPage, true);

    for (const e of panel.edges.filter((x) => x.kind === "fold")) {
      doc.setDrawColor(37, 99, 235);
      doc.setLineWidth(0.9);
      stroke(doc, e.pts.map(mv), toPage, false);
    }

    for (const m of panel.marks) {
      const pts = m.pts.map(mv);
      doc.setDrawColor(0);
      doc.setLineWidth(0.25);
      doc.setLineDashPattern([], 0);
      if (m.kind === "button") {
        const [x, y] = toPage(pts[0]);
        doc.circle(x, y, 1.5);
      } else if (m.kind === "notch") {
        doc.setLineWidth(0.5);
        stroke(doc, pts, toPage, false);
      } else if (m.kind === "slit") {
        doc.setDrawColor(190, 18, 60);
        doc.setLineWidth(0.7);
        stroke(doc, pts, toPage, false);
        const [x, y] = toPage({ x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 });
        doc.setFontSize(7);
        doc.setTextColor(190, 18, 60);
        doc.text(m.label ?? "opening", x, y - 2, { align: "center" });
        doc.setTextColor(0);
      } else if (m.kind === "placement") {
        doc.setDrawColor(15, 118, 110);
        doc.setLineDashPattern([2, 1.5], 0);
        stroke(doc, pts, toPage, false);
        doc.setLineDashPattern([], 0);
        if (m.label) {
          const [x, y] = toPage({ x: (pts[0].x + pts[2].x) / 2, y: (pts[0].y + pts[2].y) / 2 });
          doc.setFontSize(7);
          doc.setTextColor(15, 118, 110);
          doc.text(m.label, x, y, { align: "center" });
          doc.setTextColor(0);
        }
      } else {
        doc.setDrawColor(100);
        doc.setLineDashPattern([3, 2], 0);
        stroke(doc, pts, toPage, false);
        doc.setLineDashPattern([], 0);
      }
    }

    if (panel.grain.length === 2) {
      const a = mv(panel.grain[0]);
      const b = mv(panel.grain[1]);
      doc.setDrawColor(60);
      doc.setLineWidth(0.3);
      doc.setLineDashPattern([], 0);
      stroke(doc, [a, b], toPage, false);
      const ux = b.x - a.x;
      const uy = b.y - a.y;
      const l = Math.hypot(ux, uy) || 1;
      for (const [p, s] of [[a, -1], [b, 1]] as const) {
        const nx = ux / l;
        const ny = uy / l;
        const back = { x: p.x - s * nx * 1.2, y: p.y - s * ny * 1.2 };
        stroke(doc, [{ x: back.x - ny * 0.5, y: back.y + nx * 0.5 }, p, { x: back.x + ny * 0.5, y: back.y - nx * 0.5 }], toPage, false);
      }
    }

    const cx = (it.box.minX + it.box.maxX) / 2;
    const small = it.box.h < 14 || it.box.w < 16;
    const cy = small ? it.box.maxY + 3.5 : (it.box.minY + it.box.maxY) / 2;
    const [tx, ty] = toPage({ x: cx, y: cy });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(0);
    doc.text(panel.name, tx, ty, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(
      `CUT ${panel.cut.count}${panel.cut.onFold ? " ON FOLD" : panel.cut.mirror ? " MIRRORED" : ""} - ${panel.fabric.toUpperCase()}`,
      tx,
      ty + 5,
      { align: "center" },
    );
  }
  doc.setLineDashPattern([], 0);
}
