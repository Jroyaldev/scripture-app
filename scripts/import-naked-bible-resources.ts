/**
 * Build a trusted-resource manifest from the Naked Bible Podcast's catalogue.
 *
 * The episodes are titled by passage — "Naked Bible 479: 1 Samuel 30-31" — and
 * nothing else on the record carries a reference, so the number and colon are
 * stripped and what remains goes through the same normalizer Working Preacher's
 * titles use. The show works verse by verse through books over long runs, so a
 * chapter-titled episode is a genuine claim about that chapter.
 *
 * Offline, by hand, catalogue metadata only. See docs/trusted-resource-permissions.
 *
 * Usage:
 *   node --import tsx scripts/import-naked-bible-resources.ts
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
const API = "https://nakedbiblepodcast.com/wp-json/wp/v2";
const HOST = "nakedbiblepodcast.com";
const USER_AGENT = "Pericope/0.1 (+https://marktheword.com; trusted-resource importer)";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const limitPages = Number(arg("limit-pages") ?? "0") || 0;
const delayMs = Number(arg("delay-ms") ?? "150");
const target = resolveManifestPath("naked-bible");
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

/**
 * "Naked Bible 479: 1 Samuel 30-31" -> "1 Samuel 30-31".
 *
 * Only the show's own numbering is stripped. Everything after the colon is left
 * exactly as the publisher wrote it, so an episode that names no passage — a Q&A
 * or an interview — yields nothing and is skipped rather than guessed at.
 */
function referencePart(title: string): string {
  const withoutSeries = title.replace(/^\s*(the\s+)?naked\s+bible\s*\d*\s*[:–—-]?\s*/i, "");
  const afterNumber = withoutSeries.replace(/^\s*(episode\s*)?\d+\s*[:–—-]\s*/i, "");
  return afterNumber.split(/\s+[–—]\s+/)[0]?.trim() ?? "";
}

console.log(`Importing from ${HOST}`);

const rows = await getAll("podcast", "id,link,title,date,series", "episodes");

const records: TrustedResourceRecordV1[] = [];
const seen = new Set<string>();
const skipped = { noPassage: 0, offHost: 0 };

for (const raw of rows) {
  const row = raw as { id: number; link: string; title?: { rendered?: string }; date?: string };
  const title = decode(row.title?.rendered ?? "");
  if (!title) continue;
  let host = ""; try { host = new URL(row.link).hostname; } catch { host = ""; }
  if (host !== HOST) { skipped.offHost += 1; continue; }

  const reference = referencePart(title);
  const parsed = reference ? extractWorkingPreacherTitlePassages(reference, bookNames, backbone) : null;
  if (!parsed?.ok || parsed.value.brefs.length === 0) { skipped.noPassage += 1; continue; }

  const id = `naked-bible:podcast:${row.id}`;
  if (seen.has(id)) continue;
  seen.add(id);
  records.push({
    id,
    sourceId: "naked-bible",
    kind: "podcast",
    title: title.slice(0, 300),
    officialUrl: row.link,
    brefs: parsed.value.brefs,
    matchBasis: "publisher-title",
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
    id: "naked-bible",
    name: "Naked Bible Podcast",
    homepageUrl: "https://nakedbiblepodcast.com/",
    officialHosts: [HOST],
  },
  provenance: {
    publisher: "Naked Bible Podcast",
    reviewedAt: new Date().toISOString().slice(0, 10),
    coverage: "reviewed-sample",
    permissions: "outbound-link-only",
    note: `Imported from the publisher's public catalogue. Coordinates are parsed from episode titles, which name the passage the episode works through. Episodes naming no passage are omitted. ${records.length} records.`,
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
console.log(`  skipped:        ${skipped.noPassage} name no passage, ${skipped.offHost} off-host`);
console.log(`  written:        ${outPath}${arg("out") ? "" : `  (library from ${target.from})`}`);
