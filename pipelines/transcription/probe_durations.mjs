/**
 * Exact durations, read from the audio itself.
 *
 * The byte-derived estimate in probe_audio.mjs assumes one bitrate for a
 * catalogue that has at least two: the older series are 96kbps (some 32kHz
 * mono), the recent ones 128kbps. That made eleven perfectly good episodes look
 * like they carried the wrong recording, at a suspiciously constant ratio of
 * 0.75 — which is 96/128, and is the tell that the assumption was wrong rather
 * than the data.
 *
 * ffprobe reads the container's own duration, so it needs no assumption at all.
 * It also settles the 65 episodes the manifest gives no duration for, and those
 * matter: against a hard compute budget the total is what the cost estimate
 * divides by, and an imputed mean is a guess sitting in the middle of it.
 *
 *   node probe_durations.mjs [--inventory <path>] [--out <path>] [--concurrency 6]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const DEFAULT_INVENTORY = "/Volumes/External/Transcripts/inventory.json";
const DEFAULT_OUT = "/Volumes/External/Transcripts/durations.json";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const inventory = JSON.parse(readFileSync(resolve(arg("inventory", DEFAULT_INVENTORY)), "utf-8"));
const outPath = resolve(arg("out", DEFAULT_OUT));
const concurrency = Number(arg("concurrency", "6"));

async function probe(episode) {
  try {
    const { stdout } = await run("ffprobe", [
      "-v", "error",
      "-select_streams", "a:0",
      "-show_entries", "stream=bit_rate,sample_rate,channels",
      "-show_entries", "format=duration",
      "-of", "json",
      episode.audioUrl,
    ], { timeout: 120_000, maxBuffer: 1 << 20 });
    const probed = JSON.parse(stdout);
    const stream = probed.streams?.[0] ?? {};
    const seconds = Number(probed.format?.duration ?? 0);
    return {
      id: episode.id,
      ok: seconds > 0,
      seconds: Number(seconds.toFixed(1)),
      minutes: Number((seconds / 60).toFixed(1)),
      statedMinutes: episode.durationMinutes,
      bitrate: stream.bit_rate ? Number(stream.bit_rate) : null,
      sampleRate: stream.sample_rate ? Number(stream.sample_rate) : null,
      channels: stream.channels ?? null,
    };
  } catch (error) {
    return { id: episode.id, ok: false, error: error instanceof Error ? error.message.split("\n")[0] : String(error) };
  }
}

const results = [];
let cursor = 0;
async function worker() {
  while (cursor < inventory.episodes.length) {
    results.push(await probe(inventory.episodes[cursor++]));
    if (results.length % 50 === 0) console.log(`  ${results.length}/${inventory.episodes.length}`);
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));

results.sort((a, b) => a.id.localeCompare(b.id));
const ok = results.filter((r) => r.ok);
const totalHours = ok.reduce((sum, r) => sum + r.seconds, 0) / 3600;

const byBitrate = {};
for (const r of ok) {
  const key = r.bitrate ? `${Math.round(r.bitrate / 1000)}kbps` : "unknown";
  byBitrate[key] = (byBitrate[key] ?? 0) + 1;
}

/* Now that duration is measured rather than inferred, a disagreement with the
   manifest is a fact about the manifest. These are the records worth looking
   at by hand — a stated duration that does not match the recording is the same
   class of defect as a record carrying the wrong recording outright. */
const wrong = ok
  .filter((r) => r.statedMinutes)
  .map((r) => ({ ...r, delta: Math.abs(r.statedMinutes - r.minutes) }))
  .filter((r) => r.delta > Math.max(3, r.statedMinutes * 0.1))
  .sort((a, b) => b.delta - a.delta);

const report = {
  schema: "audio-durations/v1",
  probed: results.length,
  ok: ok.length,
  failed: results.length - ok.length,
  totalAudioHours: Number(totalHours.toFixed(1)),
  byBitrate,
  manifestDisagreements: wrong,
  failures: results.filter((r) => !r.ok),
  durations: ok,
};
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(`\nwrote ${outPath}`);
console.log(`  probed:      ${report.ok}/${report.probed} (${report.failed} failed)`);
console.log(`  TOTAL AUDIO: ${report.totalAudioHours} hours  <- the real number`);
console.log(`  bitrates:    ${Object.entries(byBitrate).map(([k, v]) => `${k}×${v}`).join(", ")}`);
console.log(`  manifest durations wrong by >10%: ${wrong.length}`);
for (const w of wrong.slice(0, 12)) {
  console.log(`    stated ${String(w.statedMinutes).padStart(3)} actual ${String(w.minutes).padStart(5)}  ${w.id.replace("bibleproject:podcast:", "")}`);
}
