/**
 * Write the work packet: every record a publisher has that we could not link.
 *
 * An importer links what the publisher already stated. What is left is the
 * judgement work — 14,267 TGC articles carry no scripture tag at all — and that
 * is work a person or an agent can do, but only if it arrives as a list with
 * everything needed to decide, and leaves as a list a machine can merge.
 *
 * Output is JSONL, one record per line, chunked. JSONL because it is appendable,
 * diffable, and splittable across however many workers you have without anyone
 * merging anyone else's braces.
 *
 * Usage:
 *   node --import tsx scripts/export-resource-enrichment.ts --source the-gospel-coalition
 *        [--types article,sermon] [--chunk 250] [--out <dir>] [--limit-pages N]
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { resolveManifestPath } from "./resource-import-target.js";
import type { TrustedResourceManifestV1 } from "../src/core/resources/trusted-resources.js";

const ROOT = resolve(import.meta.dirname, "..");
const USER_AGENT = "Pericope/0.1 (+https://marktheword.com; trusted-resource importer)";

/** Where each publisher's records live, and which of ours they become. */
const SOURCES: Record<string, {
  api: string;
  host: string;
  types: Record<string, { restBase: string; kind: string }>;
  /** Fields worth carrying into the packet — never bodies, only catalogue facts. */
  fields: string;
}> = {
  "the-gospel-coalition": {
    api: "https://www.thegospelcoalition.org/wp-json/wp/v2",
    host: "www.thegospelcoalition.org",
    types: {
      article: { restBase: "article", kind: "article" },
      sermon: { restBase: "sermon", kind: "sermon" },
      "tgc-podcast": { restBase: "tgc-podcast", kind: "podcast" },
      commentary: { restBase: "commentary", kind: "commentary" },
    },
    fields: "id,link,title,date,scripture",
  },
  "naked-bible": {
    api: "https://nakedbiblepodcast.com/wp-json/wp/v2",
    host: "nakedbiblepodcast.com",
    types: { podcast: { restBase: "podcast", kind: "podcast" } },
    fields: "id,link,title,date",
  },
  "enter-the-bible": {
    api: "https://enterthebible.org/wp-json/wp/v2",
    host: "enterthebible.org",
    types: {
      audio: { restBase: "audio", kind: "podcast" },
      video: { restBase: "video", kind: "video" },
      passage: { restBase: "passage", kind: "guide" },
    },
    fields: "id,link,title,date,book",
  },
  "working-preacher": {
    api: "https://www.workingpreacher.org/wp-json/wp/v2",
    host: "www.workingpreacher.org",
    types: {
      podcast: { restBase: "wkngp_podcasts", kind: "podcast" },
      commentary: { restBase: "wkngp_commentaries", kind: "commentary" },
    },
    fields: "id,link,title,date",
  },
};

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const sourceId = arg("source") ?? "the-gospel-coalition";
const source = SOURCES[sourceId];
if (!source) {
  console.error(`Unknown source ${sourceId}. Known: ${Object.keys(SOURCES).join(", ")}`);
  process.exit(1);
}
const requestedTypes = (arg("types") ?? Object.keys(source.types).join(",")).split(",").map((t) => t.trim());
const chunkSize = Number(arg("chunk") ?? "250");
const limitPages = Number(arg("limit-pages") ?? "0") || 0;
const outDir = arg("out") ?? join(ROOT, "enrichment", sourceId);

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

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

async function getAll(restBase: string, label: string): Promise<Array<Record<string, unknown>>> {
  const all: Array<Record<string, unknown>> = [];
  let page = 1;
  let totalPages = 1;
  do {
    const url = `${source!.api}/${restBase}?per_page=100&page=${page}&_fields=${source!.fields}`;
    const response = await fetch(url, { headers: { accept: "application/json", "user-agent": USER_AGENT } });
    if (!response.ok) throw new Error(`${url} -> ${response.status}`);
    totalPages = limitPages
      ? Math.min(Number(response.headers.get("x-wp-totalpages") ?? "1"), limitPages)
      : Number(response.headers.get("x-wp-totalpages") ?? "1");
    all.push(...((await response.json()) as Array<Record<string, unknown>>));
    process.stdout.write(`\r  ${label}: page ${page}/${totalPages}, ${all.length}`);
    page += 1;
    if (page <= totalPages) await sleep(150);
  } while (page <= totalPages);
  process.stdout.write("\n");
  return all;
}

/* Already linked records are not work. Read the manifest we ship rather than
   guessing, so a second run after an import shrinks instead of repeating. */
const manifestPath = arg("manifest") ?? resolveManifestPath(sourceId).path;
let linked = new Set<string>();
try {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as TrustedResourceManifestV1;
  linked = new Set(manifest.records.map((record) => record.id));
  console.log(`Already linked: ${linked.size.toLocaleString()} (from ${manifestPath})`);
} catch {
  console.log(`No manifest at ${manifestPath} — treating every record as unlinked.`);
}

console.log(`Exporting unlinked records for ${sourceId}: ${requestedTypes.join(", ")}`);

type Task = {
  id: string;
  sourceId: string;
  kind: string;
  title: string;
  url: string;
  publishedAt?: string;
  publisherSaid?: string;
};

const tasks: Task[] = [];
for (const typeName of requestedTypes) {
  const type = source.types[typeName];
  if (!type) { console.log(`  ! unknown type ${typeName}`); continue; }
  const rows = await getAll(type.restBase, typeName);
  for (const row of rows) {
    const id = `${sourceId}:${typeName}:${row["id"] as number}`;
    if (linked.has(id)) continue;
    const title = decode(((row["title"] as { rendered?: string } | undefined)?.rendered) ?? "");
    const link = String(row["link"] ?? "");
    if (!title || !link) continue;
    let host = ""; try { host = new URL(link).hostname; } catch { host = ""; }
    if (host !== source.host) continue;
    const tags = row["scripture"];
    tasks.push({
      id,
      sourceId,
      kind: type.kind,
      title,
      url: link,
      ...(typeof row["date"] === "string" ? { publishedAt: (row["date"] as string).slice(0, 10) } : {}),
      ...(Array.isArray(tags) && tags.length > 0
        ? { publisherSaid: `${tags.length} scripture term(s) the importer could not map` }
        : {}),
    });
  }
}

mkdirSync(outDir, { recursive: true });
const chunks: Task[][] = [];
for (let i = 0; i < tasks.length; i += chunkSize) chunks.push(tasks.slice(i, i + chunkSize));
chunks.forEach((chunk, index) => {
  const name = `tasks-${String(index + 1).padStart(3, "0")}.jsonl`;
  writeFileSync(join(outDir, name), `${chunk.map((task) => JSON.stringify(task)).join("\n")}\n`);
});

writeFileSync(join(outDir, "MANIFEST.json"), `${JSON.stringify({
  sourceId,
  types: requestedTypes,
  exportedRecords: tasks.length,
  chunks: chunks.length,
  chunkSize,
  alreadyLinked: linked.size,
  brief: "docs/resource-enrichment.md",
  answersGoIn: "answers-NNN.jsonl beside each tasks-NNN.jsonl",
}, null, 2)}\n`);

console.log(`\n  unlinked records: ${tasks.length.toLocaleString()}`);
console.log(`  chunks:           ${chunks.length} x ${chunkSize}`);
console.log(`  written:          ${outDir}`);
console.log(`  brief:            docs/resource-enrichment.md`);
