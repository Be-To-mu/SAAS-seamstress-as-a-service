import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { publicGarment } from "@/lib/atlas";
import { garmentsCol, mongoConfigured } from "@/lib/mongo";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!mongoConfigured()) return NextResponse.json({ error: "Atlas is not configured." }, { status: 503 });
  const { id } = await ctx.params;
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: "Unknown garment." }, { status: 404 });
  try {
    const doc = await (await garmentsCol()).findOne({ _id: new ObjectId(id) }, { projection: { embedding: 0 } });
    if (!doc) return NextResponse.json({ error: "Unknown garment." }, { status: 404 });
    return NextResponse.json({ item: publicGarment(doc) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Load failed." }, { status: 502 });
  }
}
