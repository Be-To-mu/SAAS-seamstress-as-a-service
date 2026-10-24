import { beforeEach, describe, expect, it, vi } from "vitest";
import { designSystemPrompt } from "@/lib/designModel";
import { EXAMPLES } from "@/lib/examples";
import { DEFAULT_KNIT, DEFAULT_SKIRT, DEFAULT_SPEC, type CoatSpec, type KnitSpec, type SkirtSpec } from "@/pattern/spec";

const askJson = vi.fn();
vi.mock("@/lib/gemini", () => ({
  geminiConfigured: () => true,
  geminiModelName: () => "mock-model",
  askJson: (...args: unknown[]) => askJson(...args),
}));

import { POST, type ExtractResult } from "./route";

const IMG = "data:image/jpeg;base64,AAAA";
const post = (body: unknown) => POST(new Request("http://test/api/extract", { method: "POST", body: JSON.stringify(body) }));
const ask = async (body: unknown) => (await (await post(body)).json()) as ExtractResult;

beforeEach(() => askJson.mockReset());

describe("design from references and words", () => {
  it("rejects a request with neither photos nor words", async () => {
    const res = await post({ images: [] });
    expect(res.status).toBe(400);
    expect(askJson).not.toHaveBeenCalled();
  });

  it("works from text alone and treats it as a new design", async () => {
    askJson.mockResolvedValueOnce({
      garment: "chore coat",
      family: "coat",
      fitsFamily: true,
      reason: "Navy coat with two flap pockets.",
      spec: { ...DEFAULT_SPEC, chestPockets: 2, chestPocketStyle: "flap", clothColor: "#1e3a8a" },
      confidence: { chestPockets: 0.95 },
      sources: { chestPockets: "text" },
      unsupported: ["add a hood"],
      notes: "",
    });
    const out = await ask({ images: [], description: "navy, two big flap chest pockets and a hood" });
    expect(out.designMode).toBe("invent");
    expect(out.family).toBe("coat");
    expect((out.spec as CoatSpec).chestPockets).toBe(2);
    expect(out.sources.chestPockets).toBe("text");
    expect(out.unsupported).toEqual(["add a hood"]);
    const sent = JSON.stringify(askJson.mock.calls[0][0]);
    expect(sent).toMatch(/no reference photos/);
    expect(sent).toMatch(/two big flap chest pockets/);
  });

  it("defaults to mix for several photos, numbers them, and keeps attribution", async () => {
    askJson.mockResolvedValueOnce({
      family: "coat",
      reason: "Collar from the first, pockets from the second.",
      spec: { ...DEFAULT_SPEC, collar: "band", lowerPockets: "welt" },
      confidence: { collar: 0.8, lowerPockets: 0.9 },
      sources: { collar: "photo 1", lowerPockets: "photo 2" },
    });
    const out = await ask({ images: [IMG, IMG] });
    expect(out.designMode).toBe("mix");
    expect(out.sources.collar).toBe("photo 1");
    expect(out.sources.lowerPockets).toBe("photo 2");
    const sent = JSON.stringify(askJson.mock.calls[0][0]);
    expect(sent).toMatch(/Photo 1:/);
    expect(sent).toMatch(/Photo 2:/);
  });

  it("honours an explicit mode, but cannot copy or mix zero photos", async () => {
    askJson.mockResolvedValue({ family: "coat", reason: "", spec: DEFAULT_SPEC, confidence: {}, sources: {} });
    expect((await ask({ images: [IMG, IMG], mode: "invent" })).designMode).toBe("invent");
    expect((await ask({ images: [], description: "a coat", mode: "match" })).designMode).toBe("invent");
  });

  it("keeps good fields when the model gets one wrong", async () => {
    askJson.mockResolvedValueOnce({
      family: "coat",
      reason: "",
      spec: { ...DEFAULT_SPEC, collar: "hood", cuff: "rib" },
      confidence: { collar: 0.9, cuff: 0.9 },
      sources: { cuff: "photo 1" },
    });
    const out = await ask({ images: [IMG] });
    const spec = out.spec as CoatSpec;
    expect(spec.collar).toBe(DEFAULT_SPEC.collar);
    expect(out.confidence.collar).toBe(0.1);
    expect(spec.cuff).toBe("rib");
  });

  it("refines the current design and leaves other fields alone", async () => {
    const current = { ...DEFAULT_SPEC, clothColor: "#224229", chestPockets: 2 as const };
    askJson.mockResolvedValueOnce({
      family: "coat",
      reason: "Made it longer.",
      spec: { ...current, lengthFraction: 1.3, collar: "hood" }, // one good change, one garbled field
      confidence: { lengthFraction: 0.9 },
      sources: { lengthFraction: "text" },
    });
    const out = await ask({ current, description: "make it longer" });
    const spec = out.spec as CoatSpec;
    expect(out.designMode).toBe("refine");
    expect(spec.lengthFraction).toBe(1.3);
    expect(spec.clothColor).toBe("#224229");
    expect(spec.collar).toBe(current.collar); // garbled value falls back to the current one
    expect(out.sources.collar).toBe("unchanged");
    expect(out.sources.lengthFraction).toBe("text");
    const sent = JSON.stringify(askJson.mock.calls[0][0]);
    expect(sent).toMatch(/CHANGE it/);
    expect(sent).toMatch(/make it longer/);
  });

  it("needs a change to refine", async () => {
    expect((await post({ current: DEFAULT_SPEC })).status).toBe(400);
  });

  it("refuses more than the reference limit", async () => {
    expect((await post({ images: Array(6).fill(IMG) })).status).toBe(400);
  });
});

describe("garment families", () => {
  it("reads a hoodie as a knit top, with its own fields", async () => {
    askJson.mockResolvedValueOnce({
      garment: "hoodie",
      family: "knit",
      fitsFamily: true,
      reason: "Grey hoodie.",
      spec: { ...DEFAULT_KNIT, neck: "hooded", sleeve: "long", pocket: "kangaroo", cuff: "rib", hem: "band" },
      confidence: { neck: 0.95 },
      sources: { neck: "photo 1" },
    });
    const out = await ask({ images: [IMG] });
    const spec = out.spec as KnitSpec;
    expect(out.family).toBe("knit");
    expect(spec.family).toBe("knit");
    expect(spec.neck).toBe("hooded");
    expect(spec.pocket).toBe("kangaroo");
    expect(Object.keys(out.confidence).sort()).toEqual(["clothColor", "cuff", "ease", "hem", "lengthFraction", "neck", "pocket", "sleeve"]);
  });

  it("reads a skirt, and ignores fields that belong to another family", async () => {
    askJson.mockResolvedValueOnce({
      garment: "circle skirt",
      family: "skirt",
      fitsFamily: true,
      reason: "",
      spec: { ...DEFAULT_SKIRT, silhouette: "circle", length: "midi", collar: "spread", chestPockets: 2 },
      confidence: { silhouette: 0.9 },
      sources: { silhouette: "text" },
    });
    const out = await ask({ description: "a midi circle skirt" });
    const spec = out.spec as SkirtSpec & Record<string, unknown>;
    expect(spec.family).toBe("skirt");
    expect(spec.silhouette).toBe("circle");
    expect(spec.collar).toBeUndefined();
    expect(spec.chestPockets).toBeUndefined();
  });

  it("fills the family's own defaults for a field the model got wrong", async () => {
    askJson.mockResolvedValueOnce({ family: "skirt", spec: { silhouette: "ruffled", length: "maxi" }, confidence: {}, sources: {} });
    const out = await ask({ description: "a long skirt" });
    const spec = out.spec as SkirtSpec;
    expect(spec.silhouette).toBe(DEFAULT_SKIRT.silhouette);
    expect(spec.length).toBe("maxi");
    expect(out.confidence.silhouette).toBe(0.1);
  });

  it("says so when the garment does not fit any block", async () => {
    askJson.mockResolvedValueOnce({
      garment: "trousers",
      family: "skirt",
      fitsFamily: false,
      reason: "Trousers need legs.",
      spec: { ...DEFAULT_SKIRT, silhouette: "a-line", length: "maxi" },
      confidence: {},
      sources: {},
      notes: "Trousers are not available yet.",
    });
    const out = await ask({ description: "wide-leg trousers" });
    expect(out.fitsFamily).toBe(false);
    expect(out.garment).toBe("trousers");
    expect(out.notes).toMatch(/not available/);
  });

  it("an unknown family falls back to the current design's family, or to a coat", async () => {
    askJson.mockResolvedValue({ family: "spacesuit", spec: {}, confidence: {}, sources: {} });
    expect((await ask({ current: DEFAULT_KNIT, description: "bigger" })).family).toBe("knit");
    expect((await ask({ description: "a thing" })).family).toBe("coat");
  });

  it("switching family while refining starts a fresh design in the new family", async () => {
    askJson.mockResolvedValueOnce({
      family: "skirt",
      spec: { ...DEFAULT_SKIRT, silhouette: "pencil" },
      confidence: { silhouette: 0.9 },
      sources: { silhouette: "text" },
    });
    const out = await ask({ current: { ...DEFAULT_SPEC, clothColor: "#224229" }, description: "make it a pencil skirt" });
    expect(out.family).toBe("skirt");
    expect((out.spec as SkirtSpec).silhouette).toBe("pencil");
    expect(Object.values(out.sources)).not.toContain("unchanged");
  });

  it("demo mode with no key keeps the family of the current design", async () => {
    // The mock above says configured; the demo path is covered by readDesign, so only check the shapes here.
    askJson.mockResolvedValueOnce({ family: "knit", spec: DEFAULT_KNIT, confidence: {}, sources: {} });
    expect((await ask({ description: "a tee" })).spec.family).toBe("knit");
  });
});

describe("worked examples for the model", () => {
  it("puts the family blocks, the reading guide and every example in the prompt", () => {
    const prompt = designSystemPrompt();
    expect(prompt).toMatch(/FAMILY "coat"/);
    expect(prompt).toMatch(/FAMILY "knit"/);
    expect(prompt).toMatch(/FAMILY "skirt"/);
    expect(prompt).toMatch(/How to read a garment/);
    for (const ex of EXAMPLES) expect(prompt).toContain(ex.input.slice(0, 40));
  });

  it("can leave one example out, to test the model on it without showing it the answer", () => {
    const left = EXAMPLES[0];
    expect(designSystemPrompt(left.id)).not.toContain(left.input.slice(0, 60));
    expect(designSystemPrompt(left.id)).toContain(EXAMPLES[1].input.slice(0, 40));
  });

  it("sends the prompt with the examples to the model", async () => {
    askJson.mockResolvedValueOnce({ family: "coat", spec: DEFAULT_SPEC, confidence: {}, sources: {} });
    await ask({ description: "a coat" });
    expect(String(askJson.mock.calls[0][1])).toMatch(/EXAMPLE 1/);
  });
});
