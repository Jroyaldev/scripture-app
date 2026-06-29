/**
 * Build script for the renderer (React app).
 * Bundles src/renderer/app.tsx → dist/renderer/app.js
 */

import * as esbuild from "esbuild";
import { cpSync } from "node:fs";
import { join } from "node:path";

const outDir = join(import.meta.dirname ?? ".", "../dist/renderer");

await esbuild.build({
  entryPoints: ["src/renderer/app.tsx"],
  bundle: true,
  outfile: join(outDir, "app.js"),
  platform: "browser",
  format: "iife",
  target: "chrome120",
  jsx: "automatic",
  jsxImportSource: "react",
  external: [],
  loader: { ".tsx": "tsx", ".ts": "ts" },
  define: {
    "process.env.NODE_ENV": '"production"',
  },
});

// Copy static assets
cpSync("src/renderer/index.html", join(outDir, "index.html"));
cpSync("src/renderer/styles.css", join(outDir, "styles.css"));
cpSync("src/renderer/design-tokens.json", join(outDir, "design-tokens.json"));

console.log("Renderer built successfully.");
