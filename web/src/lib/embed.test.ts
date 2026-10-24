import { describe, expect, it } from "vitest";
import { cosine, garmentText, rankByVector, recipeText } from "./embed";
import { DEFAULT_KNIT, DEFAULT_SPEC } from "@/pattern/spec";

describe("embed helpers", () => {
  it("writes a garment as a sentence the search index can read", () => {
    const text = garmentText({
      garment: "hoodie",
      family: "knit",
      spec: { ...DEFAULT_KNIT, neck: "hooded", pocket: "kangaroo" },
      features: [{ id: "1", request: "add a zip pocket", ops: [], source: "template" }],
    });
    expect(text).toMatch(/hoodie/);
    expect(text).toMatch(/hood/);
    expect(text).toMatch(/zip pocket/);
  });

  it("a coat text is different from a skirt text", () => {
    const coat = garmentText({ family: "coat", spec: DEFAULT_SPEC });
    const knit = garmentText({ family: "knit", spec: DEFAULT_KNIT });
    expect(coat).not.toBe(knit);
  });

  it("ranks by cosine, highest first", () => {
    const q = [1, 0, 0];
    const ranked = rankByVector(q, [{ id: "a", embedding: [0.1, 1, 0] }, { id: "b", embedding: [0.9, 0, 0] }, { id: "c" }], 2);
    expect(ranked.map((d) => d.id)).toEqual(["b", "a"]);
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  it("cosine of a vector with itself is 1", () => {
    expect(cosine([3, 4], [3, 4])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it("recipe text includes the title and the keywords", () => {
    expect(recipeText({ title: "hood", explanation: "Add a hood.", keywords: ["hood", "cowl"] })).toMatch(/cowl/);
  });
});
