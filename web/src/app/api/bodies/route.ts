import { NextResponse } from "next/server";
import { z } from "zod";
import { readyAtlas } from "@/lib/atlas";
import type { SavedBody } from "@/lib/atlasTypes";
import { bodiesCol, mongoConfigured } from "@/lib/mongo";
import { measurementsSchema } from "@/pattern/spec";

export const maxDuration = 20;

const saveSchema = z.object({
  name: z.string().trim().min(1).max(80),
  measurements: measurementsSchema,
  source: z.enum(["typed", "scan"]).default("typed"),
});

export async function POST(req: Request) {
  if (!mongoConfigured()) return NextResponse.json({ error: "MONGODB_URI is not set, so nothing was saved." }, { status: 503 });
  const parsed = saveSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid measurements." }, { status: 400 });
  try {
    await readyAtlas();
    const res = await (await bodiesCol()).insertOne({ ...parsed.data, createdAt: new Date() });
    return NextResponse.json({ id: res.insertedId.toString() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Save failed." }, { status: 502 });
  }
}

export async function GET() {
  if (!mongoConfigured()) return NextResponse.json({ items: [], configured: false });
  try {
    await readyAtlas();
    const docs = await (await bodiesCol()).find({}).sort({ createdAt: -1 }).limit(20).toArray();
    const items: SavedBody[] = docs.map((d) => ({
      id: d._id.toString(),
      name: String(d.name ?? "body"),
      measurements: d.measurements,
      source: d.source === "scan" ? "scan" : "typed",
      createdAt: new Date(d.createdAt ?? Date.now()).toISOString(),
    }));
    return NextResponse.json({ configured: true, items });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Load failed." }, { status: 502 });
  }
}
