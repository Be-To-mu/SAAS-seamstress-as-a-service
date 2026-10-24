// All lengths are centimetres. y points down (screen convention).

export interface Pt {
  x: number;
  y: number;
}

/** One side of a panel outline. Edges chain end to start to form a closed loop. */
export interface Edge {
  id: string;
  pts: Pt[];
  /** Seam / hem allowance added outside this edge when cutting, in cm. */
  allowance: number;
  kind?: "fold";
}

export type MarkKind = "notch" | "slit" | "placement" | "line" | "button" | "label";

export interface Mark {
  id: string;
  kind: MarkKind;
  pts: Pt[];
  label?: string;
}

export type Fabric = "shell" | "contrast" | "lining";

export interface Panel {
  id: string;
  name: string;
  edges: Edge[];
  marks: Mark[];
  cut: { count: number; mirror: boolean; onFold: boolean };
  fabric: Fabric;
  /** Grain line, two points. */
  grain: Pt[];
}

export type Ref = { panel: string; edge: string } | { panel: string; mark: string };

/**
 * A seam says: the edges on side `a` are sewn to the edges on side `b`.
 * `ease` is the allowed (length of b minus length of a), in cm.
 */
export interface Seam {
  id: string;
  a: Ref[];
  b: Ref[];
  ease: [number, number];
  kind: "sewn" | "zip";
}

export interface Notion {
  name: string;
  qty: number;
  unit: string;
}

export interface Garment {
  panels: Panel[];
  seams: Seam[];
  notions: Notion[];
}

export interface Issue {
  severity: "error" | "warn";
  code: string;
  message: string;
  panel?: string;
}

export interface CheckResult {
  ok: boolean;
  issues: Issue[];
}
