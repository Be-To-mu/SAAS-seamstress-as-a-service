import { NextResponse } from "next/server";
import { z } from "zod";
import { findRecipes } from "@/lib/atlas";
import { askJson, geminiConfigured, geminiModelName } from "@/lib/gemini";
import { mongoConfigured } from "@/lib/mongo";
import { checkGarment } from "@/pattern/check";
import { compose } from "@/pattern/compose";
import { familyOf } from "@/pattern/families";
import { OP_CATALOG, type Feature } from "@/pattern/features";
import { describeGarment } from "@/pattern/layout";
import { applyOps, opSchema, type Op } from "@/pattern/ops";
import { pickRecipes, RECIPES } from "@/pattern/recipes";
import { measurementsSchema, specSchema, type Spec } from "@/pattern/spec";
import type { Garment } from "@/pattern/types";

export const maxDuration = 60;

const MAX_ATTEMPTS = 3;

const bodySchema = z.object({
  spec: specSchema,
  measurements: measurementsSchema,
  features: z.array(z.object({ id: z.string(), request: z.string(), ops: z.array(opSchema), source: z.enum(["generated", "template"]) })),
  request: z.string().min(2).max(300),
});

/** Rank recipes with Atlas Vector Search when it is configured, then fall back to the keyword list. */
async function examplesFor(request: string, g: Garment, spec: Spec, n = 3) {
  const local = pickRecipes(request, g, spec, RECIPES.length);
  if (!mongoConfigured()) return local.slice(0, n);
  try {
    const ranked = await findRecipes(request, spec.family, n);
    const byId = new Map(local.map((x) => [x.recipe.id, x]));
    const fromAtlas = ranked.map((r) => byId.get(r.id)).filter((x): x is (typeof local)[number] => Boolean(x));
    const rest = local.filter((x) => !fromAtlas.includes(x));
    return [...fromAtlas, ...rest].slice(0, n);
  } catch {
    return local.slice(0, n);
  }
}

/** The instructions for the pattern-cutter model, with worked examples that were verified on this very garment. */
function systemPrompt(spec: Spec, g: Garment, request: string, examples: ReturnType<typeof pickRecipes>): string {
  const family = familyOf(spec);
  const shots = examples
    .map((x) => `Worked example. Request: "${x.recipe.title}". Correct answer for this garment:\n${JSON.stringify({ explanation: x.recipe.explanation, ops: x.ops })}`)
    .join("\n\n");
  return `You are a pattern cutter editing a sewing pattern for ${family.label.toLowerCase()}. ${family.scope}
You change the pattern only by writing a short list of operations from a fixed catalogue.
Prefer the ready-made operations (addPiece, splitPanel, openSeam, addSlit). Only addShape takes drawn coordinates, and only for a piece nothing else can make.
Answer with JSON only: { "explanation": string, "ops": [ ... ] }.
Use only panel, edge, mark and seam ids that appear in the garment description. Keep features small and realistic.
A checker verifies your result. If it reports a problem you will be asked to fix it.

${OP_CATALOG}

The examples below were checked on this exact garment. Learn the style of answer and which operations suit which job, but design what the user asked for. Do not repeat an example unless it is what they asked for, and vary the shape, size and position to suit the request.

${shots || "(No worked example applies to this garment.)"}`;
}

export interface Attempt {
  ok: boolean;
  explanation?: string;
  ops?: Op[];
  problems: string[];
}

export interface FeatureResponse {
  ok: boolean;
  mode: "gemini" | "template";
  model?: string;
  feature?: Feature;
  attempts: Attempt[];
  message?: string;
}

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const { spec, measurements, features, request } = parsed.data;

  const current = compose(spec, measurements, features);
  if (current.featureError) return NextResponse.json({ error: current.featureError }, { status: 409 });

  const id = `feature-${Date.now().toString(36)}`;

  if (!geminiConfigured()) {
    const hit = pickRecipes(request, current.garment, spec, 1).find((x) => x.score > 0);
    if (hit) {
      const problems = checkGarment(applyOps(current.garment, hit.ops).garment).issues.filter((i) => i.severity === "error").map((i) => i.message);
      const attempt: Attempt = { ok: problems.length === 0, explanation: `Built-in "${hit.recipe.title}" recipe (no GEMINI_API_KEY set). ${hit.recipe.explanation}`, ops: hit.ops, problems };
      const out: FeatureResponse = problems.length
        ? { ok: false, mode: "template", attempts: [attempt], message: problems[0] }
        : { ok: true, mode: "template", attempts: [attempt], feature: { id, request, ops: hit.ops, source: "template" } };
      return NextResponse.json(out);
    }
    const names = pickRecipes("", current.garment, spec, RECIPES.length).map((x) => `"${x.recipe.title}"`).join(", ");
    const out: FeatureResponse = {
      ok: false,
      mode: "template",
      attempts: [],
      message: `No GEMINI_API_KEY is set, so only the built-in recipes are available for this garment: ${names || "none"}.`,
    };
    return NextResponse.json(out);
  }

  const hoodJoin = familyOf(spec).hoodJoin(spec);
  const description = `${describeGarment(current.garment)}${hoodJoin ? `\n\nA hood is sewn to: ${hoodJoin.map((r) => `${r.panel}.${r.edge}`).join(" + ")}` : "\n\nThis garment cannot take a hood."}`;
  const SYSTEM = systemPrompt(spec, current.garment, request, await examplesFor(request, current.garment, spec, 3));
  const attempts: Attempt[] = [];
  let feedback = "";

  for (let n = 1; n <= MAX_ATTEMPTS; n++) {
    let ops: Op[] | undefined;
    let explanation: string | undefined;
    let problems: string[] = [];
    try {
      const raw = (await askJson(
        [
          {
            text: `GARMENT DESCRIPTION\n${description}\n\nREQUEST: ${request}${feedback}\n\nReturn the JSON now.`,
          },
        ],
        SYSTEM,
      )) as { explanation?: unknown; ops?: unknown };
      explanation = typeof raw.explanation === "string" ? raw.explanation : undefined;
      const list = z.array(opSchema).safeParse(raw.ops);
      if (!list.success) {
        problems = [`The operations were not valid: ${list.error.issues.slice(0, 3).map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`];
      } else if (list.data.length === 0) {
        problems = ["No operations were returned."];
      } else {
        ops = list.data;
        const res = applyOps(current.garment, ops);
        if (res.error) problems = [res.error];
        else problems = checkGarment(res.garment).issues.filter((i) => i.severity === "error").map((i) => i.message);
      }
    } catch (e) {
      problems = [e instanceof Error ? e.message : "The model call failed."];
    }
    attempts.push({ ok: problems.length === 0, explanation, ops, problems });
    if (problems.length === 0 && ops) {
      const out: FeatureResponse = {
        ok: true,
        mode: "gemini",
        model: geminiModelName(),
        attempts,
        feature: { id, request, ops, source: "generated" },
      };
      return NextResponse.json(out);
    }
    feedback = `\n\nYour previous answer was rejected by the checker:\n- ${problems.join("\n- ")}\nPrevious operations: ${JSON.stringify(ops ?? [])}\nFix the problems and return corrected JSON.`;
  }

  const out: FeatureResponse = {
    ok: false,
    mode: "gemini",
    model: geminiModelName(),
    attempts,
    message: `Could not build "${request}" that passes the checks after ${MAX_ATTEMPTS} tries. The coat is unchanged.`,
  };
  return NextResponse.json(out);
}
