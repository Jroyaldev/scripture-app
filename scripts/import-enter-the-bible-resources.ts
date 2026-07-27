/**
 * Build a trusted-resource manifest from Enter the Bible's public catalogue.
 *
 * Their `passage` type is the whole reason to import this source: each record
 * carries a `verse` field holding a plain reference — "Ecclesiastes 1:2-11" —
 * so the coordinates are stated by the publisher and merely parsed, not guessed
 * from prose. 299 of 300 sampled parse; the one that did not was empty.
 *
 * Their other types are deliberately left out. Audio, video, glossary, maps and
 * time periods are tagged to a whole book and nothing finer, so every one would
 * become a whole-book coordinate: 744 records that rank below any chapter-level
 * card and would never surface, carrying weight without carrying answers.
 *
 * Offline, by hand, catalogue metadata only. See docs/trusted-resource-permissions.
 *
 * Usage:
 *   node --import tsx scripts/import-enter-the-bible-resources.ts
 *        [--out <path>] [--limit-pages N] [--delay-ms N]
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { extractWorkingPreacherTitlePassages } from "../src/core/resources/working-preacher.js";
import { validateTrustedResourceManifest } from "../src/core/resources/trusted-resources.js";
import { resolveManifestPath } from "./resource-import-target.js";
import type {
  TrustedResourceManifestV1,
  TrustedResourceRecordV1,
} from "../src/core/resources/trusted-resources.js";
import type { BackboneData, BookNameMap } from "../src/core/reference/types.js";

const ROOT = resolve(import.meta.dirname, "..");
const API = "https://enterthebible.org/wp-json/wp/v2";
const HOST = "enterthebible.org";
const USER_AGENT = "Pericope/0.1 (+https://marktheword.com; trusted-resource importer)";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const limitPages = Number(arg("limit-pages") ?? "0") || 0;
const delayMs = Number(arg("delay-ms") ?? "150");
const target = resolveManifestPath("enter-the-bible");
const outPath = arg("out") ?? target.path;

const backbone = JSON.parse(readFileSync(join(ROOT, "data/scripture/backbone.json"), "utf8")) as BackboneData;
const bookNames = JSON.parse(readFileSync(join(ROOT, "data/scripture/book-names-en.json"), "utf8")) as BookNameMap;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function getAll(path: string, fields: string, label: string): Promise<unknown[]> {
  const all: unknown[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const url = `${API}/${path}?per_page=100&page=${page}&_fields=${fields}`;
    const response = await fetch(url, { headers: { accept: "application/json", "user-agent": USER_AGENT } });
    if (!response.ok) throw new Error(`${url} -> ${response.status}`);
    const pages = Number(response.headers.get("x-wp-totalpages") ?? "1");
    totalPages = limitPages ? Math.min(pages, limitPages) : pages;
    all.push(...((await response.json()) as unknown[]));
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
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#8217;|&rsquo;/g, "’").replace(/&#8216;|&lsquo;/g, "‘")
    .replace(/&#8220;|&ldquo;/g, "“").replace(/&#8221;|&rdquo;/g, "”")
    .replace(/&#8211;|&ndash;/g, "–").replace(/&#8212;|&mdash;/g, "—")
    .replace(/&nbsp;/g, " ").replace(/&hellip;/g, "…").replace(/<[^>]*>/g, "")
    .trim();

console.log(`Importing from ${HOST}`);

const rows = await getAll("passage", "id,link,title,date,verse", "passages");

const records: TrustedResourceRecordV1[] = [];
const seen = new Set<string>();
const skipped = { noVerse: 0, unparsed: 0, offHost: 0 };

for (const raw of rows) {
  const row = raw as { id: number; link: string; title?: { rendered?: string }; date?: string; verse?: unknown };
  const title = decode(row.title?.rendered ?? "");
  if (!title) continue;
  let host = ""; try { host = new URL(row.link).hostname; } catch { host = ""; }
  if (host !== HOST) { skipped.offHost += 1; continue; }

  const verse = typeof row.verse === "string" ? decode(row.verse) : "";
  if (!verse) { skipped.noVerse += 1; continue; }
  const parsed = extractWorkingPreacherTitlePassages(verse, bookNames, backbone);
  if (!parsed.ok || parsed.value.brefs.length === 0) { skipped.unparsed += 1; continue; }

  const id = `enter-the-bible:passage:${row.id}`;
  if (seen.has(id)) continue;
  seen.add(id);
  records.push({
    id,
    sourceId: "enter-the-bible",
    kind: "guide",
    title: title.slice(0, 300),
    officialUrl: row.link,
    brefs: parsed.value.brefs,
    // The reference is a field the publisher fills in, not prose we interpreted.
    matchBasis: "publisher-scripture-tag",
    metadata: {
      ...(row.date ? { publishedAt: row.date.slice(0, 10) } : {}),
      language: "en",
    },
  });
}

const manifest: TrustedResourceManifestV1 = {
  schema: "pericope.trusted-resource-manifest",
  version: 1,
  source: {
    id: "enter-the-bible",
    name: "Enter the Bible",
    homepageUrl: "https://enterthebible.org/",
    officialHosts: [HOST],
  },
  provenance: {
    publisher: "Enter the Bible, Luther Seminary",
    reviewedAt: new Date().toISOString().slice(0, 10),
    coverage: "reviewed-sample",
    permissions: "outbound-link-only",
    note: `Imported from the publisher's public catalogue. Coordinates come from each record's own verse field. Passage entries only: the audio, video, glossary, map and time-period types are tagged by book alone. ${records.length} records.`,
  },
  capabilities: ["outbound-link"],
  records,
};

const validated = validateTrustedResourceManifest(manifest, backbone);
if (!validated.ok) {
  console.error(`\nFAIL: the built manifest does not validate: ${validated.error}`);
  process.exit(1);
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(validated.value, null, 2)}\n`);

console.log(`\n  records:        ${records.length}`);
console.log(`  skipped:        ${skipped.noVerse} no verse field, ${skipped.unparsed} unparsed, ${skipped.offHost} off-host`);
console.log(`  written:        ${outPath}${arg("out") ? "" : `  (library from ${target.from})`}`);
