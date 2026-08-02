/**
 * Give a publisher an episode catalogue built from the manifest it already has.
 *
 *   node --import tsx scripts/episodes-from-manifest.ts --source bibleproject
 *   node --import tsx scripts/episodes-from-manifest.ts --all
 *
 * ── The problem this solves ─────────────────────────────────────────────────
 *
 * The Listen room lists a publisher when it has `episodes.json`, not when it
 * has cards. BibleProject and Naked Bible have everything else — 531 and 230
 * manifest records, transcripts, and 528 and 230 per-episode reference files
 * apiece — and no episode catalogue, so neither has ever appeared in the room.
 * Their whole libraries were reachable only through the reading margin.
 *
 * ── Why not `import-podcast-feed` ───────────────────────────────────────────
 *
 * That script is the right one for a show arriving from an RSS feed, and it
 * would have been the wrong one here, for two reasons that were checked rather
 * than assumed:
 *
 * 1. IT WRITES BOTH FILES. These two publishers' manifests were built by a
 *    different importer, from their own resource pages — 531 records with
 *    `publisher-scripture-tag` provenance, which a feed's titles cannot
 *    reproduce. Running the feed importer would have replaced curated records
 *    with parsed ones.
 *
 * 2. THE IDS WOULD NOT MATCH. A reference file is named for its record id, and
 *    every one of these 758 files is keyed to the id the manifest already uses
 *    (`bibleproject:podcast:what-prophecy`). A feed import mints ids from the
 *    feed, and the references — the reason these shows are worth having — would
 *    have silently stopped joining.
 *
 * So this derives instead. It reads the manifest, keeps every record that has
 * audio, and writes the catalogue the room reads. The ids are the manifest's
 * own, which is what keeps every reference file and the passage index pointing
 * at something real. Nothing is fetched; nothing but `episodes.json` is written.
 *
 * ── What is lost, and it is worth saying ────────────────────────────────────
 *
 * A manifest holds the episodes whose PASSAGE could be established — for these
 * two that is most of the catalogue but not all of it, and this cannot invent
 * the rest. A feed import would find them. If either show is ever onboarded
 * from its feed, this file becomes unnecessary rather than wrong.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

interface ManifestRecord {
  id: string;
  title?: string;
  officialUrl?: string;
  audioUrl?: string;
  metadata?: { publishedAt?: string; durationMinutes?: number };
}

interface Manifest {
  source: { id: string; name: string };
  records: ManifestRecord[];
}

/** The publishers that have cards and transcripts but no episode catalogue. */
const WANTED = ["bibleproject", "naked-bible"];

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function libraryRoot(): string {
  return arg("library") ?? join(homedir(), "ScriptureLibrary");
}

function build(sourceId: string): void {
  const dir = join(libraryRoot(), ".artifacts", "resources", sourceId);
  const manifestPath = join(dir, "manifest.json");
  let manifest: Manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
  } catch {
    console.log(`  --   ${sourceId}: no manifest at ${manifestPath}`);
    return;
  }

  const seen = new Set<string>();
  const episodes = [];
  let noAudio = 0;
  for (const record of manifest.records) {
    /* Audio is the whole point of this file — a card without it belongs in the
       manifest and nowhere near a transport. */
    if (!record.audioUrl || !record.audioUrl.startsWith("https://")) { noAudio += 1; continue; }
    if (!record.id || !record.title || seen.has(record.id)) continue;
    seen.add(record.id);
    episodes.push({
      id: record.id,
      title: record.title,
      audioUrl: record.audioUrl,
      officialUrl: record.officialUrl ?? "",
      /* Minutes are what a manifest states; the room and the loader want
         seconds, and a rounded minute is the honest conversion of a rounded
         minute. Absent stays absent rather than becoming zero, which the room
         draws as a blank runtime instead of "0:00". */
      ...(record.metadata?.durationMinutes
        ? { durationSeconds: Math.round(record.metadata.durationMinutes * 60) }
        : {}),
      publishedAt: record.metadata?.publishedAt ?? null,
    });
  }

  if (episodes.length === 0) {
    console.log(`  ??   ${sourceId}: nothing with audio; not written`);
    return;
  }

  const out = join(dir, "episodes.json");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify({
    schema: "podcast-catalog/v1",
    sourceId: manifest.source.id,
    sourceName: manifest.source.name,
    generatedFrom: "manifest.json",
    episodeCount: episodes.length,
    episodes,
  }, null, 2)}\n`);

  const dated = episodes.filter((one) => one.publishedAt).length;
  const timed = episodes.filter((one) => "durationSeconds" in one).length;
  console.log(
    `  fix  ${sourceId.padEnd(16)} ${String(episodes.length).padStart(4)} episodes`
    + `   dated ${dated}   timed ${timed}`
    + (noAudio ? `   no audio ${noAudio}` : ""),
  );
}

const only = arg("source");
const sources = only ? [only] : WANTED;
if (!only && !process.argv.includes("--all")) {
  console.log("Pass --source <id> or --all.\n");
  process.exit(1);
}
for (const sourceId of sources) build(sourceId);
