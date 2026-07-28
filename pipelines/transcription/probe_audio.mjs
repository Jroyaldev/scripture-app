/**
 * HEADs every audio URL in the inventory before any GPU is rented.
 *
 * A dead or redirecting URL discovered during the real run costs a container
 * slot, a retry, and money; discovered here it costs nothing. This also reports
 * Content-Length, which is the only independent check we have on the manifest's
 * stated durations — 65 episodes state none at all, and a byte count at a known
 * bitrate estimates one.
 *
 * Concurrency is deliberately low. Every episode is served by one host, and the
 * point of this pass is to learn about the URLs, not to find out how the CDN
 * responds to being hit 100 ways at once.
 *
 *   node probe_audio.mjs [--inventory <path>] [--out <path>] [--concurrency 8]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_INVENTORY = "/Volumes/External/Transcripts/inventory.json";
const DEFAULT_OUT = "/Volumes/External/Transcripts/audio-probe.json";
const BITRATE_KBPS = 128;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const inventoryPath = resolve(arg("inventory", DEFAULT_INVENTORY));
const outPath = resolve(arg("out", DEFAULT_OUT));
const concurrency = Number(arg("concurrency", "8"));

const inventory = JSON.parse(readFileSync(inventoryPath, "utf-8"));
const episodes = inventory.episodes;

async function probe(episode) {
  const started = Date.now();
  try {
    const response = await fetch(episode.audioUrl, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });
    const length = Number(response.headers.get("content-length") ?? 0);
    /* mp3 at a constant bitrate: bytes * 8 / (kbps * 1000) = seconds. Only ever
       an estimate — VBR and ID3 art both skew it — so it is used to sanity-check
       stated durations and to fill in missing ones, never to override. */
    const estimatedMinutes = length > 0
      ? Number(((length * 8) / (BITRATE_KBPS * 1000) / 60).toFixed(1))
      : null;
    return {
      id: episode.id,
      ok: response.ok,
      status: response.status,
      contentType: response.headers.get("content-type"),
      bytes: length || null,
      estimatedMinutes,
      statedMinutes: episode.durationMinutes,
      ms: Date.now() - started,
    };
  } catch (error) {
    return {
      id: episode.id,
      ok: false,
      status: null,
      error: error instanceof Error ? error.message : String(error),
      ms: Date.now() - started,
    };
  }
}

const results = [];
let cursor = 0;
async function worker() {
  while (cursor < episodes.length) {
    const index = cursor++;
    results.push(await probe(episodes[index]));
    if (results.length % 50 === 0) {
      console.log(`  ${results.length}/${episodes.length}`);
    }
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));

results.sort((a, b) => a.id.localeCompare(b.id));
const failed = results.filter((r) => !r.ok);
const sized = results.filter((r) => r.bytes);
const totalBytes = sized.reduce((sum, r) => sum + r.bytes, 0);
const probedHours = sized.reduce((sum, r) => sum + (r.estimatedMinutes ?? 0), 0) / 60;

/* Where the manifest states a duration AND the bytes imply one, they should
   roughly agree. A big disagreement means one of them is describing a different
   recording — which is exactly the class of bug this source has had before. */
const disagreements = results
  .filter((r) => r.statedMinutes && r.estimatedMinutes)
  .map((r) => ({ ...r, delta: Math.abs(r.statedMinutes - r.estimatedMinutes) }))
  .filter((r) => r.delta > Math.max(5, r.statedMinutes * 0.2))
  .sort((a, b) => b.delta - a.delta);

const report = {
  schema: "audio-probe/v1",
  probed: results.length,
  ok: results.length - failed.length,
  failed: failed.length,
  totalGiB: Number((totalBytes / 1024 ** 3).toFixed(1)),
  probedAudioHours: Number(probedHours.toFixed(1)),
  manifestEstimatedHours: inventory.estimatedAudioHours,
  durationDisagreements: disagreements.slice(0, 20),
  failures: failed,
  results,
};

writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(`\nwrote ${outPath}`);
console.log(`  reachable:   ${report.ok}/${report.probed}`);
console.log(`  failed:      ${report.failed}`);
console.log(`  download:    ${report.totalGiB} GiB`);
console.log(`  audio hours: ${report.probedAudioHours}h from bytes vs ${report.manifestEstimatedHours}h from manifest`);
console.log(`  duration disagreements >20%: ${disagreements.length}`);
for (const f of failed.slice(0, 10)) {
  console.log(`    FAIL ${f.status ?? f.error}  ${f.id}`);
}
