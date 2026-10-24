import { type DesignMode } from "@/lib/design";
import { clean, designSystemPrompt, readDesign } from "@/lib/designModel";
import type { GeminiPart } from "@/lib/gemini";
import { defaultSpec, specKeys, type FamilyId, type Spec } from "@/pattern/spec";

/**
 * Photos/words → garment spec, without the transport. The web route and the
 * iPhone app (through the bundled engine) both use this, so they ask Gemini the
 * same thing and read its answer the same way.
 */
export interface ExtractInput {
  images: string[];
  description?: string;
  mode?: DesignMode;
  /** When set, `description` is a change to make to this design, not a fresh design. */
  current?: Spec;
}

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

function modes(input: ExtractInput): { photoMode: DesignMode; designMode: DesignMode | "refine" } {
  // With no photos there is nothing to copy or mix, so the only sensible mode is to invent.
  const photoMode: DesignMode =
    input.images.length === 0 ? "invent" : (input.mode ?? (input.images.length > 1 ? "mix" : "match"));
  return { photoMode, designMode: input.current ? "refine" : photoMode };
}

/** The defaults, labelled as such, for when no Gemini key is set. */
export function demoExtract(input: ExtractInput): ExtractResult {
  const base: Spec = input.current ?? defaultSpec("coat");
  const keys = specKeys(base.family);
  return {
    mode: "demo",
    designMode: modes(input).designMode,
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
}

/** What to send to the model. Throws if an image is not a base64 data URL. */
export function extractRequest(input: ExtractInput): { parts: GeminiPart[]; system: string } {
  const { photoMode } = modes(input);
  const { images, description, current } = input;
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
    if (!m) throw new Error("Images must be base64 data URLs.");
    parts.push({ text: `Photo ${i + 1}:` }, { inlineData: { mimeType: m[1], data: m[2] } });
  }
  return { parts, system: designSystemPrompt() };
}

/** Turn the model's JSON into a checked result. */
export function extractResult(raw: unknown, input: ExtractInput, model: string): ExtractResult {
  const r = (raw ?? {}) as {
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
  const { family, spec, confidence, sources } = readDesign(r, input.current);
  const unsupported = Array.isArray(r.unsupported) ? r.unsupported.map((u) => clean(u, 80)).filter(Boolean).slice(0, 4) : [];
  return {
    mode: "gemini",
    model,
    designMode: modes(input).designMode,
    garment: clean(r.garment, 60) || (family === "coat" ? "coat" : family === "knit" ? "knit top" : "skirt"),
    family,
    fitsFamily: r.fitsFamily !== false,
    reason: clean(r.reason, 300),
    spec,
    confidence,
    sources,
    unsupported,
    notes: clean(r.notes, 400),
  };
}
