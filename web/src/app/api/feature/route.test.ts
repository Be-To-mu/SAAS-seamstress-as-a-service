import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SPEC, SAMPLE_BODY } from "@/pattern/spec";
import { sideZipOps } from "@/pattern/features";

const askJson = vi.fn();
vi.mock("@/lib/gemini", () => ({
  geminiConfigured: () => true,
  geminiModelName: () => "mock-model",
  askJson: (...args: unknown[]) => askJson(...args),
}));

import { POST, type FeatureResponse } from "./route";

const call = async (request: string): Promise<FeatureResponse> => {
  const res = await POST(
    new Request("http://test/api/feature", {
      method: "POST",
      body: JSON.stringify({ spec: DEFAULT_SPEC, measurements: SAMPLE_BODY, features: [], request }),
    }),
  );
  return (await res.json()) as FeatureResponse;
};

beforeEach(() => askJson.mockReset());

describe("feature generation loop", () => {
  it("accepts a valid answer on the first try", async () => {
    askJson.mockResolvedValueOnce({ explanation: "zip", ops: sideZipOps() });
    const out = await call("add a side zip");
    expect(out.ok).toBe(true);
    expect(out.attempts).toHaveLength(1);
    expect(out.feature?.source).toBe("generated");
    expect(askJson).toHaveBeenCalledTimes(1);
  });

  it("repairs after an operation fails, and tells the model why", async () => {
    askJson
      .mockResolvedValueOnce({ explanation: "bad", ops: [{ op: "openSeam", seam: "left-side", from: 0.5, length: 0.3 }] })
      .mockResolvedValueOnce({ explanation: "fixed", ops: sideZipOps() });
    const out = await call("add a side zip");
    expect(out.ok).toBe(true);
    expect(out.attempts.map((a) => a.ok)).toEqual([false, true]);
    expect(out.attempts[0].problems[0]).toMatch(/Unknown seam "left-side"/);
    const secondPrompt = JSON.stringify(askJson.mock.calls[1][0]);
    expect(secondPrompt).toMatch(/left-side/);
    expect(secondPrompt).toMatch(/rejected by the checker/);
  });

  it("repairs after the checker rejects a result that applied cleanly", async () => {
    askJson
      .mockResolvedValueOnce({ explanation: "lengthen", ops: [{ op: "offsetEdge", panel: "back", edge: "hem", amount: 4 }] })
      .mockResolvedValueOnce({
        explanation: "lengthen both",
        ops: [
          { op: "offsetEdge", panel: "back", edge: "hem", amount: 4 },
          { op: "offsetEdge", panel: "front", edge: "hem", amount: 4 },
        ],
      });
    const out = await call("make it longer");
    expect(out.ok).toBe(true);
    expect(out.attempts[0].problems[0]).toMatch(/Seam "side"/);
    expect(out.attempts).toHaveLength(2);
  });

  it("repairs invalid JSON shapes", async () => {
    askJson.mockResolvedValueOnce({ ops: [{ op: "teleport" }] }).mockResolvedValueOnce({ ops: sideZipOps() });
    const out = await call("zip");
    expect(out.ok).toBe(true);
    expect(out.attempts[0].problems[0]).toMatch(/not valid/);
  });

  it("gives up after three tries and leaves the coat unchanged", async () => {
    askJson.mockResolvedValue({ explanation: "nope", ops: [{ op: "openSeam", seam: "ghost", from: 0.1, length: 0.5 }] });
    const out = await call("add a side zip");
    expect(out.ok).toBe(false);
    expect(out.feature).toBeUndefined();
    expect(out.attempts).toHaveLength(3);
    expect(askJson).toHaveBeenCalledTimes(3);
    expect(out.message).toMatch(/unchanged/);
  });

  it("survives the model call throwing", async () => {
    askJson.mockRejectedValueOnce(new Error("503 overloaded")).mockResolvedValueOnce({ ops: sideZipOps() });
    const out = await call("add a side zip");
    expect(out.ok).toBe(true);
    expect(out.attempts[0].problems[0]).toMatch(/503/);
  });
});
