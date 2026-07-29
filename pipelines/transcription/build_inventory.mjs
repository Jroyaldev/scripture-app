/**
 * Emits the transcription pipeline's input contract.
 *
 * The pipeline does not read the library's resource manifest directly. That
 * manifest is user data with its own schema, versioning and refusal rules, and
 * a Python job on a rented GPU has no business depending on any of it. This
 * script is the one place that knows both shapes: it reads the installed
 * manifest and writes a flat, stable inventory the pipeline consumes.
 *
 * Everything downstream keys on `id`, which is the record id from the manifest.
 * That is what makes a transcript re-attachable to the record it came from, and
 * what makes re-runs idempotent — a transcript already on disk under that id is
 * work already paid for.
 *
 *   node build_inventory.mjs [--library <path>] [--out <path>]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const DEFAULT_LIBRARY = join(process.env["HOME"] ?? "", "ScriptureLibrary");
const DEFAULT_OUT = "/Volumes/External/Transcripts/inventory.json";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/* Which publisher's catalogue to build from. Hardcoding one was fine while
   only one had granted transcripts; a second grant makes it a parameter rather
   than a rewrite. */
const SOURCE = arg("source", "bibleproject");
const libraryPath = resolve(arg("library", DEFAULT_LIBRARY));
const outPath = resolve(arg("out", SOURCE === "bibleproject" ? DEFAULT_OUT : `/Volumes/External/Transcripts/${SOURCE}-inventory.json`));
const manifestPath = join(libraryPath, ".artifacts/resources", SOURCE, "manifest.json");

/* Measured durations, if probe_durations.mjs has run. ffprobe reads the
   container's own duration, so where it and the manifest disagree the manifest
   is simply wrong — three records are, by more than 10%. Cost estimates and
   batch packing both key on duration, so they use the measured value and fall
   back to the stated one only where nothing was measured. */
const durationsPath = resolve(arg("durations", SOURCE === "bibleproject" ? "/Volumes/External/Transcripts/durations.json" : `/Volumes/External/Transcripts/${SOURCE}-durations.json`));
const measured = new Map();
try {
  const report = JSON.parse(readFileSync(durationsPath, "utf-8"));
  for (const d of report.durations ?? []) measured.set(d.id, d);
} catch {
  /* Not probed yet. The inventory is still usable; it just carries the
     manifest's stated durations and the mean-imputed total. */
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
const records = manifest.records ?? [];

/* An episode catalogue beside the manifest, where the importer wrote one.

   The manifest is a catalogue of passage claims — a record cannot exist
   without brefs — and a podcast's audio catalogue is not the same list. Spoken
   Gospel publishes 295 episodes and states a passage in 253 titles; building
   from the manifest alone would decide, here, that the other 42 have no speech
   in them. Where no catalogue exists the manifest is still the list, which is
   what the first two publishers ran on. */
const catalogPath = join(libraryPath, ".artifacts/resources", SOURCE, "episodes.json");
let catalog = null;
try {
  const parsed = JSON.parse(readFileSync(catalogPath, "utf-8"));
  if (parsed.schema === "podcast-catalog/v1" && Array.isArray(parsed.episodes)) catalog = parsed;
} catch {
  /* No catalogue; the manifest is the list. */
}

/* What the publisher stated, kept by record id so an episode carried only by
   the catalogue still picks up any coordinates the manifest holds for it. */
const statedBrefs = new Map(records.map((record) => [record.id, record.brefs ?? []]));
/* Seconds, where the catalogue has them. A feed states its own durations to the
   second and the manifest rounds them to minutes, so this is the finer of the
   two numbers rather than a substitute for a missing one. */
const catalogSeconds = new Map(
  (catalog?.episodes ?? [])
    .filter((episode) => typeof episode.durationSeconds === "number")
    .map((episode) => [episode.id, episode.durationSeconds]),
);

/* Only podcasts have audio; guides and videos are a different kind of record
   and silently including one would put a transcript against something that was
   never spoken. */
const podcasts = catalog
  ? catalog.episodes.map((episode) => ({
    id: episode.id,
    kind: "podcast",
    title: episode.title,
    audioUrl: episode.audioUrl,
    officialUrl: episode.officialUrl,
    brefs: statedBrefs.get(episode.id) ?? [],
    metadata: {
      ...(episode.publishedAt ? { publishedAt: episode.publishedAt } : {}),
      ...(episode.durationSeconds ? { durationMinutes: Math.round(episode.durationSeconds / 60) } : {}),
      language: "en",
    },
  }))
  : records.filter((record) => record.kind === "podcast");

const episodes = [];
const skipped = [];

for (const record of podcasts) {
  if (typeof record.audioUrl !== "string" || record.audioUrl.length === 0) {
    skipped.push({ id: record.id, reason: "no-audio-url", title: record.title });
    continue;
  }
  let host;
  try {
    host = new URL(record.audioUrl).hostname;
  } catch {
    skipped.push({ id: record.id, reason: "unparseable-audio-url", title: record.title });
    continue;
  }
  const probed = measured.get(record.id);
  const statedMinutes = record.metadata?.durationMinutes ?? null;
  const statedSeconds = catalogSeconds.get(record.id)
    ?? (statedMinutes === null ? null : statedMinutes * 60);
  episodes.push({
    id: record.id,
    title: record.title,
    audioUrl: record.audioUrl,
    audioHost: host,
    officialUrl: record.officialUrl ?? null,
    /* Measured wins. `statedMinutes` is kept beside it rather than discarded so
       a disagreement stays visible — it is evidence about the manifest, and the
       three records where they differ are worth fixing at the source. */
    durationMinutes: probed?.minutes ?? statedMinutes,
    statedMinutes,
    /* Falls back to what the publisher stated rather than to null, because null
       does not travel as "unknown" — it is written into every transcript as
       `audioSeconds`, and the reference extractor reads that to check a cited
       timestamp lies inside the episode. `audioSeconds || Infinity` turns a
       missing duration into no bound at all, so the check goes quiet rather
       than loud, which is the worst way for a check to fail. A stated duration
       is a real bound; ffprobe's is a better one. */
    durationSeconds: probed?.seconds ?? statedSeconds,
    durationSource: probed ? "ffprobe" : statedSeconds === null ? "unknown" : "manifest",
    bitrate: probed?.bitrate ?? null,
    publishedAt: record.metadata?.publishedAt ?? null,
    language: record.metadata?.language ?? "en",
    /* Carried through untouched. The pipeline never interprets these; they
       exist so a finished transcript can be aligned back to the passages the
       publisher itself tagged, without a second pass over the manifest. */
    brefs: Array.isArray(record.brefs) ? record.brefs : [],
  });
}

/* Longest first. The tail of a batch run is set by its slowest item, so
   starting the 99-minute episodes before the 23-minute ones keeps a fan-out
   from ending with one container still grinding while the rest sit idle. */
episodes.sort((a, b) => (b.durationMinutes ?? 0) - (a.durationMinutes ?? 0));

const known = episodes.filter((e) => e.durationMinutes !== null);
const totalMinutes = known.reduce((sum, e) => sum + e.durationMinutes, 0);
/* Any episode still lacking a duration costs GPU time regardless, so bill it at
   the mean rather than at zero. Once probe_durations.mjs has run this term is
   zero and the total is measured rather than estimated. */
const meanMinutes = known.length > 0 ? totalMinutes / known.length : 0;
const estimatedMinutes = totalMinutes + meanMinutes * (episodes.length - known.length);
const disagreements = episodes.filter(
  (e) => e.statedMinutes !== null && e.durationSource === "ffprobe"
    && Math.abs(e.statedMinutes - e.durationMinutes) > Math.max(3, e.statedMinutes * 0.1),
);

const inventory = {
  schema: "transcription-inventory/v1",
  source: SOURCE,
  generatedFrom: manifestPath,
  episodeCount: episodes.length,
  /* Stated where known, mean-imputed where not — this is the number the cost
     estimate divides by, so it is deliberately the pessimistic one. */
  estimatedAudioHours: Number((estimatedMinutes / 60).toFixed(1)),
  statedAudioHours: Number((totalMinutes / 60).toFixed(1)),
  episodesWithoutDuration: episodes.length - known.length,
  measuredEpisodes: episodes.filter((e) => e.durationSource === "ffprobe").length,
  manifestDurationDisagreements: disagreements.map((e) => ({
    id: e.id, stated: e.statedMinutes, actual: e.durationMinutes,
  })),
  audioHosts: [...new Set(episodes.map((e) => e.audioHost))],
  skipped,
  episodes,
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(inventory, null, 2)}\n`);

console.log(`wrote ${outPath}`);
console.log(`  episodes:   ${inventory.episodeCount}`);
console.log(`  audio:      ${inventory.estimatedAudioHours}h estimated (${inventory.statedAudioHours}h stated)`);
console.log(`  no duration:${inventory.episodesWithoutDuration}`);
console.log(`  hosts:      ${inventory.audioHosts.join(", ")}`);
if (skipped.length > 0) {
  console.log(`  skipped:    ${skipped.length}`);
  for (const s of skipped) console.log(`    ${s.reason}  ${s.id}`);
}
