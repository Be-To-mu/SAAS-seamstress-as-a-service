import { z } from "zod";
import { examplesPrompt, familiesPrompt, READING_GUIDE } from "@/lib/examples";
import { defaultSpec, FAMILY_IDS, FAMILY_SCHEMAS, specKeys, type FamilyId, type Spec } from "@/pattern/spec";

/** The full instructions for the design model. `exclude` drops one worked example, which lets the examples be used as a test set. */
export function designSystemPrompt(exclude?: string): string {
  return `You help a person design their own garment. You fill in a form for a sewing-pattern program, then the program cuts the pattern.
The program has three garment blocks. Pick the one that is closest to what the user wants, then fill in that block's form.

${familiesPrompt()}

${READING_GUIDE}

You may get reference photos (numbered in the order given, starting at 1) and/or a written description. The user's written words win over anything in the photos.
Answer with JSON only, in this exact shape:
{
  "garment": string,      // what the garment is called, e.g. "hoodie", "pencil skirt", "chore coat"
  "family": "coat" | "knit" | "skirt",
  "fitsFamily": boolean,  // false if the garment is something these blocks cannot make (dress, trousers, shorts...). Be honest.
  "reason": string,       // one short sentence explaining the design you chose
  "look": string,         // 2-4 sentences describing the garment exactly as it should LOOK, closely following the reference photos and the user's words: silhouette and proportions, length, fabric and its texture, colour and pattern, collar, closure, pockets, trims and any special details, including things the form cannot capture. This is what the picture is drawn from, so be specific and faithful to the references rather than generic.
  "spec": { ...the form for the family you chose, exactly as listed above, including "family"... },
  "confidence": { "<each spec key>": number 0-1 },   // how sure you are of each field
  "sources": { "<each spec key>": string },          // "photo 1", "photo 2", ..., "text", or "default"
  "unsupported": string[],  // things the user asked for that the form cannot do, such as a hood on a coat, a belt, a lining or a pleat, each as a short request like "add a hood"
  "notes": string           // anything else worth telling the user. Do NOT say a requested hood, belt or similar "cannot be included": the app adds anything you list in "unsupported" to the pattern as an extra piece afterwards.
}
Be honest about confidence. If a detail is hidden or not mentioned, pick a sensible default, give it a low confidence, and set its source to "default".
Never output centimetres. Never invent form fields. Use exactly the allowed values.

Here are worked examples. Study how each answer follows from its input, but design the user's garment on its own merits and do not copy an example.

${examplesPrompt(exclude)}`;
}

export const clean = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * Turn the model's answer into a valid design, field by field, so one bad value does not discard the rest.
 * `base` is what to fall back on for any field the model got wrong.
 */
export function readDesign(
  raw: { family?: unknown; spec?: Record<string, unknown>; confidence?: Record<string, unknown>; sources?: Record<string, unknown> },
  current: Spec | undefined,
): { family: FamilyId; spec: Spec; confidence: Record<string, number>; sources: Record<string, string> } {
  const asked = FAMILY_IDS.find((f) => f === raw.family);
  const family: FamilyId = asked ?? current?.family ?? "coat";
  // A different family than the current design is a fresh start; the same family keeps the user's values where the model garbles one.
  const refining = current !== undefined && current.family === family;
  const base: Spec = refining ? current : defaultSpec(family);
  const shape = FAMILY_SCHEMAS[family].shape as Record<string, z.ZodType>;
  const spec: Record<string, unknown> = { ...base };
  const confidence: Record<string, number> = {};
  const sources: Record<string, string> = {};
  for (const key of specKeys(family)) {
    const value = raw.spec?.[key];
    const ok = shape[key].safeParse(value);
    const c = Number(raw.confidence?.[key]);
    if (ok.success) {
      spec[key] = ok.data;
      confidence[key] = Number.isFinite(c) ? Math.min(1, Math.max(0, c)) : 0.5;
      sources[key] = clean(raw.sources?.[key], 24) || "default";
    } else if (refining) {
      // A refine answer that garbles one field keeps the user's current value for it.
      confidence[key] = 1;
      sources[key] = "unchanged";
    } else {
      confidence[key] = 0.1;
      sources[key] = "default";
    }
  }
  return { family, spec: spec as Spec, confidence, sources };
}

