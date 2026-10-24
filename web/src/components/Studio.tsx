"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Attempt, FeatureResponse } from "@/app/api/feature/route";
import type { ExtractResult } from "@/app/api/extract/route";
import type { PreviewResult } from "@/app/api/preview/route";
import { PatternView } from "@/components/PatternView";
import { DESIGN_MODES, MAX_REFERENCES, type DesignMode } from "@/lib/design";
import { buildPatternPdf } from "@/lib/pdf";
import { compose, type Composed } from "@/pattern/compose";
import type { Feature } from "@/pattern/features";
import { estimateFabric, layoutGarment } from "@/pattern/layout";
import { FAMILIES, familyOf } from "@/pattern/families";
import { pickRecipes, type Recipe } from "@/pattern/recipes";
import { DEFAULT_SPEC, SAMPLE_BODY, defaultSpec, specKeys, type FamilyId, type Measurements, type Spec } from "@/pattern/spec";

interface Photo {
  id: string;
  name: string;
  full: string;
  thumb: string;
}

type Tab = "body" | "design" | "pattern";
const TABS: { id: Tab; label: string }[] = [
  { id: "body", label: "Body" },
  { id: "design", label: "Design" },
  { id: "pattern", label: "Pattern" },
];

/** One picture the user has made on the way to a jacket they like. */
interface Version {
  id: string;
  label: string;
  spec: Spec;
  image: string;
}

const QUICK_TWEAKS: Record<FamilyId, string[]> = {
  coat: ["Make it longer", "More fitted", "Add flaps to the pockets", "Ribbed cuffs", "Darker colour"],
  knit: ["Make it longer", "Add a hood", "Ribbed cuffs", "More fitted", "Darker colour"],
  skirt: ["Make it longer", "Fuller skirt", "Add pockets", "Elastic waist", "Darker colour"],
};

interface Design {
  designMode: DesignMode | "refine";
  garment: string;
  /** False when the garment is something the blocks cannot really make, and the spec is only the closest shape. */
  fitsFamily: boolean;
  reason: string;
  notes: string;
  unsupported: string[];
}

interface Status {
  gemini: boolean;
  model: string | null;
  atlas: boolean;
}

async function shrink(file: File, max: number, quality: number): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

const MEASURE_FIELDS: { key: keyof Measurements; label: string; min: number; max: number }[] = [
  { key: "chest", label: "Chest", min: 70, max: 160 },
  { key: "waist", label: "Waist", min: 55, max: 150 },
  { key: "hip", label: "Hip", min: 75, max: 160 },
  { key: "shoulder", label: "Shoulder width", min: 34, max: 60 },
  { key: "neck", label: "Neck", min: 30, max: 50 },
  { key: "backLength", label: "Back length (nape to waist)", min: 35, max: 55 },
  { key: "armLength", label: "Arm (shoulder to wrist)", min: 50, max: 80 },
  { key: "bicep", label: "Bicep", min: 22, max: 50 },
];

function Confidence({ value, source }: { value: number | undefined; source?: string }) {
  if (value === undefined) return null;
  const low = value < 0.6;
  return (
    <>
      <span className={`conf ${low ? "low" : "high"}`}>{low ? `check · ${Math.round(value * 100)}%` : `${Math.round(value * 100)}%`}</span>
      {source && source !== "default" && source !== "unchanged" && <span className="src">{source}</span>}
    </>
  );
}

const designFrom = (data: ExtractResult): Design => ({
  designMode: data.designMode,
  garment: data.garment,
  fitsFamily: data.fitsFamily,
  reason: data.reason,
  notes: data.notes,
  unsupported: data.unsupported,
});

export function Studio() {
  const [spec, setSpec] = useState<Spec>(DEFAULT_SPEC);
  const [m, setM] = useState<Measurements>(SAMPLE_BODY);
  const [features, setFeaturesState] = useState<Feature[]>([]);
  // Several features can be added one after another inside one async function, so keep the latest list outside React's render cycle too.
  const featuresRef = useRef<Feature[]>([]);
  const setFeatures = (update: Feature[] | ((cur: Feature[]) => Feature[])) => {
    featuresRef.current = typeof update === "function" ? update(featuresRef.current) : update;
    setFeaturesState(featuresRef.current);
  };
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [confidence, setConfidence] = useState<Record<string, number> | null>(null);
  const [sources, setSources] = useState<Record<string, string> | null>(null);
  const [design, setDesign] = useState<Design | null>(null);
  const [description, setDescription] = useState("");
  const [pickedMode, setPickedMode] = useState<DesignMode | null>(null);
  const [tab, setTab] = useState<Tab>("body");
  const [versions, setVersions] = useState<Version[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tweak, setTweak] = useState("");
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<"extract" | "feature" | "save" | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [request, setRequest] = useState("");
  const [attempts, setAttempts] = useState<Attempt[] | null>(null);
  const [pdfPiece, setPdfPiece] = useState("all");

  useEffect(() => {
    fetch("/api/status").then((r) => r.json()).then(setStatus).catch(() => undefined);
  }, []);

  const composed = useMemo((): { ok: true; value: Composed } | { ok: false; error: string } => {
    try {
      return { ok: true, value: compose(spec, m, features) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Could not draft the pattern." };
    }
  }, [spec, m, features]);

  const layout = useMemo(() => (composed.ok ? layoutGarment(composed.value.garment) : null), [composed]);
  const fabric = useMemo(() => (composed.ok ? estimateFabric(composed.value.garment) : []), [composed]);

  // Ready-made recipes that fit this garment and are not already on it.
  const quickAdds = useMemo(() => {
    if (!composed.ok) return [];
    const have = new Set(features.map((f) => f.request.toLowerCase()));
    return pickRecipes("", composed.value.garment, spec, 8).filter((x) => !have.has(x.recipe.title.toLowerCase()));
  }, [composed, features, spec]);

  const errors = composed.ok ? composed.value.check.issues.filter((i) => i.severity === "error") : [];
  const warnings = composed.ok ? composed.value.check.issues.filter((i) => i.severity === "warn") : [];

  // With no photos there is nothing to copy or mix; with one photo there is nothing to mix.
  const mode: DesignMode = photos.length === 0 ? "invent" : photos.length === 1 ? (pickedMode === "invent" ? "invent" : "match") : (pickedMode ?? "mix");
  const canDesign = photos.length > 0 || description.trim().length > 0;

  async function onPhotos(files: FileList | null) {
    if (!files?.length) return;
    const room = MAX_REFERENCES - photos.length;
    const list = Array.from(files).slice(0, Math.max(0, room));
    if (files.length > room) setMessage({ kind: "err", text: `You can use up to ${MAX_REFERENCES} reference photos.` });
    try {
      const next: Photo[] = [];
      for (const f of list) {
        next.push({ id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, name: f.name, full: await shrink(f, 1024, 0.82), thumb: await shrink(f, 160, 0.7) });
      }
      setPhotos((cur) => [...cur, ...next]);
    } catch {
      setMessage({ kind: "err", text: "That photo could not be read. Try a JPEG or PNG." });
    }
  }

  const active = versions.find((v) => v.id === activeId) ?? null;
  const goTo = (t: Tab) => {
    setTab(t);
    window.scrollTo({ top: 0 });
  };

  /** Make a picture of `forSpec` and add it to the history. A tweak passes the picture it came from, so the look stays consistent. */
  async function makePicture(forSpec: Spec, opts: { label: string; previous?: string; instruction?: string; extras?: string[] }) {
    setPreviewBusy(true);
    setPreviewError("");
    try {
      const res = await fetch("/api/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spec: forSpec,
          images: photos.map((p) => p.full),
          description: description.trim() || undefined,
          previous: opts.previous,
          instruction: opts.instruction,
          // The picture must show the hood or zip that the pattern has.
          extras: opts.extras ?? featuresRef.current.map((f) => f.request),
        }),
      });
      const data = (await res.json()) as PreviewResult & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not make a picture.");
      const v: Version = { id: `v${Date.now().toString(36)}`, label: opts.label, spec: forSpec, image: data.image };
      setVersions((list) => [...list, v]);
      setActiveId(v.id);
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : "Could not make a picture.");
    } finally {
      setPreviewBusy(false);
    }
  }

  /** Go back to an earlier version: its picture and its form. */
  function restore(v: Version) {
    setActiveId(v.id);
    setSpec(v.spec);
  }

  /** Change the current jacket with a sentence, then show the new picture. */
  async function refine(instruction: string) {
    const text = instruction.trim();
    if (!text || busy !== null || previewBusy) return;
    setBusy("extract");
    setMessage(null);
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current: spec, description: text }),
      });
      const data = (await res.json()) as ExtractResult & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not change the jacket.");
      // Fields the model left alone keep their old confidence and source; the changed ones get the new ones.
      const keep = (key: string) => data.family === spec.family && data.sources[key] === "unchanged";
      const switched = data.family !== spec.family;
      if (switched) setFeatures([]); // pieces added to one kind of garment do not carry over to another
      setSpec(data.spec);
      const keys = specKeys(data.family);
      setConfidence((c) => Object.fromEntries(keys.map((k) => [k, keep(k) && c?.[k] !== undefined ? c[k] : data.confidence[k]])));
      setSources((s) => Object.fromEntries(keys.map((k) => [k, keep(k) && s?.[k] ? s[k] : data.sources[k]])));
      setDesign(designFrom(data));
      if (switched) setMessage({ kind: "ok", text: `Switched to ${FAMILIES[data.family].label.toLowerCase()}.` });
      setTweak("");
      // Things the form cannot say (a hood) go into the pattern too, and into the picture.
      const wanted = extrasToAdd(data.unsupported);
      if (data.mode === "gemini") {
        void makePicture(data.spec, { label: text, previous: active?.image, instruction: text, extras: [...featuresRef.current.map((f) => f.request), ...wanted] });
      }
      await addExtras(data.unsupported, wanted, data.spec);
    } catch (e) {
      setMessage({ kind: "err", text: e instanceof Error ? e.message : "Could not change the jacket." });
    } finally {
      setBusy(null);
    }
  }

  async function designIt() {
    setBusy("extract");
    setMessage(null);
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images: photos.map((p) => p.full), description: description.trim() || undefined, mode }),
      });
      const data = (await res.json()) as ExtractResult & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Design failed.");
      setSpec(data.spec);
      setConfidence(data.confidence);
      setSources(data.sources);
      if (data.family !== spec.family) setFeatures([]);
      setDesign(designFrom(data));
      if (!data.fitsFamily) {
        setMessage({ kind: "err", text: `A ${data.garment} is not something the app can pattern exactly. The closest block is "${FAMILIES[data.family].label}", shown below. ${data.notes}`.trim() });
      }
      // Show the finished jacket as a picture. It runs alongside, so the form is usable while it loads.
      const wanted = extrasToAdd(data.unsupported);
      if (data.mode === "gemini") {
        void makePicture(data.spec, { label: versions.length ? "New design" : "First design", extras: [...featuresRef.current.map((f) => f.request), ...wanted] });
      }
      await addExtras(data.unsupported, wanted, data.spec);
    } catch (e) {
      setMessage({ kind: "err", text: e instanceof Error ? e.message : "Extraction failed." });
    } finally {
      setBusy(null);
    }
  }

  /** Ask the model for one extra piece or change (a hood, a zip). Resolves with the feature, or with why it could not be added. */
  async function requestFeature(text: string, forSpec: Spec) {
    const res = await fetch("/api/feature", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spec: forSpec, measurements: m, features: featuresRef.current, request: text }),
    });
    const data = (await res.json()) as FeatureResponse & { error?: string };
    if (!res.ok) throw new Error(data.error ?? "Feature failed.");
    return data;
  }

  /** Extras the design asks for that are not already in the pattern. At most three, so one tweak cannot start a long chain of model calls. */
  function extrasToAdd(items: string[]): string[] {
    const have = featuresRef.current.map((f) => f.request.toLowerCase());
    return items.filter((i) => !have.includes(i.toLowerCase())).slice(0, 3);
  }

  /**
   * The form cannot express a hood or a side zip, so the design step lists them as "unsupported". Build them into the pattern
   * here, so the pattern matches the picture instead of silently leaving them out.
   */
  async function addExtras(all: string[], wanted: string[], forSpec: Spec) {
    const added: string[] = [];
    const failed: string[] = [];
    for (const item of wanted) {
      try {
        const data = await requestFeature(item, forSpec);
        if (data.ok && data.feature) {
          setFeatures((f) => [...f, data.feature!]);
          added.push(item);
        } else {
          failed.push(item);
        }
      } catch {
        failed.push(item);
      }
    }
    // Keep a chip only for what is still missing from the pattern.
    const left = all.filter((u) => !added.includes(u) && !featuresRef.current.some((f) => f.request.toLowerCase() === u.toLowerCase()));
    setDesign((d) => (d ? { ...d, unsupported: left } : d));
    if (added.length || failed.length) {
      setMessage(
        failed.length
          ? { kind: "err", text: `${added.length ? `Added to the pattern: ${added.join(", ")}. ` : ""}Could not draw: ${failed.join(", ")}. The picture shows it but the pattern does not.` }
          : { kind: "ok", text: `Added to the pattern: ${added.join(", ")}.` },
      );
    }
  }

  async function addFeature() {
    if (!request.trim()) return;
    setBusy("feature");
    setMessage(null);
    setAttempts(null);
    try {
      const data = await requestFeature(request, spec);
      setAttempts(data.attempts);
      if (data.ok && data.feature) {
        setFeatures((f) => [...f, data.feature!]);
        setRequest("");
        setMessage({ kind: "ok", text: `Added "${data.feature.request}" after ${data.attempts.length} ${data.attempts.length === 1 ? "try" : "tries"}.` });
        // Show it in the picture too, as a tweak of the current one.
        if (versions.length && status?.gemini) {
          void makePicture(spec, { label: data.feature.request, previous: active?.image, instruction: data.feature.request });
        }
      } else {
        setMessage({ kind: "err", text: data.message ?? "That feature could not be added." });
      }
    } catch (e) {
      setMessage({ kind: "err", text: e instanceof Error ? e.message : "Feature failed." });
    } finally {
      setBusy(null);
    }
  }

  async function downloadPdf() {
    if (!composed.ok) return;
    const doc = buildPatternPdf({
      composed: composed.value,
      spec,
      measurements: m,
      title: "Sewing pattern",
      only: pdfPiece === "all" ? undefined : [pdfPiece],
    });
    const name = pdfPiece === "all" ? `${spec.family}-pattern.pdf` : `${spec.family}-${pdfPiece}.pdf`;
    // On a phone, the share sheet is the easiest way to get the PDF to a computer or printer.
    const file = new File([doc.output("blob")], name, { type: "application/pdf" });
    if (window.matchMedia("(pointer: coarse)").matches && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "Sewing pattern" });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
      }
    }
    doc.save(name);
  }

  async function save() {
    if (!composed.ok) return;
    setBusy("save");
    setMessage(null);
    try {
      const res = await fetch("/api/garments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spec,
          measurements: m,
          features,
          notions: composed.value.garment.notions,
          fabric,
          check: { ok: composed.value.check.ok, errors: errors.length, warnings: warnings.length },
          thumbnails: photos.map((p) => p.thumb),
          confidence: confidence ?? undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed.");
      setMessage({ kind: "ok", text: `Saved to Atlas (${data.id}).` });
    } catch (e) {
      setMessage({ kind: "err", text: e instanceof Error ? e.message : "Save failed." });
    } finally {
      setBusy(null);
    }
  }

  function setSpecField(key: string, raw: string) {
    const field = familyOf(spec).fields.find((f) => f.key === key);
    let value: unknown = raw;
    if (field?.kind === "count" || field?.kind === "number") value = Number(raw);
    else if (field?.kind === "select") {
      if (field.options.includes("true") && field.options.includes("false")) value = raw === "true";
      else if (field.options.every((o) => /^\d+$/.test(o))) value = Number(raw);
    }
    setSpec((s) => ({ ...s, [key]: value }) as Spec);
    setConfidence((c) => (c ? { ...c, [key]: 1 } : c));
    setSources((s) => (s ? { ...s, [key]: "you" } : s));
  }

  /** Switch to a different kind of garment. Its form starts from that family's defaults, and pieces added to the old one are dropped. */
  function changeFamily(id: FamilyId) {
    if (id === spec.family) return;
    setSpec(defaultSpec(id));
    setFeatures([]);
    setConfidence(null);
    setSources(null);
    setDesign(null);
    setAttempts(null);
    setMessage({ kind: "ok", text: `Switched to ${FAMILIES[id].label.toLowerCase()}. Describe it or use the form, then press "Another take" for a picture.` });
  }

  /** Add a verified recipe straight away, with no model call. */
  function addRecipe(r: Recipe, ops: Feature["ops"]) {
    setFeatures((f) => [...f, { id: `recipe-${r.id}-${Date.now().toString(36)}`, request: r.title, ops, source: "template" }]);
    setAttempts(null);
    setMessage({ kind: "ok", text: `Added "${r.title}". ${r.explanation}` });
  }

  function tryAsFeature(text: string) {
    setRequest(text);
    document.getElementById("feature-input")?.focus();
  }

  return (
    <div className="shell" data-tab={tab}>
      {message && (
        <div className={`banner toast ${message.kind}`} role="status">
          {message.text}
          <button type="button" className="dismiss" aria-label="Dismiss" onClick={() => setMessage(null)}>
            ×
          </button>
        </div>
      )}
      <header className="topbar">
        <div className="brand">
          <h1>Blazeres</h1>
          {status && (
            <p className="modes">
              <span className={status.gemini ? "pill on" : "pill off"}>{status.gemini ? `Gemini: ${status.model}` : "Gemini: demo mode (no key)"}</span>
              <span className={status.atlas ? "pill on" : "pill off"}>{status.atlas ? "Atlas connected" : "Atlas: not configured"}</span>
            </p>
          )}
        </div>
        <nav className="steps" aria-label="Steps">
          {TABS.map((t, i) => (
            <button key={t.id} type="button" className={tab === t.id ? "on" : ""} aria-current={tab === t.id ? "step" : undefined} onClick={() => goTo(t.id)}>
              <span className="n">{i + 1}</span>
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <section className="screen t-body">
        <div className="card narrow">
          <h2>1. Your body</h2>
          <p className="note first">Start with the measurements. They set every dimension of every piece, so the pattern fits you whatever you design.</p>
          <div className="grid">
            {MEASURE_FIELDS.map((f) => (
              <label key={f.key} className="field">
                <span>{f.label} (cm)</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={f.min}
                  max={f.max}
                  step={0.5}
                  value={m[f.key] ?? ""}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) setM((cur) => ({ ...cur, [f.key]: v }));
                  }}
                />
              </label>
            ))}
          </div>
          <p className="note">Paste the numbers from your teammate&apos;s scan here. Tape-measure numbers are more accurate than a phone scan, so use them if you have them.</p>
          <button className="big" onClick={() => goTo("design")}>
            Next: design your garment →
          </button>
        </div>
      </section>

      <section className="screen t-design">
        <div className="design-grid">
          <div className={`stage${versions.length ? "" : " fresh"}`}>
            <h2>Your design</h2>
            <div className="picture">
              {active ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={active.image} alt="AI picture of the designed garment" className={previewBusy ? "dim" : ""} />
              ) : (
                <div className="placeholder">{previewBusy ? "Making a picture of your design…" : "Describe what you want or add photos, then press Design. Pictures show up here."}</div>
              )}
              {active && previewBusy && <span className="busy">Making the next picture…</span>}
              {!active && previewBusy && <span className="busy">Making picture…</span>}
            </div>
            {previewError && <p className="note err">{previewError}</p>}

            {versions.length > 0 && (
              <div className="versions" aria-label="Versions">
                {versions.map((v, i) => (
                  <button key={v.id} type="button" className={`version${v.id === activeId ? " on" : ""}`} title={v.label} onClick={() => restore(v)}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={v.image} alt={`Version ${i + 1}: ${v.label}`} />
                    <span>{i + 1}</span>
                  </button>
                ))}
              </div>
            )}
            {active && <p className="note">Version {versions.indexOf(active) + 1}: {active.label}. Tap an earlier one to go back to it.</p>}

            {versions.length > 0 && (
              <div className="tweak">
                <div className="row">
                  <input
                    type="text"
                    placeholder='Change something, e.g. "make it longer, in navy"'
                    value={tweak}
                    disabled={busy !== null || previewBusy}
                    onChange={(e) => setTweak(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && refine(tweak)}
                  />
                  <button disabled={!tweak.trim() || busy !== null || previewBusy} onClick={() => refine(tweak)}>
                    {busy === "extract" ? "Changing…" : "Change it"}
                  </button>
                </div>
                <div className="chips">
                  {QUICK_TWEAKS[spec.family].map((q) => (
                    <button key={q} type="button" className="chip" disabled={busy !== null || previewBusy} onClick={() => refine(q)}>
                      {q}
                    </button>
                  ))}
                </div>
                <button type="button" className="ghost" disabled={previewBusy || busy !== null} onClick={() => makePicture(spec, { label: "Another take", previous: undefined })}>
                  Another take on this design
                </button>
              </div>
            )}

            {design && (
              <div className="result">
                <p className="note first">
                  <strong>{design.garment}</strong> · pattern block: {familyOf(spec).label}
                  {!design.fitsFamily && " · closest match only"}
                </p>
                {design.reason && <p>{design.reason}</p>}
                {design.notes && <p className="note">{design.notes}</p>}
                {design.unsupported.length > 0 && (
                  <div className="unsupported">
                    <span className="note">The form cannot say these, and they are not in the pattern yet. Tap one to try adding it (some may not be possible):</span>
                    <div className="chips">
                      {design.unsupported.map((u) => (
                        <button key={u} type="button" className="chip" onClick={() => tryAsFeature(u)}>
                          {u}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <p className="note">The picture is an AI illustration. The pattern comes from the Style form and the added features, not from the picture.</p>
            <button className="big" onClick={() => goTo("pattern")}>
              I like it: make the pattern →
            </button>
          </div>

          <div className="controls">
        <section>
          <h2>2. Your idea</h2>
          <p className="note first">Add photos of clothes you like, describe what you want, or both. A coat, a tee or hoodie, or a skirt.</p>
          <div className="thumbs">
            {photos.map((p, i) => (
              <div key={p.id} className="thumb">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.thumb} alt={`Reference ${i + 1}`} />
                <span className="num">{i + 1}</span>
                <button type="button" className="x" aria-label={`Remove photo ${i + 1}`} onClick={() => setPhotos((cur) => cur.filter((x) => x.id !== p.id))}>
                  ×
                </button>
              </div>
            ))}
          </div>
          {photos.length < MAX_REFERENCES && (
            <div className="row wrap">
              <label className="btn ghost">
                Take photo
                <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => { onPhotos(e.target.files); e.target.value = ""; }} />
              </label>
              <label className="btn ghost">
                {photos.length ? "Add more" : "Choose photos"}
                <input type="file" accept="image/*" multiple hidden onChange={(e) => { onPhotos(e.target.files); e.target.value = ""; }} />
              </label>
            </div>
          )}
          <textarea
            className="desc"
            rows={3}
            maxLength={600}
            placeholder='Describe it, e.g. "a navy hoodie with a big front pocket" or "a red circle skirt, midi, elastic waist"'
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          {photos.length > 0 && (
            <div className="seg" role="radiogroup" aria-label="What to do with the photos">
              {DESIGN_MODES.map((d) => {
                const disabled = d.id === "mix" && photos.length < 2;
                return (
                  <button
                    key={d.id}
                    type="button"
                    role="radio"
                    aria-checked={mode === d.id}
                    disabled={disabled}
                    className={mode === d.id ? "on" : ""}
                    title={d.hint}
                    onClick={() => setPickedMode(d.id)}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          )}
          {photos.length > 0 && <p className="note">{DESIGN_MODES.find((d) => d.id === mode)?.hint}.</p>}
          <button className="big" disabled={!canDesign || busy !== null} onClick={designIt}>
            {busy === "extract" ? "Designing…" : mode === "invent" ? "Design it" : mode === "mix" ? "Mix into one design" : "Read this garment"}
          </button>
        </section>

        <section>
          <h2>3. Style</h2>
          <p className="note first">Edit any field by hand. Then press &ldquo;Another take&rdquo; to see a picture of it.</p>
          <div className="seg family" role="radiogroup" aria-label="Kind of garment">
            {Object.values(FAMILIES).map((f) => (
              <button key={f.id} type="button" role="radio" aria-checked={spec.family === f.id} className={spec.family === f.id ? "on" : ""} title={f.blurb} onClick={() => changeFamily(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
          <div className="grid">
            {familyOf(spec).fields.map((f) => {
              const value = (spec as unknown as Record<string, unknown>)[f.key];
              const zipFront = spec.family === "coat" && spec.closure === "zip";
              return (
                <label key={f.key} className="field">
                  <span>
                    {f.label} <Confidence value={confidence?.[f.key]} source={sources?.[f.key]} />
                  </span>
                  {f.kind === "color" ? (
                    <input type="color" value={String(value)} onChange={(e) => setSpecField(f.key, e.target.value)} />
                  ) : f.kind === "number" ? (
                    <span className="range">
                      <input type="range" min={f.min} max={f.max} step={0.01} value={Number(value)} onChange={(e) => setSpecField(f.key, e.target.value)} />
                      <em>{Number(value).toFixed(2)}</em>
                    </span>
                  ) : f.kind === "count" ? (
                    <input type="number" min={f.min} max={f.max} value={Number(value)} disabled={f.key === "closureCount" && zipFront} onChange={(e) => setSpecField(f.key, e.target.value)} />
                  ) : (
                    <select value={String(value)} onChange={(e) => setSpecField(f.key, e.target.value)}>
                      {f.options.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  )}
                </label>
              );
            })}
          </div>
        </section>

        <section>
          <h2>4. Add a feature</h2>
          <div className="row">
            <input
              id="feature-input"
              type="text"
              placeholder='e.g. "add a hood", "add a yoke" or "add a zipped pocket"'
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addFeature()}
            />
            <button disabled={!request.trim() || busy !== null} onClick={addFeature}>
              {busy === "feature" ? "Generating…" : "Generate"}
            </button>
          </div>
          {quickAdds.length > 0 && (
            <div className="quickadd">
              <span className="note">Ready-made, no AI needed:</span>
              <div className="chips">
                {quickAdds.map((x) => (
                  <button key={x.recipe.id} type="button" className="chip" disabled={busy !== null} title={x.recipe.explanation} onClick={() => addRecipe(x.recipe, x.ops)}>
                    + {x.recipe.title}
                  </button>
                ))}
              </div>
            </div>
          )}
          {attempts && (
            <ol className="attempts">
              {attempts.map((a, i) => (
                <li key={i} className={a.ok ? "pass" : "fail"}>
                  <strong>Try {i + 1}: {a.ok ? "passed the checks" : "rejected"}</strong>
                  {a.explanation && <div>{a.explanation}</div>}
                  {a.problems.map((p, j) => (
                    <div key={j} className="problem">
                      {p}
                    </div>
                  ))}
                </li>
              ))}
            </ol>
          )}
          {features.length > 0 && (
            <ul className="features">
              {features.map((f) => (
                <li key={f.id}>
                  <span>
                    {f.request} <small>({f.source}; applies to both sides)</small>
                  </span>
                  <button className="ghost" onClick={() => setFeatures((list) => list.filter((x) => x.id !== f.id))}>
                    remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
          </div>
        </div>
      </section>

      <section className="screen t-pattern">
        {active && (
          <div className="patternhead">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={active.image} alt="Your design" />
            <div>
              <strong>Your design</strong>
              <p className="note first">Fitted to your body measurements.</p>
              <button type="button" className="ghost" onClick={() => goTo("design")}>
                ← Keep designing
              </button>
            </div>
          </div>
        )}
        {!composed.ok && <div className="banner err">{composed.error}</div>}
        {composed.ok && composed.value.featureError && <div className="banner err">{composed.value.featureError}</div>}

        {composed.ok && layout && (
          <>
            <div className="toolbar">
              <div className={`badge ${errors.length === 0 ? "good" : "bad"}`}>
                {errors.length === 0
                  ? `Checks passed: ${composed.value.garment.panels.length} pieces closed, ${composed.value.garment.seams.length} seams match`
                  : `${errors.length} problem${errors.length === 1 ? "" : "s"}: do not cut`}
              </div>
              <div className="spacer" />
              <select
                className="pdfpick"
                value={composed.value.garment.panels.some((p) => p.id === pdfPiece) ? pdfPiece : "all"}
                onChange={(e) => setPdfPiece(e.target.value)}
                aria-label="Pieces to print"
              >
                <option value="all">All pieces</option>
                {composed.value.garment.panels.map((p) => (
                  <option key={p.id} value={p.id}>
                    Only: {p.name}
                  </option>
                ))}
              </select>
              <button onClick={downloadPdf} disabled={errors.length > 0}>
                Download 1:1 PDF
              </button>
              <button className="ghost" onClick={save} disabled={busy !== null || errors.length > 0}>
                {busy === "save" ? "Saving…" : "Save to Atlas"}
              </button>
            </div>

            <div className="stats">
              {composed.value.stats.map((x) => (
                <span key={x.label}>
                  {x.label} {x.value}
                </span>
              ))}
              <span>
                Fabric:{" "}
                {fabric.map((f) => `${f.fabric} ~${f.metres.toFixed(2)} m`).join(", ")}
              </span>
            </div>

            <PatternView layout={layout} issues={composed.value.check.issues} tint={spec.clothColor} />

            {(errors.length > 0 || warnings.length > 0) && (
              <ul className="issues">
                {errors.map((i, k) => (
                  <li key={`e${k}`} className="err">
                    {i.message}
                  </li>
                ))}
                {warnings.map((i, k) => (
                  <li key={`w${k}`} className="warn">
                    {i.message}
                  </li>
                ))}
              </ul>
            )}

            <div className="notions">
              <strong>Notions:</strong> {composed.value.garment.notions.map((n) => `${n.name} x${n.qty}`).join(" · ")}
            </div>
            <p className="note">
              The checks confirm every piece is closed and every seam matches its partner. They do not prove fit: make a toile before cutting good cloth.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
