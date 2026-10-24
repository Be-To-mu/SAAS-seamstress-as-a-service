# web: design → sewable 2D pattern

Turn photos and words into a fitted 2D sewing pattern for a coat, knit top (tee, sweatshirt, hoodie) or skirt. Body measurements come from the Body step: type them in, or paste the numbers from an iPhone scan (`bodyfit` / the iOS app).

This is the Encode London 2026 web app (Blazeres). It does not need the scan service to run.

## Run it

```sh
cd web
cp .env.example .env.local   # add GEMINI_API_KEY for live design; omit it for demo mode
npm install
npm test
npm run dev                  # http://localhost:3000
```

`GEMINI_MODEL` defaults to `gemini-4-argon` (Google DeepMind bounty).

## MongoDB Atlas

Add `MONGODB_URI` (and optionally `MONGODB_DB=saas`) to `.env.local`. The app then uses Atlas as the store for:

- **garments** — saved designs, with a Gemini embedding for Vector Search
- **recipes** — the verified feature recipes, ranked for the pattern-cutter prompt
- **bodies** — named measurement sets (typed in, or later pasted from a scan)

Without a URI the studio still runs; save and search stay off. Without the Atlas Search indexes, search falls back to cosine ranking of recent documents.

Optional indexes (Atlas → Search): `atlas/indexes.json`. They are 768-dimensional cosine vectors on `embedding`.

## What it does

1. **Body.** Chest, waist, hip, shoulder, neck, back length, arm, bicep, wrist. These set every piece. Save a named body to Atlas and load it later.
2. **Design.** Photos and/or a description. Gemini picks a garment family and fills a typed spec. Worked examples are in the prompt.
3. **Style.** Edit the spec by hand. Ready-made features (hood, yoke, colour-block hem, zip pocket) apply without a model call. Free-text features go through Gemini and a seam checker. Atlas ranks which recipes to show the model.
4. **Pattern.** Live SVG, seam report, 1:1 tiled PDF. Save the design to Atlas and search the library.

The picture is an illustration. The pattern comes from the spec and the added features, not from the picture.

## Tests

```sh
npm test
npm run typecheck
```
