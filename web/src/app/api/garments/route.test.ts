import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SPEC, SAMPLE_BODY } from "@/pattern/spec";

const insertOne = vi.fn();
const findGarments = vi.fn();
const readyAtlas = vi.fn();
const embed = vi.fn();

vi.mock("@/lib/mongo", () => ({
  mongoConfigured: () => true,
  garmentsCol: async () => ({ insertOne }),
}));
vi.mock("@/lib/atlas", async () => {
  const { publicGarment, garmentText, garmentTitle } = await vi.importActual<typeof import("@/lib/atlas")>("@/lib/atlas");
  return { findGarments, readyAtlas, publicGarment, garmentText, garmentTitle };
});
vi.mock("@/lib/embed", async () => {
  const actual = await vi.importActual<typeof import("@/lib/embed")>("@/lib/embed");
  return { ...actual, embed };
});

import { GET, POST } from "./route";

beforeEach(() => {
  insertOne.mockReset();
  findGarments.mockReset();
  readyAtlas.mockReset().mockResolvedValue({ ok: true });
  embed.mockReset().mockResolvedValue([1, 0, 0]);
});

describe("garments API", () => {
  it("saves a valid coat with an embedding", async () => {
    insertOne.mockResolvedValueOnce({ insertedId: { toString: () => "abc" } });
    const res = await POST(
      new Request("http://test/api/garments", {
        method: "POST",
        body: JSON.stringify({
          spec: DEFAULT_SPEC,
          measurements: SAMPLE_BODY,
          features: [],
          notions: [],
          fabric: [],
          check: { ok: true, errors: 0, warnings: 0 },
          garment: "chore coat",
        }),
      }),
    );
    const out = await res.json();
    expect(res.status).toBe(200);
    expect(out.id).toBe("abc");
    expect(out.embedded).toBe(true);
    expect(insertOne.mock.calls[0][0].family).toBe("coat");
    expect(insertOne.mock.calls[0][0].embedding).toEqual([1, 0, 0]);
    expect(insertOne.mock.calls[0][0].description).toMatch(/chore coat|workwear/);
  });

  it("rejects a spec from the wrong family shape", async () => {
    const res = await POST(
      new Request("http://test/api/garments", {
        method: "POST",
        body: JSON.stringify({ spec: { family: "coat" }, measurements: SAMPLE_BODY, features: [], check: { ok: true, errors: 0, warnings: 0 } }),
      }),
    );
    expect(res.status).toBe(400);
    expect(insertOne).not.toHaveBeenCalled();
  });

  it("lists and searches through findGarments", async () => {
    findGarments.mockResolvedValueOnce({ items: [{ id: "1", title: "hoodie" }], via: "vector" });
    const out = await (await GET(new Request("http://test/api/garments?q=hoodie"))).json();
    expect(out.via).toBe("vector");
    expect(out.items[0].title).toBe("hoodie");
    expect(findGarments.mock.calls[0][0].q).toBe("hoodie");
  });
});
