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

  it("asks for turnaround views and a try-on with the images attached", () => {
    const spec = E.defaultSpecFor("coat");
    const img = "data:image/jpeg;base64,AAAA";
    expect(E.viewAngles()).toEqual([0, 45, 90, 135, 180, 225, 270, 315]);
    const view = E.viewRequest({ spec, extras: [], front: img, angle: 180 });
    expect(view[0]).toMatchObject({ text: expect.stringContaining("straight from the back") });
    expect(view).toHaveLength(2);
    expect(E.tryOnRequest({ spec, person: img, garment: img })).toHaveLength(3);
  });

  it("asks for a mannequin from a photo and dresses it, with guide lines when given", () => {
    const img = "data:image/jpeg;base64,AAAA";
    expect(E.mannequinRequest({ photo: img, angle: 0 })).toHaveLength(2);
    const side = E.mannequinRequest({ photo: img, angle: 90, front: img });
    expect(side).toHaveLength(3);
    expect(side[0]).toMatchObject({ text: expect.stringContaining("arms hanging straight down") });
    expect(side[0]).toMatchObject({ text: expect.stringContaining("Show EXACTLY this mannequin") });
    expect(E.mannequinRequest({ photo: img, angle: 0, sex: "male" })[0]).toMatchObject({ text: expect.stringContaining("MUST have a male body") });
    const spec = E.defaultSpecFor("coat");
    const dressed = E.dressRequest({ spec, extras: [], mannequin: img, garment: img, garmentView: img, angle: 90, guides: { hem: true }, hemAt: "at the knee" });
    expect(dressed).toHaveLength(4);
    expect(dressed[0]).toMatchObject({ text: expect.stringContaining("falls at the knee, exactly on the RED line") });
    expect(dressed[0]).toMatchObject({ text: expect.stringContaining("Do not raise, spread or bend the arms") });
  });
  it("draws the picture from the look in words, not a generic jacket", () => {
    const spec = E.defaultSpecFor("coat");
    const [first] = E.pictureRequest({ spec, images: [], extras: [], look: "A cropped boxy jacket in mustard corduroy with a shearling collar." });
    expect(first).toMatchObject({ text: expect.stringContaining("mustard corduroy") });
    expect((first as { text: string }).text).not.toContain("jacket from the front");
  });
});
