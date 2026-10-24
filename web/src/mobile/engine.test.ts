import { describe, expect, it } from "vitest";
import * as E from "./engine";

describe("mobile engine", () => {
  it("composes every family for the sample body without errors", () => {
    for (const f of E.families()) {
      const c = E.compose(E.defaultSpecFor(f.id), E.sampleBody(), []);
      expect(c.garment.panels.length).toBeGreaterThan(0);
      expect(c.check.issues.filter((i) => i.severity === "error")).toEqual([]);
    }
  });

  it("offers ready-made features and a PDF", () => {
    const spec = E.defaultSpecFor("knit");
    expect(E.recipes(spec, E.sampleBody(), []).length).toBeGreaterThan(0);
    expect(E.patternPdf(spec, E.sampleBody(), [], "Tee").startsWith("JVBERi0")).toBe(true); // "%PDF-"
  });

  it("builds the same design request as the web route", () => {
    const r = E.designRequest({ images: [], description: "a navy hoodie" });
    expect(r.parts[0]).toMatchObject({ text: expect.stringContaining("a navy hoodie") });
  });
});
