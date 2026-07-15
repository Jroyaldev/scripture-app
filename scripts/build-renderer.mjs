import { mkdir, rm, writeFile } from "node:fs/promises";
import { relative } from "node:path";
import { build } from "esbuild";

const outDir = "dist/renderer";
const assetsDir = `${outDir}/assets`;

await rm(outDir, { recursive: true, force: true });
await mkdir(assetsDir, { recursive: true });

const result = await build({
  entryPoints: ["src/renderer/main.tsx"],
  bundle: true,
  outdir: assetsDir,
  entryNames: "index",
  assetNames: "[name]",
  format: "esm",
  target: "chrome134",
  jsx: "automatic",
  define: {
    "process.env.NODE_ENV": "\"production\"",
  },
  loader: {
    ".json": "json",
    ".png": "file",
  },
  minify: true,
  metafile: true,
  logLevel: "info",
});

// Hidden embedding-host renderer: transformers.js browser build (WASM).
// Runs model inference where Electron's V8 memory cage can't crash it.
const embedOutDir = "dist/embedding-host";
await rm(embedOutDir, { recursive: true, force: true });
await mkdir(embedOutDir, { recursive: true });
await build({
  entryPoints: ["src/embedding-host/host.ts"],
  bundle: true,
  outfile: `${embedOutDir}/host.js`,
  format: "esm",
  platform: "browser",
  target: "chrome134",
  // Node-only optional deps of transformers.js — never loaded in-browser.
  external: ["onnxruntime-node", "sharp", "node:*", "fs", "path", "url"],
  define: {
    "process.env.NODE_ENV": "\"production\"",
  },
  minify: true,
  logLevel: "info",
});
await writeFile(
  `${embedOutDir}/index.html`,
  `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <!-- 'wasm-unsafe-eval' for onnxruntime-web; https: connect for model/wasm
       downloads (HF hub + CDN redirects), cached in session storage after. -->
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'wasm-unsafe-eval' blob:; worker-src 'self' blob:; connect-src 'self' https: data:">
  <title>Embedding Host</title>
</head>
<body>
  <script type="module" src="./host.js"></script>
</body>
</html>
`,
);

const outputs = Object.keys(result.metafile.outputs);
const jsFile = outputs.find((output) => output.endsWith(".js") && output.includes("/assets/index"));
const cssFile = outputs.find((output) => output.endsWith(".css") && output.includes("/assets/index"));

if (!jsFile) {
  throw new Error("Renderer build did not emit an index JavaScript asset");
}

const assetPath = (file) => `./${relative(outDir, file).replaceAll("\\", "/")}`;
const cssTag = cssFile ? `  <link rel="stylesheet" href="${assetPath(cssFile)}">\n` : "";

await writeFile(
  `${outDir}/index.html`,
  `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'">
  <title>Scripture Library</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500;600&display=swap" rel="stylesheet">
${cssTag}</head>
<body>
  <div id="root"></div>
  <script type="module" src="${assetPath(jsFile)}"></script>
</body>
</html>
`,
);
