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
  },
  minify: true,
  metafile: true,
  logLevel: "info",
});

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
  <link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
${cssTag}</head>
<body>
  <div id="root"></div>
  <script type="module" src="${assetPath(jsFile)}"></script>
</body>
</html>
`,
);
