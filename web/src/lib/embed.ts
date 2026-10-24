import { GoogleGenAI } from "@google/genai";
import { describeSpec } from "@/lib/design";
import type { Feature } from "@/pattern/features";
import type { FamilyId, Spec } from "@/pattern/spec";

/** Gemini embedding size we store on Atlas. The vector index must match. */
export const EMBED_DIM = 768;

export const embedModelName = () => process.env.GEMINI_EMBED_MODEL ?? "gemini-embedding-001";

let client: GoogleGenAI | undefined;

/** One vector for a short piece of text, or null when there is no Gemini key or the call fails. */
export async function embed(text: string): Promise<number[] | null> {
  if (!process.env.GEMINI_API_KEY) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const res = await client.models.embedContent({
      model: embedModelName(),
      contents: trimmed,
      config: { outputDimensionality: EMBED_DIM },
    });
    const values = res.embeddings?.[0]?.values;
    return values && values.length === EMBED_DIM ? values : null;
  } catch {
    return null;
  }
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

/** Rank documents that already have an embedding, highest cosine first. */
export function rankByVector<T extends { embedding?: number[] }>(query: number[], docs: T[], n: number): (T & { score: number })[] {
  return docs
    .filter((d): d is T & { embedding: number[] } => Array.isArray(d.embedding) && d.embedding.length > 0)
    .map((d) => ({ ...d, score: cosine(query, d.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}

export function garmentText(input: { garment?: string; family: FamilyId; spec: Spec; features?: Feature[]; notes?: string }): string {
  const extras = (input.features ?? []).map((f) => f.request).filter(Boolean);
  return [
    input.garment ?? input.family,
    describeSpec(input.spec),
    extras.length ? `added: ${extras.join("; ")}` : "",
    input.notes ?? "",
  ]
    .filter(Boolean)
    .join(". ");
}

export function recipeText(input: { title: string; explanation: string; keywords: string[] }): string {
  return `${input.title}. ${input.explanation}. ${input.keywords.join(" ")}`;
}
