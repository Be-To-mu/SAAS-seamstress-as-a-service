import { describe, expect, it } from "vitest";
import { compose } from "@/pattern/compose";
import { FAMILY_IDS, SAMPLE_BODY, specKeys, specSchema } from "@/pattern/spec";
import { EXAMPLES, exampleAnswer } from "./examples";

describe("worked examples", () => {
  it("has unique ids and covers every family", () => {
    expect(new Set(EXAMPLES.map((e) => e.id)).size).toBe(EXAMPLES.length);
    for (const f of FAMILY_IDS) expect(EXAMPLES.filter((e) => e.family === f).length).toBeGreaterThanOrEqual(2);
    expect(EXAMPLES.some((e) => !e.fitsFamily)).toBe(true);
  });

  it.each(EXAMPLES.map((e) => [e.id, e] as const))("%s: a valid spec the pattern engine can build", (_id, ex) => {
    expect(specSchema.safeParse(ex.spec).success).toBe(true);
    expect(ex.spec.family).toBe(ex.family);
    const built = compose(ex.spec, SAMPLE_BODY, []);
    expect(built.check.ok, built.check.issues.map((i) => i.message).join("; ")).toBe(true);
  });

  it.each(EXAMPLES.map((e) => [e.id, e] as const))("%s: the answer has every field with confidence and a source", (_id, ex) => {
    const a = exampleAnswer(ex) as { spec: Record<string, unknown>; confidence: Record<string, number>; sources: Record<string, string> };
    for (const k of specKeys(ex.family)) {
      expect(a.spec[k], k).toBeDefined();
      expect(a.confidence[k], k).toBeGreaterThan(0);
      expect(a.sources[k], k).toBeTruthy();
    }
  });
});
