import type { Document, Filter } from "mongodb";
import { embed, garmentText, rankByVector, recipeText } from "@/lib/embed";
import { bodiesCol, ensureIndexes, garmentsCol, mongoConfigured, recipesCol } from "@/lib/mongo";
import { describeSpec } from "@/lib/design";
import { RECIPES } from "@/pattern/recipes";
import type { Feature } from "@/pattern/features";
import type { FamilyId, Measurements, Spec } from "@/pattern/spec";
import type { SavedBody, SavedGarment } from "@/lib/atlasTypes";

export type { SavedBody, SavedGarment };

export async function readyAtlas(): Promise<{ ok: boolean; garments: number; recipes: number; bodies: number; reason?: string }> {
  if (!mongoConfigured()) return { ok: false, garments: 0, recipes: 0, bodies: 0, reason: "MONGODB_URI is not set." };
  await ensureIndexes();
  await seedRecipes();
  const [garments, recipes, bodies] = await Promise.all([(await garmentsCol()).countDocuments(), (await recipesCol()).countDocuments(), (await bodiesCol()).countDocuments()]);
  return { ok: true, garments, recipes, bodies };
}

/** Put the built-in recipes into Atlas so Vector Search can rank them. Ops stay in code; Atlas only stores the words. */
export async function seedRecipes() {
  const col = await recipesCol();
  for (const r of RECIPES) {
    const existing = await col.findOne({ id: r.id });
    const text = recipeText(r);
    const prev = existing as { embedding?: unknown } | null;
    const embedding = Array.isArray(prev?.embedding) ? (prev.embedding as number[]) : await embed(text);
    await col.updateOne(
      { id: r.id },
      {
        $set: {
          id: r.id,
          title: r.title,
          keywords: r.keywords,
          families: r.families,
          explanation: r.explanation,
          text,
          embedding,
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true },
    );
  }
}

export async function vectorSearch<T extends Document>(opts: {
  collection: "garments" | "recipes";
  index: string;
  query: number[];
  limit: number;
  filter?: Filter<Document>;
}): Promise<(T & { score: number })[]> {
  const col = opts.collection === "garments" ? await garmentsCol<T>() : await recipesCol<T>();
  try {
    const docs = await col
      .aggregate<T & { score: number }>([
        {
          $vectorSearch: {
            index: opts.index,
            path: "embedding",
            queryVector: opts.query,
            numCandidates: Math.max(40, opts.limit * 8),
            limit: opts.limit,
            ...(opts.filter ? { filter: opts.filter } : {}),
          },
        },
        { $addFields: { score: { $meta: "vectorSearchScore" } } },
        { $project: { embedding: 0 } },
      ])
      .toArray();
    if (docs.length) return docs;
  } catch {
    // No vector index yet: rank a recent batch ourselves.
  }
  const recent = await col
    .find(opts.filter ?? {})
    .project({ embedding: 1 })
    .sort({ createdAt: -1 })
    .limit(80)
    .toArray();
  const ids = rankByVector(opts.query, recent as (T & { embedding?: number[] })[], opts.limit);
  if (!ids.length) return [];
  const full = await col
    .find({ _id: { $in: ids.map((d) => d._id) } } as Filter<Document>, { projection: { embedding: 0 } })
    .toArray();
  const score = new Map(ids.map((d) => [String(d._id), d.score]));
  return full
    .map((d) => ({ ...(d as T), score: score.get(String((d as { _id: { toString(): string } })._id)) ?? 0 }))
    .sort((a, b) => b.score - a.score);
}

export async function textSearchGarments(query: string, family: FamilyId | undefined, limit: number): Promise<Document[]> {
  const col = await garmentsCol();
  try {
    return await col
      .aggregate([
        {
          $search: {
            index: "garment_text",
            compound: {
              must: [{ text: { query, path: ["title", "garment", "description"] } }],
              ...(family ? { filter: [{ equals: { path: "family", value: family } }] } : {}),
            },
          },
        },
        { $limit: limit },
        { $addFields: { score: { $meta: "searchScore" } } },
        { $project: { embedding: 0 } },
      ])
      .toArray();
  } catch {
    const rx = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    return col
      .find(
        {
          ...(family ? { family } : {}),
          $or: [{ title: rx }, { garment: rx }, { description: rx }],
        },
        { projection: { embedding: 0 } },
      )
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
  }
}

export function publicGarment(d: Document): SavedGarment {
  return {
    id: d._id.toString(),
    title: String(d.title ?? d.garment ?? d.family ?? "garment"),
    garment: String(d.garment ?? ""),
    family: d.family as FamilyId,
    description: String(d.description ?? ""),
    spec: d.spec as Spec,
    measurements: d.measurements as Measurements,
    features: (d.features ?? []) as Feature[],
    thumbnail: typeof d.thumbnail === "string" ? d.thumbnail : (d.thumbnails?.[0] ?? null),
    featureCount: Array.isArray(d.features) ? d.features.length : 0,
    check: d.check as SavedGarment["check"],
    createdAt: new Date(d.createdAt ?? Date.now()).toISOString(),
    score: typeof d.score === "number" ? d.score : undefined,
  };
}

export async function findGarments(opts: { q?: string; family?: FamilyId; limit?: number }): Promise<{ items: SavedGarment[]; via: "vector" | "text" | "recent" }> {
  const limit = opts.limit ?? 12;
  const filter = opts.family ? { family: opts.family } : undefined;
  const q = opts.q?.trim();
  if (q) {
    const vec = await embed(q);
    if (vec) {
      const hits = await vectorSearch({ collection: "garments", index: "garment_vector", query: vec, limit, filter });
      if (hits.length) return { items: hits.map(publicGarment), via: "vector" };
    }
    const text = await textSearchGarments(q, opts.family, limit);
    if (text.length) return { items: text.map(publicGarment), via: "text" };
  }
  const recent = await (await garmentsCol())
    .find(filter ?? {}, { projection: { embedding: 0 } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
  return { items: recent.map(publicGarment), via: "recent" };
}

export async function findRecipes(request: string, family: FamilyId, limit = 4): Promise<{ id: string; title: string; explanation: string; score: number }[]> {
  const vec = await embed(request);
  if (vec) {
    const hits = await vectorSearch<{ id: string; title: string; explanation: string }>({
      collection: "recipes",
      index: "recipe_vector",
      query: vec,
      limit,
      filter: { families: family },
    });
    if (hits.length) return hits.map((h) => ({ id: h.id, title: h.title, explanation: h.explanation, score: h.score }));
  }
  return RECIPES.filter((r) => r.families.includes(family))
    .map((r) => ({ id: r.id, title: r.title, explanation: r.explanation, score: 0 }))
    .slice(0, limit);
}

export function garmentTitle(spec: Spec, garment: string | undefined, features: Feature[]): string {
  const extra = features[0]?.request;
  return [garment || spec.family, extra].filter(Boolean).join(" · ");
}

export { garmentText, describeSpec };
