import { NextResponse } from "next/server";
import { geminiConfigured, geminiModelName } from "@/lib/gemini";
import { mongoConfigured } from "@/lib/mongo";

export function GET() {
  return NextResponse.json({
    gemini: geminiConfigured(),
    model: geminiConfigured() ? geminiModelName() : null,
    atlas: mongoConfigured(),
  });
}
