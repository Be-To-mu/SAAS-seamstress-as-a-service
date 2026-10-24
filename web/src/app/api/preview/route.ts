import { NextResponse } from "next/server";
import { z } from "zod";
import { MAX_REFERENCES } from "@/lib/design";
import { generateImage, geminiConfigured, geminiImageModelName } from "@/lib/gemini";
import { previewParts } from "@/lib/previewCore";
import { specSchema } from "@/pattern/spec";

export const maxDuration = 60;

const bodySchema = z.object({
  spec: specSchema,
  images: z.array(z.string()).max(MAX_REFERENCES).default([]),
  description: z.string().trim().max(600).optional(),
  /** How it should look, in words, from the design answer. */
  look: z.string().trim().max(900).optional(),
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

  let parts;
  try {
    parts = previewParts(parsed.data);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Bad images." }, { status: 400 });
  }

  try {
    const image = await generateImage(parts);
    const result: PreviewResult = { model: geminiImageModelName(), image };
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not make a picture." }, { status: 502 });
  }
}
