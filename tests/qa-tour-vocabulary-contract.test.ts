/**
 * The cheap thing that looks at the tours.
 *
 * The QA tours in `scripts/qa-*.mjs` are the app's only end-to-end
 * verification, and they are not part of `npm test` — they want Electron on a
 * debugging port and a real library, so nobody runs them casually and nothing
 * noticed when they rotted. Several were retargeted by hands that could not
 * run them.
 *
 * The worst of the rot is silent. A `waitFor` gated on a state the components
 * cannot emit does not fail: it spins to its timeout, and everything below it
 * never runs. A hanging tour reads exactly like a slow one.
 *
 * This test needs no Electron, no library and no port. It asserts two things:
 *
 *   1. `scripts/qa-support/app-vocabulary.mjs` still describes the renderer —
 *      so the table the tours trust cannot drift away from the app.
 *   2. No tour gates on a value outside that table, and no tour names a
 *      retired one — so the hang cannot be reintroduced by a hand that cannot
 *      run what it is editing.
 *
 * `KNOWN_UNREACHABLE` is the quarantine for rot that predates this test and is
 * too deep to repair by reading alone. It is asserted to be *exact*: fixing a
 * quarantined tour fails this test until its entry is deleted, so the list can
 * only shrink.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

import {
  ATTRIBUTE_VOCABULARY,
  RETIRED_VOCABULARY,
  extractAttributeGates,
} from "../scripts/qa-support/app-vocabulary.mjs";

const repoRoot = resolve(import.meta.dirname, "..");
const scriptsDir = resolve(repoRoot, "scripts");

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf8");
}

function tourFiles(): string[] {
  return readdirSync(scriptsDir)
    .filter((name) => name.startsWith("qa-") && name.endsWith(".mjs"))
    .sort();
}

/**
 * Tours whose gates name states the app cannot reach, left failing-loud rather
 * than guessed at. Each entry is `file :: attribute="value"`.
 *
 * These all belong to surfaces that were rebuilt underneath the tour, so the
 * right value cannot be derived by reading — the tour has to be rewritten
 * against the surface that exists now, by someone who can run it.
 */
const KNOWN_UNREACHABLE: ReadonlySet<string> = new Set([
  // The Dock was rebuilt as a single context area that swaps its contents.
  // `data-dock-state` has no "armed": the states are busy / session / feedback
  // / choices / selection / rest. Nine gates wait for a tenth that never comes.
  'qa-marking-dock.mjs :: data-dock-state="armed"',
  // `data-dock-action` is emitted once, on the failure state's Retry button.
  // There is no erase or note action carrying it any more.
  'qa-marking-dock.mjs :: data-dock-action="erase"',
  'qa-marking-dock.mjs :: data-dock-action="note"',
  // ConnectionUnderlay emits selection / authoring / selected / needs-space.
  'qa-marking-dock.mjs :: data-paint-state="dormant"',
  'qa-connection-paint.mjs :: data-paint-state="dormant"',
  'qa-connection-paint.mjs :: data-paint-state="preview"',
  'qa-connection-paint.mjs :: data-paint-state="companion"',
]);

test("the QA vocabulary still describes the renderer", () => {
  const theme = read("src/renderer/theme.ts");
  const themeUnion = /export type AppTheme =([^;]+);/.exec(theme);
  assert.ok(themeUnion, "src/renderer/theme.ts must declare AppTheme");
  const themes = [...themeUnion[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(
    [...ATTRIBUTE_VOCABULARY["data-theme"].values].sort(),
    [...themes].sort(),
    "the atmospheres in app-vocabulary.mjs drifted from AppTheme",
  );
  assert.deepEqual(
    [...ATTRIBUTE_VOCABULARY["data-theme-id"].values].sort(),
    [...themes].sort(),
    "the picker's theme ids drifted from AppTheme",
  );

  const kinds = read("src/core/annotations/types.ts");
  const kindBlock = /export const CONNECTION_KINDS = \[([\s\S]*?)\] as const;/.exec(kinds);
  assert.ok(kindBlock, "src/core/annotations/types.ts must declare CONNECTION_KINDS");
  const connectionKinds = [...kindBlock[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(
    [...ATTRIBUTE_VOCABULARY["data-relationship-kind"].values].sort(),
    [...connectionKinds].sort(),
    "the relationship kinds in app-vocabulary.mjs drifted from CONNECTION_KINDS",
  );

  const marking = read("src/renderer/components/MarkingSurface.tsx");
  const surfaceUnion = /export type SurfaceStateId =([\s\S]*?);/.exec(marking);
  assert.ok(surfaceUnion, "MarkingSurface.tsx must declare SurfaceStateId");
  const surfaceStates = [...surfaceUnion[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(
    [...ATTRIBUTE_VOCABULARY["data-surface-state"].values].sort(),
    [...surfaceStates].sort(),
    "the surface states in app-vocabulary.mjs drifted from SurfaceStateId",
  );

  const pigmentUnion = /type PigmentId =([^;]+);/.exec(marking);
  assert.ok(pigmentUnion, "MarkingSurface.tsx must declare PigmentId");
  const pigments = [...pigmentUnion[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(
    [...ATTRIBUTE_VOCABULARY["data-pigment"].values].sort(),
    [...pigments].sort(),
    "the pigments in app-vocabulary.mjs drifted from PigmentId",
  );

  const shapeUnion = /export type QueryShape =([^;]+);/.exec(
    read("src/renderer/components/CommandPalette.tsx"),
  );
  assert.ok(shapeUnion, "CommandPalette.tsx must declare QueryShape");
  const shapes = [...shapeUnion[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(
    [...ATTRIBUTE_VOCABULARY["data-shape"].values].sort(),
    ["resting", ...shapes].sort(),
    "the palette shapes in app-vocabulary.mjs drifted from QueryShape",
  );
});

test("every literal data attribute the renderer emits is in the vocabulary", () => {
  // The reverse direction of the check above: catch a component that grows a
  // state the table has never heard of, which would let a tour gate on it and
  // then be told, wrongly, that its gate is unreachable.
  const componentDir = resolve(repoRoot, "src/renderer/components");
  const sources = readdirSync(componentDir)
    .filter((name) => name.endsWith(".tsx"))
    .map((name) => readFileSync(resolve(componentDir, name), "utf8"))
    .concat(read("src/renderer/app.tsx"));
  const strays: string[] = [];
  for (const source of sources) {
    for (const match of source.matchAll(/(data-[\w-]+)="([^"{}]*)"/g)) {
      const [, attribute, value] = match;
      const governed = ATTRIBUTE_VOCABULARY[attribute as keyof typeof ATTRIBUTE_VOCABULARY];
      if (!governed) continue;
      if (governed.values.includes(value)) continue;
      strays.push(`${attribute}="${value}"`);
    }
  }
  assert.deepEqual(
    [...new Set(strays)].sort(),
    [],
    "a component emits a value app-vocabulary.mjs does not list — add it there in this commit",
  );
});

test("no QA tour waits for a state the app cannot emit", () => {
  const found = new Set<string>();
  const detail: string[] = [];
  for (const file of tourFiles()) {
    const lines = readFileSync(resolve(scriptsDir, file), "utf8").split("\n");
    lines.forEach((line, index) => {
      for (const { attribute, value } of extractAttributeGates(line)) {
        const governed = ATTRIBUTE_VOCABULARY[attribute as keyof typeof ATTRIBUTE_VOCABULARY];
        if (!governed) continue;
        if (governed.values.includes(value)) return;
        const key = `${file} :: ${attribute}="${value}"`;
        found.add(key);
        if (!KNOWN_UNREACHABLE.has(key)) {
          detail.push(
            `${file}:${index + 1} gates on ${attribute}="${value}". `
            + `${attribute} is one of: ${governed.values.join(", ")}. `
            + `Emitted by ${governed.source}.`,
          );
        }
      }
    });
  }
  assert.deepEqual(
    detail,
    [],
    "a tour gates on a state that cannot happen — it would hang, not fail:\n" + detail.join("\n"),
  );

  const healed = [...KNOWN_UNREACHABLE].filter((key) => !found.has(key)).sort();
  assert.deepEqual(
    healed,
    [],
    "these quarantined gates are fixed — delete them from KNOWN_UNREACHABLE:\n" + healed.join("\n"),
  );
});

/**
 * Regex literals in OUTER JavaScript that carry `\\d`, `\\s`, `\\.`.
 *
 * Inside a template bound for `evaluate()`, `\\s` is right: the template yields
 * `\s` in the page. In outer JS it means a literal backslash followed by `s`,
 * so the assertion can never match — against a correctly working app it throws,
 * and against a broken one it also throws, which makes it useless in both
 * directions. Five of these shipped because nothing outside Electron ever read
 * the tours.
 *
 * Scans with quote/template/comment state so the answer is about syntax rather
 * than how a line looks.
 */
function overEscapedOuterRegexes(source: string): Array<{ line: number; body: string }> {
  const findings: Array<{ line: number; body: string }> = [];
  let i = 0, line = 1, prev = "";
  const n = source.length;
  while (i < n) {
    const c = source[i];
    if (c === "\n") { line += 1; i += 1; continue; }
    if (c === "/" && source[i + 1] === "/") { while (i < n && source[i] !== "\n") i += 1; continue; }
    if (c === "/" && source[i + 1] === "*") {
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) { if (source[i] === "\n") line += 1; i += 1; }
      i += 2; continue;
    }
    if (c === '"' || c === "'") {
      const quote = c; i += 1;
      while (i < n && source[i] !== quote) { if (source[i] === "\\") i += 1; i += 1; }
      i += 1; prev = "str"; continue;
    }
    if (c === "`") {
      i += 1;
      let braces = 0;
      while (i < n) {
        if (source[i] === "\\") { i += 2; continue; }
        if (source[i] === "\n") line += 1;
        if (source[i] === "$" && source[i + 1] === "{") { braces += 1; i += 2; continue; }
        if (braces > 0 && source[i] === "}") { braces -= 1; i += 1; continue; }
        if (braces === 0 && source[i] === "`") break;
        i += 1;
      }
      i += 1; prev = "str"; continue;
    }
    if (c === "/" && !["ident", "num", "str", ")", "]"].includes(prev)) {
      const start = i, startLine = line;
      i += 1;
      let inClass = false;
      while (i < n) {
        const d = source[i];
        if (d === "\\") { i += 2; continue; }
        if (d === "[") inClass = true;
        else if (d === "]") inClass = false;
        else if (d === "/" && !inClass) break;
        else if (d === "\n") { i = start; break; }
        i += 1;
      }
      if (i > start && source[i] === "/") {
        const body = source.slice(start, i + 1);
        if (/\\\\[dswDSWbB.+*?()[\]{}|^$/-]/.test(body)) findings.push({ line: startLine, body });
        i += 1;
        while (i < n && /[gimsuy]/.test(source[i])) i += 1;
        prev = ")"; continue;
      }
      i = start + 1; prev = "op"; continue;
    }
    if (/[A-Za-z_$]/.test(c)) { while (i < n && /[\w$]/.test(source[i])) i += 1; prev = "ident"; continue; }
    if (/[0-9]/.test(c)) { while (i < n && /[\d.]/.test(source[i])) i += 1; prev = "num"; continue; }
    if (c === ")" || c === "]") { prev = c; i += 1; continue; }
    if (!/\s/.test(c)) prev = "op";
    i += 1;
  }
  return findings;
}

test("the over-escape detector itself works", () => {
  // A detector that silently matches nothing would report a clean tree forever,
  // which is the same fail-open shape it exists to catch. Prove both directions.
  const positives = String.raw`assert.match(s, /^You have not written .*\\.$/);` + "\n"
    + String.raw`const n = v.match(/[\\d.]+/g);`;
  assert.equal(overEscapedOuterRegexes(positives).length, 2, "the detector missed a known over-escape");

  const negatives = "await evaluate(`x?.textContent?.replace(/\\\\s+/g, \" \")`);\n"
    + String.raw`assert.match(s, /^You have not written .+\.$/);` + "\n"
    + "// a comment mentioning /\\\\d/ should not count\n";
  assert.deepEqual(
    overEscapedOuterRegexes(negatives),
    [],
    "the detector flagged a template-bound or correct regex",
  );
});

test("no QA tour over-escapes a regex in outer JavaScript", () => {
  const offenders: string[] = [];
  for (const file of tourFiles()) {
    for (const finding of overEscapedOuterRegexes(readFileSync(resolve(scriptsDir, file), "utf8"))) {
      offenders.push(
        `${file}:${finding.line} ${finding.body} — outside an evaluate() template, `
        + String.raw`\\d means a literal backslash. This can never match.`,
      );
    }
  }
  assert.deepEqual(offenders, [], "over-escaped regex literals in outer JS:\n" + offenders.join("\n"));
});

test("no QA tour names a retired atmosphere", () => {
  const offenders: string[] = [];
  for (const file of tourFiles()) {
    const lines = readFileSync(resolve(scriptsDir, file), "utf8").split("\n");
    lines.forEach((line, index) => {
      for (const [retired, guidance] of Object.entries(RETIRED_VOCABULARY)) {
        // Only string literals: the tours carry prose about why these went.
        const literal = new RegExp(`["'\`]${retired}["'\`]`);
        if (literal.test(line)) offenders.push(`${file}:${index + 1} names "${retired}" — ${guidance}`);
      }
    });
  }
  assert.deepEqual(offenders, [], "a tour drives an atmosphere the picker does not offer:\n" + offenders.join("\n"));
});
