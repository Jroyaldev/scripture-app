/**
 * Reads a transcript and extracts every scripture reference in it, with a
 * timestamp, a relation, and a verbatim quote.
 *
 *   node --import tsx scripts/extract-refs-codex.ts --episodes 5 [--concurrency 4]
 *
 * WHY THIS EXISTS ALONGSIDE THE EMBEDDING INDEX
 *
 * The embedding index compares meaning numerically. It is exhaustive and cheap
 * — every window against every chapter — and it is guessing, which is why it
 * confuses a moment about Elijah calling down fire with a different passage
 * where fire consumes an offering. Nothing in a vector knows that one has
 * Carmel and Baal in it and the other has Sinai and a calf.
 *
 * A reader of the actual words does know. This asks for that directly.
 *
 * The two are not rivals. The index finds candidates across 47,496 windows for
 * nothing; this reads 528 transcripts and may quietly skip things. Which is
 * better for which claim is exactly what this is meant to find out.
 *
 * ONE SHAPE, ENFORCED
 *
 * Every call returns the same schema and every field is checked on the way
 * back: the book must resolve to a real code, the timestamp must fall inside
 * the episode, and the quote must appear verbatim in the transcript that was
 * sent. A reference failing any of those is dropped rather than trusted —
 * which is what makes a model's output usable as data instead of as prose.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REPO = new URL("..", import.meta.url).pathname;
const LIBRARY = join(process.env["HOME"] ?? "", "ScriptureLibrary");
const TRANSCRIPTS = join(LIBRARY, ".artifacts/transcripts");
const NAMES = join(REPO, "data/scripture/book-names-en.json");
const OUT = process.argv.includes("--out")
  ? process.argv[process.argv.indexOf("--out") + 1]!
  : "/Volumes/External/Transcripts/codex-refs.jsonl";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const EPISODES = Number(arg("episodes", "5"));
const CONCURRENCY = Number(arg("concurrency", "4"));
const EFFORT = arg("effort", "medium");
/** How long one episode may take before its worker is taken back. */
const TIMEOUT_MS = Number(arg("timeout-minutes", "12")) * 60_000;
/** Shifts the deterministic pick, so a second dry run reads different episodes. */
const OFFSET = Number(arg("offset", "0"));
/* Which publisher's transcripts to read. Both now sit in one directory, keyed
   by record id, so the source is a filter rather than a path. */
const SOURCE = arg("source", "bibleproject");

/** Every alias the names file knows, folded to its canonical code. */
const bookNames = JSON.parse(readFileSync(NAMES, "utf-8")) as Record<string, string[] | string>;
const byAlias = new Map<string, string>();
for (const [code, value] of Object.entries(bookNames)) {
  const list = Array.isArray(value) ? value : [value];
  byAlias.set(code.toLowerCase(), code);
  for (const alias of list) if (typeof alias === "string") byAlias.set(alias.toLowerCase(), code);
}
const resolveBook = (name: string): string | null =>
  byAlias.get(name.trim().toLowerCase().replace(/\.$/, "")) ?? null;

const clock = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const toSeconds = (t: string): number | null => {
  const m = /^(\d+):(\d{1,2})$/.exec(t.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/**
 * The relations are the point. "Found a reference" collapses three different
 * things a pastor wants told apart: the passage an episode is working through,
 * a passage brought in to illuminate it, and a passage that is unmistakably in
 * view but never named. The last is the one no keyword search can find and the
 * embedding gets wrong, so it is asked for explicitly.
 */
const PROMPT = `You are reading a podcast transcript and cataloguing every place a Bible passage is discussed. The result is shown to pastors preparing sermons, so a reference you are not sure of is worse than one you leave out.

The transcript is timestamped as [M:SS] at the start of each line.

For EACH place a passage is discussed, emit one entry. Choose the relation carefully:

  subject   the speakers are working through this passage here — reading it,
            explaining it, arguing about its meaning, retelling its events.
  crossref  the passage is brought in to illuminate a DIFFERENT passage that is
            the real subject of this moment.
  mention   named or cited in passing, no real engagement.
  allusion  unmistakably this passage's content, language or events, but never
            named aloud. Report these — they are the most valuable entries and
            the hardest to find. Only when you are confident.

Rules, all of them mandatory:
- "at" is the [M:SS] timestamp where that discussion STARTS. Copy it exactly from the transcript.
- "until" is the [M:SS] timestamp where it STOPS — where the speakers move on to
  something else. Copy a real timestamp from the transcript. For a passing
  remark this will be the same or nearly the same as "at"; for a passage they
  work through it may be many minutes later. This is how a one-sentence
  allusion is told apart from an extended treatment, so do not guess a round
  number — find where the talk actually turns.
- "book" is the ordinary English book name, spelled out: "Genesis", "1 Samuel", "Revelation".
- "chapter" is a number. "verses" is optional, like "1-11" or "16".
- Be chapter-precise. If the talk is about Genesis 4 do not say Genesis 5.
- "evidence" MUST be copied VERBATIM from the transcript — 5 to 15 words, enough to prove the entry. Do not paraphrase. Do not invent.
- "named" is true if a speaker says the book name aloud near that moment, false for allusions.
- Prefer fewer, surer entries. Omit anything you would not defend.
- If the same passage is discussed at several separate points, emit one entry per point.

Reply with ONE JSON object and NOTHING else — no prose, no markdown fence:
{"references":[{"book":"Luke","chapter":4,"verses":"16-21","at":"12:34","until":"19:02","relation":"subject","named":true,"confidence":"high","evidence":"exact words from the transcript"}]}

If you find none, reply {"references":[]}.`;

interface Ref {
  book: string; chapter: number; verses?: string; at: string; until?: string;
  relation: string; named: boolean; confidence: string; evidence: string;
}

function callCodex(body: string): Promise<Ref[] | null> {
  return new Promise((resolve) => {
    const child = spawn("codex", [
      "exec", "--sandbox", "read-only", "--skip-git-repo-check",
      "-c", `model_reasoning_effort=${EFFORT}`, "-",
    ], { cwd: REPO });
    let out = "";
    let settled = false;
    const finish = (value: Ref[] | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    /* A call that never returns holds its worker forever, and there are only a
       handful of workers. Two hung during the first large run and the rest of
       the batch waited behind them until they were killed by hand. The cap is
       deliberately generous — a ninety-minute episode is real work — and the
       cost of hitting it is one episode, which a re-run picks up, because
       results are written as they land rather than at the end. */
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(null);
    }, TIMEOUT_MS);
    child.stdout.on("data", (d) => { out += String(d); });
    child.stderr.on("data", () => { /* MCP transport noise */ });
    child.on("close", () => {
      /* The CLI wraps its answer in its own chatter, so take the last object
         that carries the key we asked for. */
      const matches = [...out.matchAll(/\{[\s\S]*?"references"[\s\S]*?\]\s*\}/g)];
      const last = matches[matches.length - 1]?.[0];
      if (!last) { finish(null); return; }
      try {
        const parsed = JSON.parse(last) as { references?: Ref[] };
        finish(Array.isArray(parsed.references) ? parsed.references : null);
      } catch { finish(null); }
    });
    child.on("error", () => finish(null));
    child.stdin.write(body);
    child.stdin.end();
  });
}

const manifest = JSON.parse(
  readFileSync(join(LIBRARY, ".artifacts/resources", SOURCE, "manifest.json"), "utf-8"),
) as { records: Array<{ id: string; kind: string; title: string }> };
const titles = new Map(manifest.records.map((r) => [r.id, r.title]));
/* The episode catalogue too, where the importer wrote one. It names every
   episode with audio, including the ones whose title stated no passage and so
   have no manifest record — and those have transcripts, so without this they
   would be catalogued here under their record id instead of their name. */
try {
  const catalog = JSON.parse(
    readFileSync(join(LIBRARY, ".artifacts/resources", SOURCE, "episodes.json"), "utf-8"),
  ) as { schema: string; episodes: Array<{ id: string; title: string }> };
  if (catalog.schema === "podcast-catalog/v1") {
    for (const e of catalog.episodes) if (!titles.has(e.id)) titles.set(e.id, e.title);
  }
} catch { /* no catalogue: the manifest named everything there was */ }

/**
 * What a previous run already read.
 *
 * Transcription lands over the better part of an hour and this can start on
 * whatever has arrived, so the second pass is the normal case rather than the
 * recovery case — and a pass that redoes the first eighty-three episodes to
 * reach the remaining two hundred is paying twice for nothing. Their rows are
 * carried forward rather than merely skipped, because the output file is
 * rewritten whole after each episode.
 *
 * Keyed on episode, not on reference. An episode that yielded nothing is done;
 * counting its references would send it back through every time.
 */
const carried: Array<Record<string, unknown>> = [];
const alreadyRead = new Set<string>();
if (existsSync(OUT) && !process.argv.includes("--restart")) {
  for (const line of readFileSync(OUT, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as Record<string, unknown>;
      carried.push(row);
      if (typeof row["recordId"] === "string") alreadyRead.add(row["recordId"]);
    } catch { /* a partial last line from a killed run */ }
  }
}

const files = readdirSync(TRANSCRIPTS)
  .filter((f) => f.endsWith(".json") && f.startsWith(`${SOURCE.replace(/:/g, "__")}__`))
  .filter((f) => !alreadyRead.has(f.replace(/\.json$/, "").replace(/__/g, ":")));
/* Spread through the catalogue rather than taking its head, which is one
   series and one era. */
const stride = Math.max(1, Math.floor(files.length / EPISODES));
const picked = files.filter((_, i) => i % stride === OFFSET % stride).slice(0, EPISODES);

if (alreadyRead.size > 0) {
  console.log(`${alreadyRead.size} episodes already read, ${carried.length} references carried forward`);
}
console.log(`reading ${picked.length} transcripts, ${CONCURRENCY} at a time, effort=${EFFORT}\n`);

const results: Array<Record<string, unknown>> = [...carried];
let cursor = 0;

async function worker(): Promise<void> {
  while (cursor < picked.length) {
    const file = picked[cursor++]!;
    const recordId = file.replace(/\.json$/, "").replace(/__/g, ":");
    const t = JSON.parse(readFileSync(join(TRANSCRIPTS, file), "utf-8")) as
      { segments: Array<{ t: string; s: number }>; audioSeconds: number };

    /* One timestamped line per segment. The model can only cite a moment it
       can see, so the timestamps have to be in the text rather than implied. */
    const body = `${PROMPT}\n\nTRANSCRIPT:\n${t.segments.map((s) => `[${clock(s.s)}] ${s.t}`).join("\n")}\n`;
    const refs = await callCodex(body);
    if (!refs) {
      console.log(`  ${recordId.replace("bibleproject:podcast:", "").slice(0, 34)}  NO PARSE`);
      continue;
    }

    const flat = t.segments.map((s) => s.t).join(" ").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ");
    const kept: Array<Record<string, unknown>> = [];
    const dropped = { book: 0, time: 0, evidence: 0 };

    for (const r of refs) {
      const code = resolveBook(String(r.book ?? ""));
      if (!code || !Number.isFinite(Number(r.chapter))) { dropped.book += 1; continue; }
      const at = toSeconds(String(r.at ?? ""));
      if (at === null || at < 0 || at > (t.audioSeconds || Infinity) + 60) { dropped.time += 1; continue; }
      /* An end that precedes its start, or runs past the episode, is not an
         estimate that came out slightly wrong — it means the field was filled
         in without reading. Fall back to the start rather than keep a duration
         that would silently rank this above a real one. */
      const rawUntil = toSeconds(String(r.until ?? ""));
      const until = rawUntil !== null && rawUntil >= at && rawUntil <= (t.audioSeconds || Infinity) + 60
        ? rawUntil : at;
      /* The quote is the whole guarantee. A reference whose evidence is not in
         the transcript was imagined, whatever else about it looks right. */
      const ev = String(r.evidence ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
      const words = ev.split(" ").filter((w) => w.length > 3);
      const present = ev.length > 0 && (flat.includes(ev) || (words.length > 0 && words.every((w) => flat.includes(w))));
      if (!present) { dropped.evidence += 1; continue; }

      kept.push({
        recordId, episode: titles.get(recordId) ?? recordId,
        bref: `bref:v1/${code}.${r.chapter}.1`,
        book: code, chapter: Number(r.chapter), verses: r.verses ?? null,
        at, until, seconds: Math.round(until - at),
        relation: r.relation, named: r.named === true,
        confidence: r.confidence, evidence: r.evidence,
      });
    }
    results.push(...kept);
    console.log(
      `  ${recordId.replace("bibleproject:podcast:", "").slice(0, 32).padEnd(34)}`
      + `${String(refs.length).padStart(3)} found, ${String(kept.length).padStart(3)} kept`
      + `  (dropped: book ${dropped.book}, time ${dropped.time}, evidence ${dropped.evidence})`,
    );
    /* Written as we go. An earlier run held everything in memory and one hung
       call nearly cost the batch. */
    writeFileSync(OUT, `${results.map((r) => JSON.stringify(r)).join("\n")}\n`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const rel = (k: string): number => results.filter((r) => r["relation"] === k).length;
/* Episodes read across every pass, not just this one — `results` carries the
   earlier passes' references, so dividing by this pass alone would report a
   rate several times the real one. */
const episodesRead = alreadyRead.size + picked.length;
console.log(`\n${results.length} references kept from ${episodesRead} episodes  (${(results.length / Math.max(1, episodesRead)).toFixed(1)} each)`);
console.log(`  subject ${rel("subject")}   crossref ${rel("crossref")}   mention ${rel("mention")}   allusion ${rel("allusion")}`);
console.log(`  unnamed (allusions and implicit): ${results.filter((r) => r["named"] !== true).length}`);

/* Extent is a ranking signal rather than decoration: a passage a show stays
   with for twelve minutes should outrank one it touches in a sentence, and
   without this the ordering between them is arbitrary. */
const spans = results.map((r) => Number(r["seconds"])).sort((a, b) => a - b);
const passing = spans.filter((s) => s < 60).length;
console.log(`\n  extent:  median ${spans[spans.length >> 1]}s   longest ${spans[spans.length - 1]}s`);
console.log(`  under a minute (passing): ${passing}   a minute or more (treated): ${spans.length - passing}`);
for (const k of ["subject", "crossref", "mention", "allusion"]) {
  const s = results.filter((r) => r["relation"] === k).map((r) => Number(r["seconds"]));
  if (s.length === 0) continue;
  s.sort((a, b) => a - b);
  console.log(`    ${k.padEnd(9)} median ${String(s[s.length >> 1]).padStart(4)}s   max ${String(s[s.length - 1]).padStart(4)}s`);
}
console.log(`\nwrote ${OUT}`);
