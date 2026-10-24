import { NextResponse } from "next/server";
import { z } from "zod";
import { garments, mongoConfigured } from "@/lib/mongo";

export const maxDuration = 30;

const saveSchema = z.object({
  spec: z.record(z.string(), z.unknown()),
  measurements: z.record(z.string(), z.unknown()),
  features: z.array(z.unknown()),
  notions: z.array(z.unknown()),
  fabric: z.array(z.unknown()),
  check: z.object({ ok: z.boolean(), errors: z.number(), warnings: z.number() }),
  thumbnails: z.array(z.string().max(120_000)).max(3).default([]),
  confidence: z.record(z.string(), z.number()).optional(),
});

export async function POST(req: Request) {
  if (!mongoConfigured()) {
    return NextResponse.json({ error: "MONGODB_URI is not set, so nothing was saved." }, { status: 503 });
  }
  const parsed = saveSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid garment." }, { status: 400 });
  try {
    const col = await garments();
    const res = await col.insertOne({ ...parsed.data, createdAt: new Date() });
    return NextResponse.json({ id: res.insertedId.toString() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Save failed." }, { status: 502 });
  }
}

export async function GET() {
  if (!mongoConfigured()) return NextResponse.json({ items: [], configured: false });
  try {
    const col = await garments();
    const items = await col
      .find({}, { projection: { thumbnails: { $slice: 1 }, spec: 1, check: 1, createdAt: 1, features: 1 } })
      .sort({ createdAt: -1 })
      .limit(8)
      .toArray();
    return NextResponse.json({
      configured: true,
      items: items.map((d) => ({ id: d._id.toString(), createdAt: d.createdAt, spec: d.spec, check: d.check, thumbnail: d.thumbnails?.[0] ?? null, featureCount: d.features?.length ?? 0 })),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Load failed." }, { status: 502 });
  }
}
