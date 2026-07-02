import { rm } from "node:fs/promises";
import { build } from "esbuild";

await rm("dist/electron", { recursive: true, force: true });

const common = {
  bundle: true,
  platform: "node",
  packages: "external",
  target: "node22",  // Keep at node22 for Electron 35 compatibility (Electron 35 uses Node 22)
  sourcemap: true,
  logLevel: "info",
};

// In CJS format, esbuild polyfills import.meta.url as {} which breaks
// fileURLToPath(import.meta.url). Define it to the CJS equivalent so
// __dirname-derived paths resolve correctly.
const cjsBanner = {
  js: "const __import_meta_url = require('url').pathToFileURL(__filename).href;",
};
const cjsDefine = {
  "import.meta.url": "__import_meta_url",
};

await build({
  ...common,
  entryPoints: ["src/electron/main.ts"],
  outfile: "dist/electron/main.cjs",
  format: "cjs",
  banner: cjsBanner,
  define: cjsDefine,
});

await build({
  ...common,
  entryPoints: ["src/electron/preload.ts"],
  outfile: "dist/electron/preload.cjs",
  format: "cjs",
});
