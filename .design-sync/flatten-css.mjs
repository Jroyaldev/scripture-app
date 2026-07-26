/**
 * Flatten src/renderer/styles.css into one file for design-sync.
 *
 * WHY THIS EXISTS. The app's stylesheet is a closure: styles.css `@import`s
 * ./fonts.css and eight files under ./styles/. The converter inlines the entry
 * stylesheet into _ds_bundle.css verbatim — @import lines included — but does
 * not copy the imported siblings, so validate reports nine
 * [CSS_IMPORT_MISSING] errors and rendered designs would get component CSS
 * with eight of its nine parts missing. cfg.tokensGlob cannot fix this: it
 * only copies from a node_modules package and emits into tokens/, while these
 * imports must resolve relative to the stylesheet itself.
 *
 * So we inline them ourselves, IN PLACE, preserving order — CSS cascade is
 * positional, and hoisting or reordering an import silently changes which rule
 * wins.
 *
 * Point cfg.cssEntry at the output. Re-run before every design-sync build; the
 * output is generated and gitignored, the script is durable and committed.
 *
 *   node .design-sync/flatten-css.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";

const ENTRY = "src/renderer/styles.css";
const OUT = ".design-sync/.cache/styles.flat.css";

const seen = new Set();
let inlined = 0;

function flatten(file) {
  const abs = resolve(file);
  if (seen.has(abs)) return `/* design-sync: ${relative(".", abs)} already inlined */\n`;
  seen.add(abs);
  if (!existsSync(abs)) throw new Error(`flatten-css: ${file} does not exist`);
  const src = readFileSync(abs, "utf8");
  const here = dirname(abs);

  // Only rewrite LOCAL relative imports. A remote @import url(...) must stay a
  // remote import — inlining one would need a network fetch at build time.
  return src.replace(
    /^[ \t]*@import\s+["']([^"']+)["']\s*;[ \t]*$/gm,
    (whole, spec) => {
      if (/^(https?:)?\/\//.test(spec) || spec.startsWith("url(")) return whole;
      inlined += 1;
      const target = resolve(here, spec);
      return `/* ─── design-sync inlined: ${relative(".", target)} ─── */\n${flatten(target)}`;
    },
  );
}

const out = flatten(ENTRY);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out);

// A flatten that inlines nothing means the import syntax changed and this
// script silently became a copy — fail loudly rather than ship a stub.
if (inlined === 0) {
  throw new Error(`flatten-css: inlined 0 imports from ${ENTRY} — the import syntax must have changed`);
}
console.error(`flatten-css: ${OUT} — ${inlined} import(s) inlined, ${out.length} bytes`);
