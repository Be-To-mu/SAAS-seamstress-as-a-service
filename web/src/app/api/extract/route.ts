import { NextResponse } from "next/server";
import { z } from "zod";
import { designModeSchema, MAX_REFERENCES, type DesignMode } from "@/lib/design";
import { clean, designSystemPrompt, readDesign } from "@/lib/designModel";
import { askJson, geminiConfigured, geminiModelName, type GeminiPart } from "@/lib/gemini";
import { defaultSpec, specKeys, specSchema, type FamilyId, type Spec } from "@/pattern/spec";

export const maxDuration = 60;

const bodySchema = z
  .object({
    images: z.array(z.string()).max(MAX_REFERENCES).default([]),
    description: z.string().trim().max(600).optional(),
    mode: designModeSchema.optional(),
    /** When set, `description` is a change to make to this design, not a fresh design. */
    current: specSchema.optional(),
  })
  .refine((b) => (b.current ? Boolean(b.description) : b.images.length > 0 || Boolean(b.description)), {
    message: "Add at least one photo or a description.",
  });

const REFINE_TEXT = (current: Spec) =>
  `The user already has a design and wants to CHANGE it. Here is the current form:
${JSON.stringify(current)}
Apply the user's change and keep every other field exactly as it is now. Only change what they asked for (or what clearly follows from it).
Keep the same family unless the user clearly asks for a different kind of garment (for example "make it a skirt"); then start a fresh design in the new family.
In "sources", use "text" for fields you changed and "unchanged" for the rest. Give unchanged fields confidence 1.`;

const MODE_TEXT: Record<DesignMode, string> = {
  match: "The photos all show the SAME garment from different angles. Describe that one garment as faithfully as you can.",
  mix: "The photos show DIFFERENT garments. Combine them into one new garment: for each field, take the detail you think works best from the photos (or the user's words), and say which one you took it from.",
  invent:
    "Design a NEW garment. Use the photos only as inspiration for the overall feel, then make your own choices that fit the user's words. It does not need to copy any one photo.",
};

export interface ExtractResult {
  mode: "gemini" | "demo";
  model?: string;
  designMode: DesignMode | "refine";
  /** What the garment is, in the model's words ("hoodie"). */
  garment: string;
  family: FamilyId;
  /** False when the garment is something the blocks cannot really make (a dress, trousers). The spec is then only the closest shape. */
  fitsFamily: boolean;
  reason: string;
  spec: Spec;
  confidence: Record<string, number>;
  sources: Record<string, string>;
  unsupported: string[];
  notes: string;
}

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Send photos and/or a description." }, { status: 400 });
  }
  const { images, description, current } = parsed.data;
  // With no photos there is nothing to copy or mix, so the only sensible mode is to invent.
  const photoMode: DesignMode = images.length === 0 ? "invent" : (parsed.data.mode ?? (images.length > 1 ? "mix" : "match"));
  const designMode: DesignMode | "refine" = current ? "refine" : photoMode;
  const base: Spec = current ?? defaultSpec("coat");

  if (!geminiConfigured()) {
    const keys = specKeys(base.family);
    const demo: ExtractResult = {
      mode: "demo",
      designMode,
      garment: base.family === "coat" ? "chore coat" : base.family === "knit" ? "knit top" : "skirt",
      family: base.family,
      fitsFamily: true,
      reason: "Demo mode: no GEMINI_API_KEY is set, so these are the default values, not read from your photos or words.",
      spec: base,
      confidence: Object.fromEntries(keys.map((k) => [k, 0.3])),
      sources: Object.fromEntries(keys.map((k) => [k, "default"])),
      unsupported: [],
      notes: "",
    };
    return NextResponse.json(demo);
  }

  try {
    const intro = (
      current
        ? [REFINE_TEXT(current), `The user's change: "${description}"`]
        : [
            MODE_TEXT[photoMode],
            images.length ? `There are ${images.length} reference photo${images.length === 1 ? "" : "s"}.` : "There are no reference photos.",
            description ? `The user's description: "${description}"` : "The user wrote no description.",
          ]
    ).join("\n");
    const parts: GeminiPart[] = [{ text: intro }];
    for (const [i, url] of images.entries()) {
      const m = url.match(/^data:(image\/[a-z+.-]+);base64,(.+)$/i);
      if (!m) return NextResponse.json({ error: "Images must be base64 data URLs." }, { status: 400 });
      parts.push({ text: `Photo ${i + 1}:` }, { inlineData: { mimeType: m[1], data: m[2] } });
    }
    const raw = (await askJson(parts, designSystemPrompt())) as {
      garment?: unknown;
      family?: unknown;
      fitsFamily?: unknown;
      reason?: unknown;
      spec?: Record<string, unknown>;
      confidence?: Record<string, unknown>;
      sources?: Record<string, unknown>;
      unsupported?: unknown;
      notes?: unknown;
    };

    const { family, spec, confidence, sources } = readDesign(raw, current);
    const unsupported = Array.isArray(raw.unsupported) ? raw.unsupported.map((u) => clean(u, 80)).filter(Boolean).slice(0, 4) : [];
    const result: ExtractResult = {
      mode: "gemini",
      model: geminiModelName(),
      designMode,
      garment: clean(raw.garment, 60) || (family === "coat" ? "coat" : family === "knit" ? "knit top" : "skirt"),
      family,
      fitsFamily: raw.fitsFamily !== false,
      reason: clean(raw.reason, 300),
      spec,
      confidence,
      sources,
      unsupported,
      notes: clean(raw.notes, 400),
    };
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Extraction failed." }, { status: 502 });
  }
}
