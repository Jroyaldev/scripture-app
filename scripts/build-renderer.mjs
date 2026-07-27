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
    // Publisher marks are bundled the same way faces are: emitted next to the
    // renderer, never fetched from the publisher. See
    // docs/trusted-resource-permissions.md.
    ".svg": "file",
    // Brand faces are vendored, not fetched — see scripts/vendor-fonts.mjs.
    ".woff2": "file",
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

/* This policy is also written in src/renderer/index.html, which is what the dev
   server serves. Two copies, and the one that ships is this one — a media host
   added only to the other looks correct and silently blocks. A test holds them
   equal. */
await writeFile(
  `${outDir}/index.html`,
  `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; media-src 'self' https://nakedbiblepodcast.com https://afp-597195-injected.calisto.simplecastaudio.com">
  <title>Pericope</title>
${cssTag}</head>
<body>
  <div id="root"></div>
  <script type="module" src="${assetPath(jsFile)}"></script>
</body>
</html>
`,
);
