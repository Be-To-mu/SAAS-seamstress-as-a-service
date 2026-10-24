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

/** The camera angles of a turnaround, degrees clockwise seen from above: 0 is the front, 180 the back. */
export const VIEW_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315] as const;

const ANGLE_WORDS: Record<number, string> = {
  0: "straight from the front",
  45: "from the front-left three-quarter angle (camera turned 45 degrees around the garment)",
  90: "from the left side, in profile",
  135: "from the back-left three-quarter angle",
  180: "straight from the back",
  225: "from the back-right three-quarter angle",
  270: "from the right side, in profile",
  315: "from the front-right three-quarter angle",
};

export interface ViewInput {
  spec: Spec;
  extras: string[];
  /** The front picture (data URL), so every view shows the very same garment. */
  front: string;
  angle: number;
}

/** One view of a turnaround: the same garment as the front picture, seen from another angle. */
export function viewParts(input: ViewInput): GeminiPart[] {
  const { spec, extras, front, angle } = input;
  const prompt = [
    `The attached image is the front of ${describeSpec(spec)}.`,
    extras.length ? `It has these added features: ${extras.join("; ")}.` : "",
    `Create one photorealistic product photo of exactly this garment, seen ${ANGLE_WORDS[angle] ?? `from ${angle} degrees around it`}.`,
    "Keep everything identical: the same garment, colour, fabric, stitching and details, on the same invisible mannequin, at the same size and height in the frame, on the same plain light grey studio background with the same soft even light.",
    "Only the viewing angle changes. Show the details that are visible from this side and none that would be hidden. No people, no text, no logos.",
  ]
    .filter(Boolean)
    .join("\n");
  return [{ text: prompt }, inlineImage(front)];
}

export interface TryOnInput {
  spec: Spec;
  /** A photo of the person (data URL). */
  person: string;
  /** The garment's front picture (data URL). */
  garment: string;
}

/** The person in the first image, wearing the garment from the second (as in Google's Virtual Fitting Room). */
export function tryOnParts(input: TryOnInput): GeminiPart[] {
  const prompt = [
    `The first image is a photo of a person. The second image is ${describeSpec(input.spec)}.`,
    "Create one photorealistic photo of this same person wearing this garment.",
    "Keep the person exactly as they are: the same face, hair, skin, body shape, height, pose, expression and background, and the same camera and light.",
    "Replace only their top or bottom clothing as needed with this garment. Fit it to their body as it would really sit and drape, sized for them, with natural folds. Keep every detail of the garment (colour, fabric, collar, closure, pockets, length).",
    "No text, no logos, no extra people.",
  ].join("\n");
  return [{ text: prompt }, inlineImage(input.person), inlineImage(input.garment)];
}

function inlineImage(url: string): GeminiPart {
  const m = url.match(/^data:(image\/[a-z+.-]+);base64,(.+)$/i);
  if (!m) throw new Error("Images must be base64 data URLs.");
  return { inlineData: { mimeType: m[1], data: m[2] } };
}
