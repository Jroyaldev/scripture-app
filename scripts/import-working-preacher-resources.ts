/**
 * Build a trusted-resource manifest from Working Preacher's public catalogue.
 *
 * Two kinds of evidence, and they are not the same strength:
 *
 *   Commentaries state their passage in the title — "Commentary on Romans 8:1-11",
 *   or "Comentario del San Mateo 18:15-20" — so they are parsed, using the same
 *   normalizer the C1 prototype validated against a 751-record sample.
 *
 *   Podcasts state nothing. "#1096: Eleventh Sunday after Pentecost" is a day in
 *   the church year, not a reference. But every episode carries a lectionary day
 *   and year, and a day carries its readings inline, and a reading is a passage.
 *   So Sermon Brainwave reaches Scripture through the lectionary rather than
 *   through a title — which is also how a preacher reaches it.
 *
 * Offline, by hand, catalogue metadata only. See docs/trusted-resource-permissions.
 *
 * Usage:
 *   node --import tsx scripts/import-working-preacher-resources.ts [--out <path>]
 *        [--types commentary,podcast] [--limit-pages N] [--delay-ms N]
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { extractWorkingPreacherTitlePassages, namesBookOutsideBackbone } from "../src/core/resources/working-preacher.js";
import { validateTrustedResourceManifest } from "../src/core/resources/trusted-resources.js";
import { resolveManifestPath } from "./resource-import-target.js";
import type {
  TrustedResourceManifestV1,
  TrustedResourceRecordV1,
} from "../src/core/resources/trusted-resources.js";
import type { BackboneData, BookNameMap } from "../src/core/reference/types.js";

const ROOT = resolve(import.meta.dirname, "..");
const API = "https://www.workingpreacher.org/wp-json/wp/v2";
const HOST = "www.workingpreacher.org";
const USER_AGENT = "Pericope/0.1 (+https://marktheword.com; trusted-resource importer)";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const requestedTypes = (arg("types") ?? "commentary,podcast").split(",").map((t) => t.trim());
const limitPages = Number(arg("limit-pages") ?? "0") || 0;
const delayMs = Number(arg("delay-ms") ?? "150");
const target = resolveManifestPath("working-preacher");
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

/** Spanish editions are titled "Comentario …" and carry Spanish book names. */
const isSpanish = (title: string): boolean => /^coment|^salmo|^evangelio/i.test(title.trim());

function authorOf(acf: Record<string, unknown> | undefined): string | undefined {
  const authors = acf?.["authors"];
  if (!Array.isArray(authors) || authors.length === 0) return undefined;
  const first = authors[0] as { post_title?: string } | undefined;
  const name = first?.post_title?.trim();
  return name && name.toLowerCase() !== "working preacher" ? name : undefined;
}

const brefsFromTitle = (title: string): string[] => {
  const parsed = extractWorkingPreacherTitlePassages(title, bookNames, backbone);
  return parsed.ok ? parsed.value.brefs : [];
};


/* ── the lectionary join ─────────────────────────────────────────────────── */

console.log(`Importing from ${HOST}`);
console.log(`  types: ${requestedTypes.join(", ")}${limitPages ? `  (capped at ${limitPages} pages each)` : ""}`);

type ReadingsByYear = Map<number, string[]>;
const dayReadings = new Map<number, ReadingsByYear>();

if (requestedTypes.includes("podcast")) {
  const days = await getAll("wkngp_lctnry_days", "id,acf", "lectionary days");
  for (const raw of days) {
    const day = raw as { id: number; acf?: Record<string, unknown> };
    const perYear = day.acf?.["lectionary_day_readings_per_year"];
    if (!Array.isArray(perYear)) continue;
    const byYear: ReadingsByYear = new Map();
    for (const entry of perYear) {
      const e = entry as { lectionary_year?: unknown; readings?: unknown };
      const years = Array.isArray(e.lectionary_year) ? e.lectionary_year : [e.lectionary_year];
      const readings = Array.isArray(e.readings) ? e.readings : [];
      const titles = readings
        .map((r) => decode(((r as { post_title?: string }).post_title ?? "")))
        .filter(Boolean);
      if (titles.length === 0) continue;
      for (const y of years) {
        const yearId = (y as { ID?: number } | undefined)?.ID;
        if (typeof yearId !== "number") continue;
        byYear.set(yearId, [...(byYear.get(yearId) ?? []), ...titles]);
      }
    }
    if (byYear.size > 0) dayReadings.set(day.id, byYear);
  }
  const readingCount = [...dayReadings.values()].reduce((n, m) => n + [...m.values()].flat().length, 0);
  console.log(`  lectionary: ${dayReadings.size} days carrying ${readingCount} readings`);
}

/* ── records ─────────────────────────────────────────────────────────────── */

const records: TrustedResourceRecordV1[] = [];
const seen = new Set<string>();
const skipped = { noPassage: 0, offHost: 0, noDay: 0, outsideBackbone: 0 };
let viaLectionary = 0;

if (requestedTypes.includes("commentary")) {
  const rows = await getAll("wkngp_commentaries", "id,link,title,date,acf", "commentaries");
  for (const raw of rows) {
    const row = raw as { id: number; link: string; title?: { rendered?: string }; date?: string; acf?: Record<string, unknown> };
    const title = decode(row.title?.rendered ?? "");
    if (!title) continue;
    let host = ""; try { host = new URL(row.link).hostname; } catch { host = ""; }
    if (host !== HOST) { skipped.offHost += 1; continue; }

    let brefs = brefsFromTitle(title);
    if (brefs.length === 0 && namesBookOutsideBackbone(title)) {
      // The title named its passage and we cannot hold it. Borrowing the rest of
      // the day's readings would answer a question nobody asked.
      skipped.outsideBackbone += 1;
      continue;
    }
    if (brefs.length === 0) {
      // A title we cannot parse still has a lectionary day, and the day knows.
      const info = row.acf?.["lectionary_info"] as { lectionary_day?: number; lectionary_year?: number } | undefined;
      const byYear = info?.lectionary_day != null ? dayReadings.get(info.lectionary_day) : undefined;
      const titles = byYear && info?.lectionary_year != null ? byYear.get(info.lectionary_year) : undefined;
      if (titles) {
        brefs = [...new Set(titles.flatMap(brefsFromTitle))];
        if (brefs.length > 0) viaLectionary += 1;
      }
    }
    if (brefs.length === 0) { skipped.noPassage += 1; continue; }

    const id = `working-preacher:commentary:${row.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const author = authorOf(row.acf);
    records.push({
      id,
      sourceId: "working-preacher",
      kind: "commentary",
      title: title.slice(0, 300),
      officialUrl: row.link,
      brefs,
      matchBasis: "publisher-title",
      metadata: {
        ...(author ? { author } : {}),
        ...(row.date ? { publishedAt: row.date.slice(0, 10) } : {}),
        language: isSpanish(title) ? "es" : "en",
      },
    });
  }
}

if (requestedTypes.includes("podcast")) {
  const rows = await getAll("wkngp_podcasts", "id,link,title,date,acf", "podcasts");
  for (const raw of rows) {
    const row = raw as { id: number; link: string; title?: { rendered?: string }; date?: string; acf?: Record<string, unknown> };
    const title = decode(row.title?.rendered ?? "");
    if (!title) continue;
    let host = ""; try { host = new URL(row.link).hostname; } catch { host = ""; }
    if (host !== HOST) { skipped.offHost += 1; continue; }

    const dayId = Number(row.acf?.["lectionary_day"]);
    const yearId = Number(row.acf?.["lectionary_year"]);
    const byYear = Number.isFinite(dayId) ? dayReadings.get(dayId) : undefined;
    const titles = byYear && Number.isFinite(yearId) ? byYear.get(yearId) : undefined;
    if (!titles || titles.length === 0) { skipped.noDay += 1; continue; }
    const brefs = [...new Set(titles.flatMap(brefsFromTitle))];
    if (brefs.length === 0) { skipped.noPassage += 1; continue; }

    const id = `working-preacher:podcast:${row.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const author = authorOf(row.acf);
    records.push({
      id,
      sourceId: "working-preacher",
      kind: "podcast",
      title: title.slice(0, 300),
      officialUrl: row.link,
      brefs,
      // The passage is the lectionary's claim about the day, not our reading of
      // a title — publisher-catalog is the honest basis for that.
      matchBasis: "publisher-catalog",
      metadata: {
        ...(author ? { author } : {}),
        ...(row.date ? { publishedAt: row.date.slice(0, 10) } : {}),
        language: "en",
      },
    });
    viaLectionary += 1;
  }
}

const manifest: TrustedResourceManifestV1 = {
  schema: "pericope.trusted-resource-manifest",
  version: 1,
  source: {
    id: "working-preacher",
    name: "Working Preacher",
    homepageUrl: "https://www.workingpreacher.org/",
    officialHosts: [HOST],
  },
  provenance: {
    publisher: "Working Preacher from Luther Seminary",
    reviewedAt: new Date().toISOString().slice(0, 10),
    coverage: "reviewed-sample",
    permissions: "outbound-link-only",
    note: `Imported from the publisher's public catalogue. Commentary coordinates are parsed from publisher titles; podcast coordinates come from the lectionary day the publisher assigned. ${records.length} records.`,
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

console.log(`\n  records:          ${records.length}`);
console.log(`  via lectionary:   ${viaLectionary}`);
console.log(`  skipped:          ${skipped.noPassage} no passage, ${skipped.noDay} no lectionary day, ${skipped.offHost} off-host, ${skipped.outsideBackbone} outside the backbone`);
console.log(`  written:          ${outPath}${arg("out") ? "" : `  (library from ${target.from})`}`);
