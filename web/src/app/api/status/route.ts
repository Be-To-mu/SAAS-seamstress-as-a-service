import { NextResponse } from "next/server";
import { geminiConfigured, geminiModelName } from "@/lib/gemini";
import { bodiesCol, garmentsCol, mongoConfigured, recipesCol } from "@/lib/mongo";

export async function GET() {
  const atlas = mongoConfigured();
  let counts: { garments: number; recipes: number; bodies: number } | null = null;
  if (atlas) {
    try {
      const [garments, recipes, bodies] = await Promise.all([(await garmentsCol()).countDocuments(), (await recipesCol()).countDocuments(), (await bodiesCol()).countDocuments()]);
      counts = { garments, recipes, bodies };
    } catch {
      counts = null;
    }
  }
  return NextResponse.json({
    gemini: geminiConfigured(),
    model: geminiConfigured() ? geminiModelName() : null,
    atlas,
    counts,
  });
}
