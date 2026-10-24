import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compose } from "@/pattern/compose";
import { hoodOps, sideZipOps } from "@/pattern/features";
import { DEFAULT_SPEC, SAMPLE_BODY } from "@/pattern/spec";
import { buildPatternPdf } from "./pdf";

describe("pattern PDF", () => {
  it("builds a cover page plus tiled sheets at A4", () => {
    const composed = compose(DEFAULT_SPEC, SAMPLE_BODY, [{ id: "z", request: "side zip", ops: sideZipOps(), source: "template" }]);
    expect(composed.check.ok).toBe(true);
    const doc = buildPatternPdf({ composed, spec: DEFAULT_SPEC, measurements: SAMPLE_BODY, title: "Test coat" });
    const pages = doc.getNumberOfPages();
    expect(pages).toBeGreaterThan(4);
    expect(pages).toBeLessThan(45);
    const bytes = doc.output("arraybuffer");
    expect(bytes.byteLength).toBeGreaterThan(5000);
    const header = new TextDecoder().decode(new Uint8Array(bytes).slice(0, 5));
    expect(header).toBe("%PDF-");
    // one small piece should be a handful of sheets, not the whole coat
    const one = buildPatternPdf({ composed, spec: DEFAULT_SPEC, measurements: SAMPLE_BODY, title: "Test coat", only: ["pocket.chest"] });
    expect(one.getNumberOfPages()).toBeLessThanOrEqual(pages / 5);
    expect(one.getNumberOfPages()).toBeGreaterThanOrEqual(2);
    if (process.env.WRITE_PDF) {
      writeFileSync(process.env.WRITE_PDF.replace(".pdf", "-pocket.pdf"), new Uint8Array(one.output("arraybuffer")));
      writeFileSync(process.env.WRITE_PDF, new Uint8Array(bytes));
      console.log(`PDF written: ${pages} pages, ${(bytes.byteLength / 1024).toFixed(0)} KB`);
    }
  });

  it("prints a coat with a freely drawn hood, and the hood alone", () => {
    const features = [{ id: "h", request: "hood", ops: hoodOps(), source: "template" as const }];
    const composed = compose(DEFAULT_SPEC, SAMPLE_BODY, features);
    expect(composed.featureError).toBeUndefined();
    expect(composed.check.ok).toBe(true);
    expect(composed.garment.panels.some((p) => p.id === "hood")).toBe(true);
    const all = buildPatternPdf({ composed, spec: DEFAULT_SPEC, measurements: SAMPLE_BODY, title: "Hooded coat" });
    const hood = buildPatternPdf({ composed, spec: DEFAULT_SPEC, measurements: SAMPLE_BODY, title: "Hooded coat", only: ["hood"] });
    expect(all.getNumberOfPages()).toBeLessThan(55);
    // A 31 x 37 cm piece is a cover sheet plus a few A4 tiles.
    expect(hood.getNumberOfPages()).toBeGreaterThanOrEqual(3);
    expect(hood.getNumberOfPages()).toBeLessThanOrEqual(8);
  });
});
