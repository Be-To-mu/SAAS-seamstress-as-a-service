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
  /** How it should look, in words (from the design answer); the picture follows this over the form. */
  look?: string;
  /** The last picture, when this one is a tweak of it. */
  previous?: string;
  /** What the user just asked to change. */
  instruction?: string;
  /** Extra features added to the pattern beyond the form (a hood, a side zip). The picture must show them too. */
  extras: string[];
}

/** The prompt and images for one picture. Throws if an image is not a base64 data URL. */
export function previewParts(input: PreviewInput): GeminiPart[] {
  const { spec, images, description, look, previous, instruction, extras } = input;
  const prompt = [
    look ? `Create one photorealistic product photo of this garment: ${look}` : `Create one photorealistic product photo of ${describeSpec(spec)}.`,
    look ? `Its construction: ${describeSpec(spec)}. Where the two differ, follow the description of how it looks.` : "",
    extras.length ? `It also has these added features, which must be clearly visible: ${extras.join("; ")}.` : "",
    "Show the whole garment from the front, on an invisible mannequin, centred, on a plain light grey studio background, with soft even light. No people, no text, no logos.",
    "Show every detail described above exactly, and do not add pockets, hoods or belts that are not described.",
    previous
      ? `The FIRST attached image is the previous version of this garment. Keep the same garment, camera angle, background and fabric look, and change only what the description above differs in${instruction ? ` (the designer just asked: "${instruction}")` : ""}.`
      : "",
    images.length ? `The ${previous ? "other" : "attached"} reference photos show the style and fabric feel to take inspiration from (${images.length} photo${images.length === 1 ? "" : "s"}). Follow their silhouette, fabric, colour and details closely, as described; ignore the people and the background.` : "",
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
  /** Views already drawn from other angles, so details hidden from the front (the back) match too. */
  others?: { angle: number; image: string }[];
  /** How it looks, in words. */
  look?: string;
}

export function viewParts(input: ViewInput): GeminiPart[] {
  const { spec, extras, front, angle, others = [], look } = input;
  const prompt = [
    "The FIRST image is the front of a garment.",
    ...others.map((o, i) => `Image ${i + 2} is the SAME garment seen ${ANGLE_WORDS[o.angle] ?? `from ${o.angle} degrees`}.`),
    look ? `In words: ${look}` : "",
    `Its pattern, for reference: ${describeSpec(spec)}. Where this differs from the images, follow the images.`,
    extras.length ? `It has these added features: ${extras.join("; ")}.` : "",
    `Create one photorealistic product photo of exactly this garment, seen ${ANGLE_WORDS[angle] ?? `from ${angle} degrees around it`}.`,
    "It must be the very same garment as in the images, not a new design: identical colour and shade, fabric and texture, print, collar, closure, buttons, pockets, stitching, trims, patches and appliqués, length and proportions.",
    others.length ? "Every detail visible in more than one image must match across them; details on the back must match the back views shown." : "",
    "Same invisible mannequin, same size and height in the frame, same plain light grey studio background, same soft even light. Only the viewing angle changes. Show the details visible from this side and none that would be hidden. No people, no text, no logos.",
  ]
    .filter(Boolean)
    .join("\n");
  return [{ text: prompt }, inlineImage(front), ...others.map((o) => inlineImage(o.image))];
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

/** A person photo → a plain dress-form mannequin with exactly their shape and pose (no face, hair or clothes). */
export interface MannequinInput {
  /** The person at this stop (data URL). */
  photo: string;
  /** The camera's angle round the person (0 front, 90 their left side), as the garment views. */
  angle: number;
  /** The mannequin already made from the front, so every angle shows the same one. */
  front?: string;
  /** The wearer's sex, from their profile: the mannequin must have that body. */
  sex?: "female" | "male";
}

export function mannequinParts(input: MannequinInput): GeminiPart[] {
  const { photo, angle, front, sex } = input;
  const view = ANGLE_WORDS[angle] ?? `from ${angle} degrees around it`;
  const body = sex
    ? `The wearer is ${sex}: the mannequin MUST have a ${sex} body (${sex === "male" ? "a flat male chest, a man's shoulders and hips" : "a female bust, a woman's waist and hips"}), whatever the photo seems to show.`
    : "";
  const look = [
    body,
    "A plain, matte, warm off-white dress form with a smooth featureless oval head: no face, no hair, no clothes, no shoes (smooth feet), no skin texture, no jewellery.",
    "Remove the room completely: no walls, furniture, doors, panels or objects. Only a plain warm light-grey studio background with soft even light. No people, no text, no logos.",
    "Exactly one figure in one single image: no second view, no collage, no split frame.",
  ];
  if (front) {
    // The front mannequin leads, so every angle shows the same one; the photo only adds this side's shape.
    const prompt = [
      `The FIRST image is a tailor's mannequin, cast from a person's body, seen from the front. Show EXACTLY this mannequin, turned so the camera sees it ${view}.`,
      "Keep everything about it identical: the same body, sex characteristics, build and proportions, the same pose (arms hanging straight down by the sides), the same colour, the same background, and the same size and position in the frame (head to soles about 88% of the image height, centred). Only the viewpoint changes.",
      `The SECOND image is a photo of the same person seen ${view}. Use it only to get the body's shape from this side right (the profile of the chest, belly, seat and back, and the posture). Ignore their arms, clothes and room.`,
      ...look,
    ].join("\n");
    return [{ text: prompt }, inlineImage(front), inlineImage(photo)];
  }
  const prompt = [
    `The attached photo shows a person standing, seen ${view}. Make a tailor's mannequin that is a faithful cast of THEIR body.`,
    "It must match this person, not a standard mannequin: the same build and sex characteristics (for example a man's flat chest and narrow hips, or a woman's bust), the same height, shoulder width and slope, chest, waist, hips, belly, arm and leg thickness and length.",
    "Pose it in a neutral standing pose, whatever the person is doing: arms hanging straight down, relaxed, close to the sides of the body with the hands beside the thighs; feet a little apart; head level.",
    `Show it ${view}, from a camera at waist height, with the whole figure from the top of the head to the soles filling about 88% of the image height, centred.`,
    ...look,
  ].join("\n");
  return [{ text: prompt }, inlineImage(photo)];
}

export interface DressInput {
  spec: Spec;
  extras: string[];
  /** The mannequin seen from this angle (data URL). */
  mannequin: string;
  /** The garment's front picture, and if available the garment seen from this same angle. */
  garment: string;
  garmentView?: string;
  angle: number;
  /** Guide lines drawn onto the mannequin image, when the wearer moved the hem or cuffs. */
  guides?: { hem?: boolean; sleeve?: boolean };
  /** Where the hem and cuffs fall, in words (e.g. "just above the knee"). */
  hemAt?: string;
  sleeveAt?: string;
  /** The wearer's other adjustments, in words (e.g. "taken in 4 cm at the waist"). */
  notes?: string[];
  /** How the garment looks, in words (from the design). */
  look?: string;
  /** The same garment on the same mannequin from another angle, at this same fit: lengths must match it. */
  sameFit?: string;
}

/** The mannequin, from one angle, wearing the garment. */
export function dressParts(input: DressInput): GeminiPart[] {
  const { spec, extras, angle, guides } = input;
  const prompt = [
    `The FIRST image is a tailor's mannequin seen ${ANGLE_WORDS[angle] ?? `from ${angle} degrees`}. The SECOND image is a garment.`,
    input.garmentView ? "The THIRD image is the same garment seen from this same angle." : "",
    "Dress the mannequin in EXACTLY this garment: an identical copy of the one in the garment image(s), not a new design. Keep its colour and shade, fabric and texture, print or pattern, collar, closure and number of buttons, pockets, stitching, trims, patches and appliqués, and its proportions. Do not add, remove or restyle anything.",
    input.look ? `In words, the garment is: ${input.look}` : "",
    `Its pattern, for reference: ${describeSpec(spec)}. Where this differs from the garment image, follow the image.`,
    extras.length ? `The garment also has: ${extras.join("; ")}.` : "",
    "Fit it to the mannequin's body as it would really sit and drape. Keep the mannequin, its pose, the camera, the framing and the background exactly as in the first image.",
    "POSE: keep the mannequin's arms exactly where they are in the first image, hanging straight down by its sides with the hands beside the thighs. Do not raise, spread or bend the arms, even if the garment image shows them differently.",
    input.hemAt ? `LENGTH: the garment is made to this wearer's chosen length. Its bottom edge (hem) falls ${input.hemAt}${guides?.hem ? ", exactly on the RED line drawn across the mannequin" : ""}. Lengthen or shorten the garment as needed; do not keep its length from the second image.` : "",
    input.sleeveAt ? `SLEEVES: the sleeves end ${input.sleeveAt}${guides?.sleeve ? ", exactly at the height of the BLUE line drawn across the mannequin" : ""}.` : "",
    guides?.hem || guides?.sleeve ? "Do not draw the guide lines in the result." : "",
    input.notes?.length ? `It is tailored to the wearer: ${input.notes.join("; ")}. Show that fit.` : "",
    input.sameFit
      ? "The LAST image shows this same garment on this same mannequin from another angle, at the same fitting: the hem and the cuffs must sit at exactly the same height on the body as there."
      : "",
    "No people, no faces, no text, no logos.",
  ]
    .filter(Boolean)
    .join("\n");
  const parts: GeminiPart[] = [{ text: prompt }, inlineImage(input.mannequin), inlineImage(input.garment)];
  if (input.garmentView) parts.push(inlineImage(input.garmentView));
  if (input.sameFit) parts.push(inlineImage(input.sameFit));
  return parts;
}
