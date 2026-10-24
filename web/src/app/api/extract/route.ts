import { NextResponse } from "next/server";
import { z } from "zod";
import { designModeSchema, MAX_REFERENCES } from "@/lib/design";
import { demoExtract, extractRequest, extractResult, type ExtractInput } from "@/lib/extractCore";
import { askJson, geminiConfigured, geminiModelName } from "@/lib/gemini";
import { specSchema } from "@/pattern/spec";

export type { ExtractResult } from "@/lib/extractCore";

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

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Send photos and/or a description." }, { status: 400 });
  }
  const input: ExtractInput = parsed.data;
  if (!geminiConfigured()) return NextResponse.json(demoExtract(input));

  let request;
  try {
    request = extractRequest(input);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Bad images." }, { status: 400 });
  }
  try {
    const raw = await askJson(request.parts, request.system);
    return NextResponse.json(extractResult(raw, input, geminiModelName()));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Extraction failed." }, { status: 502 });
  }
}
