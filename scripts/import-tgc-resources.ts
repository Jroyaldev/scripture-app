/**
 * Build a trusted-resource manifest from The Gospel Coalition's public catalogue.
 *
 * TGC tags its content with a `scripture` taxonomy that is hierarchical and
 * chapter-level — `romans` is the parent of `romans-1` … `romans-16` — so the
 * passage evidence is the publisher's own, not something inferred from a title.
 * That is the whole reason this source is imported first: `publisher-scripture-tag`
 * is the strongest match basis the contract has, and here it needs no parsing.
 *
 * This runs offline and writes a manifest. Nothing here happens at runtime: D5
 * forbids the app fetching a publisher, and that stands.
 *
 * Usage:
 *   node --import tsx scripts/import-tgc-resources.ts [--out <path>] [--types a,b]
 *                                                     [--limit-pages N] [--delay-ms N]
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { validateTrustedResourceManifest } from "../src/core/resources/trusted-resources.js";
import { resolveManifestPath } from "./resource-import-target.js";
import type {
  TrustedResourceKind,
  TrustedResourceManifestV1,
  TrustedResourceRecordV1,
} from "../src/core/resources/trusted-resources.js";
import type { BackboneData } from "../src/core/reference/types.js";

const ROOT = resolve(import.meta.dirname, "..");
const API = "https://www.thegospelcoalition.org/wp-json/wp/v2";
const HOST = "www.thegospelcoalition.org";

/** TGC post type -> the kind our cards speak. */
const TYPES: Record<string, { restBase: string; kind: TrustedResourceKind }> = {
  sermon: { restBase: "sermon", kind: "sermon" },
  commentary: { restBase: "commentary", kind: "commentary" },
  "tgc-podcast": { restBase: "tgc-podcast", kind: "podcast" },
  article: { restBase: "article", kind: "article" },
};

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const requestedTypes = (arg("types") ?? "sermon,commentary,tgc-podcast").split(",").map((t) => t.trim());
const limitPages = Number(arg("limit-pages") ?? "0") || 0;
const delayMs = Number(arg("delay-ms") ?? "150");
const target = resolveManifestPath("the-gospel-coalition");
const outPath = arg("out") ?? target.path;

const backbone = JSON.parse(readFileSync(join(ROOT, "data/scripture/backbone.json"), "utf8")) as BackboneData;
const bookNames = JSON.parse(readFileSync(join(ROOT, "data/scripture/book-names-en.json"), "utf8")) as Record<string, string[]>;

/* ── book names ──────────────────────────────────────────────────────────── */

const normalise = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const byName = new Map<string, string>();
for (const [code, names] of Object.entries(bookNames)) {
  for (const name of names) byName.set(normalise(name), code);
  // TGC writes the Psalter as "Psalms"; several books get a plural or an "s".
  for (const name of names) byName.set(`${normalise(name)}s`, code);
}

const chaptersOf = (code: string): number[] =>
  (backbone.books as unknown as Record<string, { chapters: number[] }>)[code]?.chapters ?? [];

/**
 * A term name to a whole-chapter or whole-book coordinate.
 *
 * The taxonomy never carries verses, so every span here is the full extent of
 * what the publisher actually claimed — no narrower, which would invent
 * precision, and no wider, which would make the tag useless.
 */
function termToBref(name: string): string | null {
  const trimmed = name.trim();
  const match = /^(.*?)(?:\s+(\d+))?$/.exec(trimmed);
  if (!match) return null;
  const [, rawBook, rawChapter] = match;
  const code = byName.get(normalise(rawBook ?? ""));
  if (!code) return null;
  const chapters = chaptersOf(code);
  if (chapters.length === 0) return null;

  if (rawChapter) {
    const chapter = Number(rawChapter);
    const lastVerse = chapters[chapter - 1];
    if (!lastVerse) return null;
    return `bref:v1/${code}.${chapter}.1-${code}.${chapter}.${lastVerse}`;
  }
  return `bref:v1/${code}.1.1-${code}.${chapters.length}.${chapters[chapters.length - 1]}`;
}

/* ── fetching ────────────────────────────────────────────────────────────── */

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Say who we are. Node's fetch sends no agent and TGC refuses it, and the fix
 * for that is not to dress up as Chrome: a publisher reading their own logs
 * should be able to see exactly what asked and where to complain.
 */
const USER_AGENT = "Pericope/0.1 (+https://marktheword.com; trusted-resource importer)";

async function getPage(path: string, page: number, fields: string): Promise<{ rows: unknown[]; totalPages: number }> {
  const url = `${API}/${path}?per_page=100&page=${page}&_fields=${fields}`;
  const response = await fetch(url, { headers: { accept: "application/json", "user-agent": USER_AGENT } });
  if (!response.ok) throw new Error(`${url} -> ${response.status}`);
  const totalPages = Number(response.headers.get("x-wp-totalpages") ?? "1");
  return { rows: (await response.json()) as unknown[], totalPages };
}

async function getAll(path: string, fields: string, label: string): Promise<unknown[]> {
  const all: unknown[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const { rows, totalPages: pages } = await getPage(path, page, fields);
    totalPages = limitPages ? Math.min(pages, limitPages) : pages;
    all.push(...rows);
    process.stdout.write(`\r  ${label}: page ${page}/${totalPages}, ${all.length} records`);
    page += 1;
    if (page <= totalPages) await sleep(delayMs);
  } while (page <= totalPages);
  process.stdout.write("\n");
  return all;
}

const decode = (value: string): string =>
  value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#8217;|&rsquo;/g, "’").replace(/&#8216;|&lsquo;/g, "‘")
    .replace(/&#8220;|&ldquo;/g, "“").replace(/&#8221;|&rdquo;/g, "”")
    .replace(/&#8211;|&ndash;/g, "–").replace(/&#8212;|&mdash;/g, "—")
    .replace(/&nbsp;/g, " ").replace(/&hellip;/g, "…")
    .replace(/<[^>]*>/g, "")
    .trim();

/* ── build ───────────────────────────────────────────────────────────────── */

console.log(`Importing from ${HOST}`);
console.log(`  types: ${requestedTypes.join(", ")}${limitPages ? `  (capped at ${limitPages} pages each)` : ""}`);

const terms = await getAll("scripture", "id,name,slug,parent", "scripture terms");
const termBrefs = new Map<number, string>();
let unmappedTerms = 0;
for (const raw of terms) {
  const term = raw as { id: number; name: string };
  const bref = termToBref(decode(term.name));
  if (bref) termBrefs.set(term.id, bref);
  else unmappedTerms += 1;
}
console.log(`  mapped ${termBrefs.size}/${terms.length} scripture terms to coordinates`);

const records: TrustedResourceRecordV1[] = [];
const seenIds = new Set<string>();
const skipped = { noTag: 0, unmappedTag: 0, offHost: 0 };

for (const typeName of requestedTypes) {
  const type = TYPES[typeName];
  if (!type) {
    console.log(`  ! unknown type ${typeName}, skipping`);
    continue;
  }
  const rows = await getAll(type.restBase, "id,link,title,date,scripture", typeName);
  for (const raw of rows) {
    const row = raw as { id: number; link: string; title?: { rendered?: string }; date?: string; scripture?: number[] };
    const tags = row.scripture ?? [];
    if (tags.length === 0) { skipped.noTag += 1; continue; }
    const brefs = [...new Set(tags.map((id) => termBrefs.get(id)).filter((b): b is string => Boolean(b)))];
    if (brefs.length === 0) { skipped.unmappedTag += 1; continue; }
    let host = "";
    try { host = new URL(row.link).hostname; } catch { host = ""; }
    if (host !== HOST) { skipped.offHost += 1; continue; }

    const id = `the-gospel-coalition:${typeName}:${row.id}`;
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    const title = decode(row.title?.rendered ?? "").slice(0, 300);
    if (!title) continue;
    records.push({
      id,
      sourceId: "the-gospel-coalition",
      kind: type.kind,
      title,
      officialUrl: row.link,
      brefs,
      matchBasis: "publisher-scripture-tag",
      ...(row.date ? { metadata: { publishedAt: row.date.slice(0, 10), language: "en" } } : {}),
    });
  }
}

const manifest: TrustedResourceManifestV1 = {
  schema: "pericope.trusted-resource-manifest",
  version: 1,
  source: {
    id: "the-gospel-coalition",
    name: "The Gospel Coalition",
    homepageUrl: "https://www.thegospelcoalition.org/",
    officialHosts: [HOST],
  },
  provenance: {
    publisher: "The Gospel Coalition",
    reviewedAt: new Date().toISOString().slice(0, 10),
    coverage: "reviewed-sample",
    permissions: "outbound-link-only",
    note: `Imported from the publisher's public catalogue. Passage evidence is TGC's own scripture taxonomy, chapter-level, never inferred. ${records.length} records across ${requestedTypes.join(", ")}.`,
  },
  capabilities: ["outbound-link"],
  records,
};

// Refuse to write anything the app would refuse to load.
const validated = validateTrustedResourceManifest(manifest, backbone);
if (!validated.ok) {
  console.error(`\nFAIL: the built manifest does not validate: ${validated.error}`);
  process.exit(1);
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(validated.value, null, 2)}\n`);

console.log(`\n  records:        ${records.length}`);
console.log(`  skipped:        ${skipped.noTag} untagged, ${skipped.unmappedTag} unmappable tag, ${skipped.offHost} off-host`);
console.log(`  unmapped terms: ${unmappedTerms}`);
console.log(`  written:        ${outPath}${arg("out") ? "" : `  (library from ${target.from})`}`);
