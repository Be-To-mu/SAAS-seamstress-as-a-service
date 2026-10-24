import { NextResponse } from "next/server";
import { z } from "zod";
import { describeSpec, MAX_REFERENCES } from "@/lib/design";
import { generateImage, geminiConfigured, geminiImageModelName, type GeminiPart } from "@/lib/gemini";
import { specSchema } from "@/pattern/spec";

export const maxDuration = 60;

const bodySchema = z.object({
  spec: specSchema,
  images: z.array(z.string()).max(MAX_REFERENCES).default([]),
  description: z.string().trim().max(600).optional(),
  /** The last picture, when this one is a tweak of it. */
  previous: z.string().optional(),
  /** What the user just asked to change. */
  instruction: z.string().trim().max(300).optional(),
  /** Extra features added to the pattern beyond the form (a hood, a side zip). The picture must show them too. */
  extras: z.array(z.string().trim().max(200)).max(8).default([]),
});

export interface PreviewResult {
  model: string;
  image: string;
}

/** A picture of the jacket the form describes. It is an illustration for the user; the pattern is drawn from the form, not from this picture. */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Send the jacket spec, and optionally photos." }, { status: 400 });
  if (!geminiConfigured()) return NextResponse.json({ error: "Pictures need a GEMINI_API_KEY." }, { status: 503 });

  const { spec, images, description, previous, instruction, extras } = parsed.data;
  const prompt = [
    `Create one photorealistic product photo of ${describeSpec(spec)}.`,
    extras.length ? `It also has these added features, which must be clearly visible: ${extras.join("; ")}.` : "",
    "Show the whole jacket from the front, on an invisible mannequin or laid flat, centred, on a plain light grey studio background, with soft even light. No people, no text, no logos.",
    "Show every detail listed above exactly, and do not add any pockets, hoods or belts that are not listed.",
    previous
      ? `The FIRST attached image is the previous version of this jacket. Keep the same garment, camera angle, background and fabric look, and change only what the description above differs in${instruction ? ` (the designer just asked: "${instruction}")` : ""}.`
      : "",
    images.length ? `The ${previous ? "other" : "attached"} reference photos show the style and fabric feel to take inspiration from (${images.length} photo${images.length === 1 ? "" : "s"}). Match the listed details, not the people or the background.` : "",
    description ? `The designer also wrote: "${description}"` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const parts: GeminiPart[] = [{ text: prompt }];
  for (const url of [...(previous ? [previous] : []), ...images]) {
    const m = url.match(/^data:(image\/[a-z+.-]+);base64,(.+)$/i);
    if (!m) return NextResponse.json({ error: "Images must be base64 data URLs." }, { status: 400 });
    parts.push({ inlineData: { mimeType: m[1], data: m[2] } });
  }

  try {
    const image = await generateImage(parts);
    const result: PreviewResult = { model: geminiImageModelName(), image };
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not make a picture." }, { status: 502 });
  }
}
