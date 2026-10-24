// Packs src/mobile/engine.ts into one script for the iPhone app (JavaScriptCore).
import { build } from "esbuild";
import { readFileSync } from "node:fs";

await build({
  entryPoints: ["src/mobile/engine.ts"],
  bundle: true,
  format: "iife",
  globalName: "SeamstressEngine",
  platform: "browser",
  target: "es2020",
  minify: true,
  banner: { js: readFileSync("src/mobile/polyfills.js", "utf8") },
  outfile: "../ios/Seamstress/Engine/engine.js",
  logLevel: "info",
});
