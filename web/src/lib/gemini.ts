import { GoogleGenAI } from "@google/genai";

export type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

export const geminiConfigured = () => Boolean(process.env.GEMINI_API_KEY);
export const geminiModelName = () => process.env.GEMINI_MODEL ?? "gemini-4-argon";

let client: GoogleGenAI | undefined;

function stripFences(text: string): string {
  const t = text.trim();
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return m ? m[1] : t;
}

export const geminiImageModelName = () => process.env.GEMINI_IMAGE_MODEL ?? "gemini-3.1-flash-image";

/** Ask an image model for one picture. Returns a data URL. Throws if the model sends back no image. */
export async function generateImage(parts: GeminiPart[]): Promise<string> {
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const res = await client.models.generateContent({
    model: geminiImageModelName(),
    contents: [{ role: "user", parts }],
    config: { responseModalities: ["IMAGE", "TEXT"], imageConfig: { aspectRatio: "3:4" } },
  });
  for (const part of res.candidates?.[0]?.content?.parts ?? []) {
    if (part.inlineData?.data) return `data:${part.inlineData.mimeType ?? "image/png"};base64,${part.inlineData.data}`;
  }
  throw new Error(`The image model sent back no picture. ${(res.text ?? "").slice(0, 160)}`.trim());
}

/** Ask the model for a JSON answer. Throws if the reply is not valid JSON. */
export async function askJson(parts: GeminiPart[], system: string): Promise<unknown> {
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const res = await client.models.generateContent({
    model: geminiModelName(),
    contents: [{ role: "user", parts }],
    config: { systemInstruction: system, responseMimeType: "application/json", temperature: 0.2 },
  });
  const text = res.text ?? "";
  try {
    return JSON.parse(stripFences(text));
  } catch {
    throw new Error(`The model did not return valid JSON: ${text.slice(0, 200)}`);
  }
}
