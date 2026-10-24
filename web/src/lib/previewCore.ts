import { describeSpec } from "@/lib/design";
import type { GeminiPart } from "@/lib/gemini";
import type { Spec } from "@/pattern/spec";

/**
 * Spec → what to ask the image model for a picture of the garment. Shared by the
 * web route and the iPhone app (through the bundled engine).
 */
export interface PreviewInput {
  spec: Spec;
  images: string[];
  description?: string;
  /** The last picture, when this one is a tweak of it. */
  previous?: string;
  /** What the user just asked to change. */
  instruction?: string;
  /** Extra features added to the pattern beyond the form (a hood, a side zip). The picture must show them too. */
  extras: string[];
}

/** The prompt and images for one picture. Throws if an image is not a base64 data URL. */
export function previewParts(input: PreviewInput): GeminiPart[] {
  const { spec, images, description, previous, instruction, extras } = input;
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
    if (!m) throw new Error("Images must be base64 data URLs.");
    parts.push({ inlineData: { mimeType: m[1], data: m[2] } });
  }
  return parts;
}
