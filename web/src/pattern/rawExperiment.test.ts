/**
 * Experiment, not a regression test. Skipped unless RAW_EXPERIMENT=1.
 *
 * Question: what if Gemini drew the sewing pattern itself (raw points and seams),
 * instead of choosing parameters for our pattern program?
 *
 * We ask for a chore coat for the sample body, convert the answer into our Garment type,
 * and score it with the same checker that guards our own patterns. One-shot, and with the
 * same 3-try repair loop the feature route uses.
 *
 * Run:  RAW_EXPERIMENT=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run src/pattern/rawExperiment.test.ts
 */
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { askJson, geminiModelName } from "@/lib/gemini";
import { checkGarment } from "./check";
import { compose } from "./compose";
import { bbox, panelOutline } from "./geometry";
import { DEFAULT_SPEC, SAMPLE_BODY } from "./spec";
import type { Garment, Panel, Pt, Seam } from "./types";

const TRIALS = Number(process.env.RAW_TRIALS ?? 8);

const SYSTEM = `You are a pattern cutter. Draft a flat 2D sewing pattern for a workwear chore coat.
Units are centimetres, y points DOWN. Finished pieces only (no seam allowance).
Pieces: "back", "front" (one half), "sleeve", "collar".
Each piece is a CLOSED outline made of named edges. Edges are polylines (arrays of [x, y] points) that chain end-to-start, and the last edge ends where the first begins.
Seams say which edges are sewn together. Sewn edges must be the same length (within 5 mm), except the armhole where the sleeve cap edge may be 0.5 to 4.5 cm longer than the body armhole.
Answer JSON only:
{
  "panels": [ { "id": "back", "edges": [ { "id": "shoulder", "pts": [[x,y],[x,y],...] }, ... ] }, ... ],
  "seams": [ { "id": "shoulder", "a": [ { "panel": "back", "edge": "shoulder" } ], "b": [ { "panel": "front", "edge": "shoulder" } ] }, ... ]
}
Include seams: shoulder (back to front), side (back to front), armhole (body armhole to sleeve cap), sleeve.under (the two long sleeve edges), collar.neck (collar to the neck edges of back and front).
Use enough points on curves (armhole, neckline, sleeve cap) to look smooth.`;

const bodyText = (m: typeof SAMPLE_BODY) =>
  `Body (cm): chest ${m.chest}, waist ${m.waist}, hip ${m.hip}, shoulder ${m.shoulder}, neck ${m.neck}, back length ${m.backLength}, arm ${m.armLength}, bicep ${m.bicep}. Regular fit, wearing ease about 18 cm on the chest, boxy workwear shape, jacket length to the hip.`;

interface Raw {
  panels?: { id?: string; edges?: { id?: string; pts?: unknown }[] }[];
  seams?: { id?: string; a?: unknown; b?: unknown }[];
}

function toGarment(raw: Raw): Garment {
  const panels: Panel[] = (raw.panels ?? []).map((p) => ({
    id: String(p.id),
    name: String(p.id),
    edges: (p.edges ?? []).map((e) => ({
      id: String(e.id),
      allowance: 1.5,
      pts: (Array.isArray(e.pts) ? e.pts : []).map((q): Pt => ({ x: Number((q as number[])[0]), y: Number((q as number[])[1]) })),
    })),
    marks: [],
    cut: { count: 2, mirror: false, onFold: false },
    fabric: "shell",
    grain: [],
  }));
  const refs = (v: unknown) => (Array.isArray(v) ? (v as { panel: string; edge: string }[]).map((r) => ({ panel: String(r.panel), edge: String(r.edge) })) : []);
  const seams: Seam[] = (raw.seams ?? []).map((s) => ({
    id: String(s.id),
    a: refs(s.a),
    b: refs(s.b),
    ease: s.id === "armhole" ? [0.5, 4.5] : [-0.5, 0.5],
    kind: "sewn",
  }));
  return { panels, seams, notions: [] };
}

/** Run the checker, but treat structural garbage (NaN points, empty edges) as errors rather than crashing. */
function score(raw: Raw): { errors: string[]; garment?: Garment } {
  try {
    const g = toGarment(raw);
    if (!g.panels.length) return { errors: ["no panels"] };
    for (const p of g.panels) {
      for (const e of p.edges) if (e.pts.length < 2 || e.pts.some((q) => !Number.isFinite(q.x) || !Number.isFinite(q.y))) return { errors: [`${p.id}/${e.id}: bad points`] };
    }
    const need = ["shoulder", "side", "armhole", "sleeve.under", "collar.neck"];
    const missing = need.filter((n) => !g.seams.some((s) => s.id === n));
    const res = checkGarment(g);
    const errors = [...missing.map((n) => `missing seam ${n}`), ...res.issues.filter((i) => i.severity === "error").map((i) => `${i.code}: ${i.message}`)];
    return { errors, garment: g };
  } catch (e) {
    return { errors: [`crash: ${e instanceof Error ? e.message : String(e)}`] };
  }
}

async function oneShot(): Promise<{ errors: string[]; garment?: Garment }> {
  const raw = (await askJson([{ text: bodyText(SAMPLE_BODY) }], SYSTEM)) as Raw;
  return score(raw);
}

async function withRepair(): Promise<{ errors: string[]; garment?: Garment; tries: number }> {
  const parts = [{ text: bodyText(SAMPLE_BODY) }];
  let last: { errors: string[]; garment?: Garment } = { errors: ["no answer"] };
  for (let t = 1; t <= 3; t++) {
    const raw = (await askJson(parts, SYSTEM)) as Raw;
    last = score(raw);
    if (last.errors.length === 0) return { ...last, tries: t };
    parts.push({ text: `Your previous answer was rejected by the checker:\n${last.errors.slice(0, 8).join("\n")}\nFix every problem and answer again with the full JSON.` });
  }
  return { ...last, tries: 3 };
}

/** Draw the sewing lines of every piece in a row, to eyeball the shapes. */
function toSvg(g: Garment): string {
  let x = 2;
  const shapes: string[] = [];
  let maxH = 0;
  for (const p of g.panels) {
    const o = panelOutline(p);
    const b = bbox(o);
    const pts = o.map((q) => `${(q.x - b.minX + x).toFixed(1)},${(q.y - b.minY + 2).toFixed(1)}`).join(" ");
    shapes.push(`<polygon points="${pts}" fill="#cbd5e1" stroke="#0f172a" stroke-width="0.3"/><text x="${x + b.w / 2}" y="${b.h + 6}" font-size="3" text-anchor="middle">${p.id}</text>`);
    x += b.w + 4;
    maxH = Math.max(maxH, b.h);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${x} ${maxH + 9}" width="${x * 8}" height="${(maxH + 9) * 8}"><rect width="100%" height="100%" fill="white"/>${shapes.join("")}</svg>`;
}

/** Rough size of the pieces, to see if the shapes are even the right scale. */
function sizes(g?: Garment) {
  if (!g) return "n/a";
  return g.panels
    .map((p) => {
      try {
        const b = bbox(panelOutline(p));
        return `${p.id} ${b.w.toFixed(0)}x${b.h.toFixed(0)}`;
      } catch {
        return `${p.id} ?`;
      }
    })
    .join(", ");
}

describe.skipIf(!process.env.RAW_EXPERIMENT)("experiment: Gemini draws the pattern itself", () => {
  it(
    "scores raw drawing against our pattern program",
    async () => {
      const lines: string[] = [];
      const log = (s: string) => {
        console.log(s);
        lines.push(s);
      };
      const ours = compose(DEFAULT_SPEC, SAMPLE_BODY, []);
      log(`MODEL ${geminiModelName()}, ${TRIALS} trials each`);
      log(`OURS: checks ${ours.check.ok ? "PASS" : "FAIL"} | ${sizes(ours.garment)}`);

      const settle = <T,>(fn: () => Promise<T>) => fn().catch((e) => ({ errors: [`api: ${e instanceof Error ? e.message.slice(0, 80) : String(e)}`] }) as never as T);
      const shots = await Promise.all(Array.from({ length: TRIALS }, () => settle(oneShot)));
      const repaired = await Promise.all(Array.from({ length: TRIALS }, () => settle(withRepair)));

      const pass = (rs: { errors: string[] }[]) => rs.filter((r) => r.errors.length === 0).length;
      log(`ONE-SHOT:      ${pass(shots)}/${TRIALS} pass the checker`);
      log(`WITH REPAIR:   ${pass(repaired)}/${TRIALS} pass the checker (up to 3 tries)`);

      const tally: Record<string, number> = {};
      for (const r of shots) for (const e of r.errors) tally[e.split(":")[0]] = (tally[e.split(":")[0]] ?? 0) + 1;
      log(`One-shot problems by kind: ${JSON.stringify(tally)}`);
      log("Example one-shot problems:");
      for (const r of shots.slice(0, 4)) log(`  - ${r.errors.slice(0, 3).join(" | ") || "none"}`);
      log("Piece sizes (cm), first 4 one-shot drafts:");
      for (const r of shots.slice(0, 4)) log(`  - ${sizes(r.garment)}`);
      log("Left-over problems after repair (first 3 failures):");
      for (const r of repaired.filter((x) => x.errors.length).slice(0, 3)) log(`  - ${r.errors.slice(0, 2).join(" | ")}`);
      const okRepaired = repaired.filter((r) => r.errors.length === 0) as { tries?: number }[];
      if (okRepaired.length) log(`Tries needed when repair worked: ${okRepaired.map((r) => r.tries).join(",")}`);
      writeFileSync("/tmp/raw-experiment.txt", lines.join("\n") + "\n");
      writeFileSync("/tmp/raw-ours.svg", toSvg(ours.garment));
      const firstOk = repaired.find((r) => r.errors.length === 0 && r.garment);
      if (firstOk?.garment) writeFileSync("/tmp/raw-gemini.svg", toSvg(firstOk.garment));
      expect(ours.check.ok).toBe(true);
    },
    900_000,
  );
});
