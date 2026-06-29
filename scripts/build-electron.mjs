import { rm } from "node:fs/promises";
import { build } from "esbuild";

await rm("dist/electron", { recursive: true, force: true });

const common = {
  bundle: true,
  platform: "node",
  packages: "external",
  target: "node22",
  sourcemap: true,
  logLevel: "info",
};

await build({
  ...common,
  entryPoints: ["src/electron/main.ts"],
  outfile: "dist/electron/main.js",
  format: "esm",
});

await build({
  ...common,
  entryPoints: ["src/electron/preload.ts"],
  outfile: "dist/electron/preload.cjs",
  format: "cjs",
});
