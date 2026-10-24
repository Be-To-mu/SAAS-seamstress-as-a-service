import { beforeEach, describe, expect, it, vi } from "vitest";
import { describeSpec } from "@/lib/design";
import { DEFAULT_SPEC } from "@/pattern/spec";

const generateImage = vi.fn();
vi.mock("@/lib/gemini", () => ({
  geminiConfigured: () => true,
  geminiImageModelName: () => "mock-image-model",
  generateImage: (...args: unknown[]) => generateImage(...args),
}));

import { POST, type PreviewResult } from "./route";

const IMG = "data:image/jpeg;base64,AAAA";
const post = (body: unknown) => POST(new Request("http://test/api/preview", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => generateImage.mockReset());

describe("jacket picture", () => {
  it("sends the spec in words, plus the reference photos and the designer's words", async () => {
    generateImage.mockResolvedValueOnce("data:image/png;base64,BBBB");
    const spec = { ...DEFAULT_SPEC, closure: "zip" as const, cuff: "rib" as const, clothColor: "#224229" };
    const res = await post({ spec, images: [IMG, IMG], description: "like a work jacket" });
    const out = (await res.json()) as PreviewResult;
    expect(res.status).toBe(200);
    expect(out.image).toBe("data:image/png;base64,BBBB");
    const parts = generateImage.mock.calls[0][0] as { text?: string; inlineData?: unknown }[];
    expect(parts).toHaveLength(3);
    expect(parts[0].text).toMatch(/front zip/);
    expect(parts[0].text).toMatch(/ribbed knit cuffs/);
    expect(parts[0].text).toMatch(/#224229/);
    expect(parts[0].text).toMatch(/like a work jacket/);
  });

  it("sends the previous picture first when tweaking", async () => {
    generateImage.mockResolvedValueOnce("data:image/png;base64,BBBB");
    await post({ spec: DEFAULT_SPEC, images: [IMG], previous: "data:image/png;base64,PREV", instruction: "make it longer" });
    const parts = generateImage.mock.calls[0][0] as { text?: string; inlineData?: { data: string } }[];
    expect(parts).toHaveLength(3);
    expect(parts[1].inlineData?.data).toBe("PREV");
    expect(parts[0].text).toMatch(/previous version/);
    expect(parts[0].text).toMatch(/make it longer/);
  });

  it("shows features that were added to the pattern, such as a hood", async () => {
    generateImage.mockResolvedValue("data:image/png;base64,BBBB");
    await post({ spec: DEFAULT_SPEC, extras: ["add a hood"] });
    const withHood = (generateImage.mock.calls[0][0] as { text: string }[])[0].text;
    expect(withHood).toMatch(/must be clearly visible: add a hood/);
    await post({ spec: DEFAULT_SPEC });
    expect((generateImage.mock.calls[1][0] as { text: string }[])[0].text).not.toMatch(/must be clearly visible/);
  });

  it("works with no photos", async () => {
    generateImage.mockResolvedValueOnce("data:image/png;base64,BBBB");
    expect((await post({ spec: DEFAULT_SPEC })).status).toBe(200);
    expect(generateImage.mock.calls[0][0]).toHaveLength(1);
  });

  it("rejects a bad spec and bad images", async () => {
    expect((await post({ spec: { ...DEFAULT_SPEC, collar: "hood" } })).status).toBe(400);
    expect((await post({ spec: DEFAULT_SPEC, images: ["not-a-data-url"] })).status).toBe(400);
    expect(generateImage).not.toHaveBeenCalled();
  });

  it("reports a model failure as a 502", async () => {
    generateImage.mockRejectedValueOnce(new Error("no picture"));
    const res = await post({ spec: DEFAULT_SPEC });
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toMatch(/no picture/);
  });
});

describe("describeSpec", () => {
  it("covers every kind of pocket and closure in plain words", () => {
    const text = describeSpec({ ...DEFAULT_SPEC, chestPockets: 0, lowerPockets: "welt", lowerPocketFlap: true, closure: "snaps", closureCount: 4, collar: "band", hem: "curved", ease: "fitted" });
    expect(text).toMatch(/no chest pockets/);
    expect(text).toMatch(/slanted welt lower pockets with flaps/);
    expect(text).toMatch(/4 snaps down the front/);
    expect(text).toMatch(/band collar/);
    expect(text).toMatch(/curved hem/);
    expect(text).toMatch(/trim fit/);
  });
});
