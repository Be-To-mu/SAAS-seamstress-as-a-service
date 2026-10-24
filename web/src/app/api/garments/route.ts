import { NextResponse } from "next/server";
import { z } from "zod";
import { findGarments, garmentText, garmentTitle, publicGarment, readyAtlas } from "@/lib/atlas";
import { embed } from "@/lib/embed";
import { garmentsCol, mongoConfigured } from "@/lib/mongo";
import { describeSpec } from "@/lib/design";
import { opSchema } from "@/pattern/ops";
import { FAMILY_IDS, measurementsSchema, specSchema, type FamilyId } from "@/pattern/spec";

export const maxDuration = 30;

const saveSchema = z.object({
  spec: specSchema,
  measurements: measurementsSchema,
  features: z.array(z.object({ id: z.string(), request: z.string(), ops: z.array(opSchema), source: z.enum(["generated", "template"]) })),
  notions: z.array(z.unknown()).default([]),
  fabric: z.array(z.unknown()).default([]),
  check: z.object({ ok: z.boolean(), errors: z.number(), warnings: z.number() }),
  thumbnails: z.array(z.string().max(120_000)).max(3).default([]),
  thumbnail: z.string().max(400_000).optional(),
  confidence: z.record(z.string(), z.number()).optional(),
  garment: z.string().max(80).optional(),
  notes: z.string().max(400).optional(),
});

export async function POST(req: Request) {
  if (!mongoConfigured()) {
    return NextResponse.json({ error: "MONGODB_URI is not set, so nothing was saved." }, { status: 503 });
  }
  const parsed = saveSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid garment." }, { status: 400 });
  const data = parsed.data;
  try {
    await readyAtlas();
    const description = garmentText({ ...data, family: data.spec.family });
    const embedding = await embed(description);
    const title = garmentTitle(data.spec, data.garment, data.features);
    const thumbnail = data.thumbnail ?? data.thumbnails[0] ?? null;
    const col = await garmentsCol();
    const res = await col.insertOne({
      title,
      garment: data.garment ?? data.spec.family,
      family: data.spec.family,
      description,
      spec: data.spec,
      measurements: data.measurements,
      features: data.features,
      notions: data.notions,
      fabric: data.fabric,
      check: data.check,
      thumbnail,
      thumbnails: data.thumbnails,
      confidence: data.confidence,
      notes: data.notes,
      sentence: describeSpec(data.spec),
      embedding,
      createdAt: new Date(),
    });
    return NextResponse.json({ id: res.insertedId.toString(), title, embedded: Boolean(embedding) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Save failed." }, { status: 502 });
  }
}

export async function GET(req: Request) {
  if (!mongoConfigured()) return NextResponse.json({ items: [], configured: false, via: "recent" });
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? undefined;
  const familyRaw = url.searchParams.get("family");
  const family = FAMILY_IDS.find((f) => f === familyRaw);
  const limit = Math.min(24, Math.max(1, Number(url.searchParams.get("limit") ?? 12) || 12));
  try {
    await readyAtlas();
    const { items, via } = await findGarments({ q, family, limit });
    return NextResponse.json({ configured: true, via, items });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Load failed." }, { status: 502 });
  }
}

export { publicGarment };
