import { z } from "zod";
import { familyOf } from "@/pattern/families";
import type { Spec } from "@/pattern/spec";

/** The form as a plain sentence, for the picture model. */
export function describeSpec(s: Spec): string {
  return familyOf(s).describe(s);
}

/** Most reference photos one design can use. */
export const MAX_REFERENCES = 5;

/**
 * match  - all photos show one jacket; copy it.
 * mix    - photos show different jackets; combine the best of each.
 * invent - make a new jacket, using photos and words as inspiration.
 */
export const designModeSchema = z.enum(["match", "mix", "invent"]);
export type DesignMode = z.infer<typeof designModeSchema>;

export const DESIGN_MODES: { id: DesignMode; label: string; hint: string }[] = [
  { id: "match", label: "Copy it", hint: "The photos show one jacket" },
  { id: "mix", label: "Mix them", hint: "Take the best of each photo" },
  { id: "invent", label: "New design", hint: "Use them as inspiration" },
];
