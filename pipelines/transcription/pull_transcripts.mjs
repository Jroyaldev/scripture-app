/**
 * Bring finished transcripts down from the Volume and put them where the app
 * reads them.
 *
 *   node pull_transcripts.mjs --source <sourceId> [--inventory <path>]
 *                             [--library <path>] [--modal <python>]
 *
 * WHY NOT `modal volume get / --force`
 *
 * That is what the runbook said, and it re-downloads the whole Volume — every
 * publisher's transcripts, hundreds of megabytes — to collect whatever landed
 * since the last check. Fine once at the end of a run; useless for watching one
 * in progress, which is exactly when you want to look. This pulls only the
 * files for one source that are not already on disk, so it can be run every few
 * minutes for nothing.
 *
 * WHAT IT REPAIRS ON THE WAY THROUGH
 *
 * `audioSeconds` is the episode's runtime, and the reference extractor uses it
 * to reject a citation timestamped outside the episode. The transcriber copies
 * it from the inventory, so an inventory built before durations were known
 * writes null into every transcript — and null does not travel as "unknown":
 * downstream it reads `audioSeconds || Infinity`, and the check silently
 * becomes no check. So the duration is filled in here from the inventory, which
 * is the file that actually knows it.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const SOURCE = arg("source", "spoken-gospel");
const LIBRARY = resolve(arg("library", join(process.env["HOME"] ?? "", "ScriptureLibrary")));
const INVENTORY = resolve(arg("inventory", join(process.env["HOME"] ?? "", `Transcripts/${SOURCE}-inventory.json`)));
const STAGING = resolve(arg("staging", join(process.env["HOME"] ?? "", "Transcripts/raw")));
const PYTHON = resolve(arg("modal", join(import.meta.dirname, ".venv/bin/python")));
const VOLUME = arg("volume", "asr-transcripts");
const INSTALLED = join(LIBRARY, ".artifacts/transcripts");
const dryRun = process.argv.includes("--dry-run");

/* The key transform the transcriber uses, so a record id and a filename are the
   same fact written two ways. */
const key = (id) => id.replace(/:/g, "__").replace(/\//g, "_");

const inventory = JSON.parse(readFileSync(INVENTORY, "utf-8"));
const seconds = new Map(
  inventory.episodes
    .filter((e) => typeof e.durationSeconds === "number" && e.durationSeconds > 0)
    .map((e) => [e.id, e.durationSeconds]),
);
console.log(`${inventory.episodes.length} episodes in the inventory, ${seconds.size} with a known runtime`);

const modal = (args) => execFileSync(PYTHON, ["-m", "modal", ...args], {
  cwd: import.meta.dirname, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024,
});

const listed = JSON.parse(modal(["volume", "ls", VOLUME, "/", "--json"]));
const wanted = listed
  .map((entry) => String(entry.Filename ?? entry.filename ?? entry.path ?? ""))
  .map((path) => path.split("/").pop() ?? "")
  .filter((name) => name.startsWith(`${SOURCE.replace(/:/g, "__")}__`) && name.endsWith(".json"));

mkdirSync(STAGING, { recursive: true });
const local = new Set(readdirSync(STAGING));
const missing = wanted.filter((name) => !local.has(name));
console.log(`${wanted.length} on the volume, ${wanted.length - missing.length} already here, ${missing.length} to pull`);

if (!dryRun) {
  for (const [index, name] of missing.entries()) {
    try {
      modal(["volume", "get", VOLUME, `/${name}`, join(STAGING, name), "--force"]);
    } catch {
      /* A file listed a moment ago and unreadable now is one still being
         written. It will be here on the next pass. */
      console.log(`  deferred: ${name}`);
    }
    if ((index + 1) % 25 === 0 || index === missing.length - 1) {
      console.log(`  ${index + 1}/${missing.length}`);
    }
  }
}

/* --- verify, repair, install ---------------------------------------------- */

mkdirSync(INSTALLED, { recursive: true });
const report = { installed: 0, empty: 0, repaired: 0, noRuntime: 0, short: [], coverage: [] };

for (const name of readdirSync(STAGING)) {
  if (!name.startsWith(`${SOURCE.replace(/:/g, "__")}__`) || !name.endsWith(".json")) continue;
  let transcript;
  try {
    transcript = JSON.parse(readFileSync(join(STAGING, name), "utf-8"));
  } catch {
    console.log(`  unreadable: ${name}`);
    continue;
  }

  /* A word, not a file. An early bug wrote well-formed empty transcripts, and
     anything keyed on existence marks exactly the ruined ones as finished. */
  const words = Array.isArray(transcript.words) ? transcript.words : [];
  if (words.length === 0) { report.empty += 1; continue; }

  if (typeof transcript.audioSeconds !== "number" || !(transcript.audioSeconds > 0)) {
    const known = seconds.get(transcript.id);
    if (known) { transcript.audioSeconds = known; report.repaired += 1; }
    else report.noRuntime += 1;
  }

  const runtime = transcript.audioSeconds;
  if (typeof runtime === "number" && runtime > 0) {
    const cover = words[words.length - 1].e / runtime;
    report.coverage.push(cover);
    /* The last word should land near the end. A large shortfall means the
       episode was truncated or the model stopped early. */
    if (cover < 0.9) report.short.push(`${transcript.title ?? transcript.id}  ${(cover * 100).toFixed(0)}%`);
  }

  if (!dryRun) writeFileSync(join(INSTALLED, name), `${JSON.stringify(transcript)}\n`);
  report.installed += 1;
}

report.coverage.sort((a, b) => a - b);
const at = (q) => report.coverage[Math.floor(report.coverage.length * q)] ?? 0;
console.log(`\n  installed:  ${report.installed}${dryRun ? "  (dry run, nothing written)" : ""}`);
console.log(`  repaired:   ${report.repaired} runtimes filled in from the inventory`);
if (report.empty) console.log(`  EMPTY:      ${report.empty} transcripts carry no words`);
if (report.noRuntime) console.log(`  no runtime: ${report.noRuntime} — the timestamp check will not bound these`);
if (report.coverage.length) {
  console.log(`  coverage:   p05 ${(at(0.05) * 100).toFixed(1)}%  median ${(at(0.5) * 100).toFixed(1)}%`);
}
for (const line of report.short) console.log(`  SHORT  ${line}`);
console.log(`  into:       ${INSTALLED}`);
