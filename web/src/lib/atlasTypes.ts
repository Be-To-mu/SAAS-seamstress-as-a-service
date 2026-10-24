import type { Feature } from "@/pattern/features";
import type { FamilyId, Measurements, Spec } from "@/pattern/spec";

export interface SavedGarment {
  id: string;
  title: string;
  garment: string;
  family: FamilyId;
  description: string;
  spec: Spec;
  measurements: Measurements;
  features: Feature[];
  thumbnail: string | null;
  featureCount: number;
  check: { ok: boolean; errors: number; warnings: number };
  createdAt: string;
  score?: number;
}

export interface SavedBody {
  id: string;
  name: string;
  measurements: Measurements;
  source: "typed" | "scan";
  createdAt: string;
}
