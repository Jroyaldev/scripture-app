/**
 * Reads a transcript and extracts every scripture reference in it, with a
 * timestamp, a relation, and a verbatim quote.
 *
 *   node --import tsx scripts/extract-refs-codex.ts --episodes 5 [--concurrency 4]
 *
 * Resumes by default: `--dry-run` reports what a resume would do and spends
 * nothing, `--restart` forgets every earlier pass and reads the source again,
 * `--only <recordId>` reads just the episodes named.
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
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  emptyResume,
  readLogPathFor,
  resumeFrom,
  serializeReadLog,
} from "./reference-read-log.js";

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

/**
 * Why a call produced nothing, which is not one question but four.
 *
 * Every failure used to print NO PARSE, and at four workers that was tolerable
 * because there were few of them and you could read the transcript yourself.
 * At twenty-four it is dangerous: a quota wall, an auth expiry and a genuinely
 * confusing episode all look identical, and each one still costs a message. A
 * run that hits a systemic problem should read as a systemic problem rather
 * than as a model that quietly stopped finding references.
 */
type Refusal = "timeout" | "throttled" | "crashed" | "no-json" | "bad-json";
type CodexResult = { ok: true; refs: Ref[] } | { ok: false; why: Refusal; detail: string };

/* The CLI reports these as prose on its way out rather than as an exit code, so
   the text is the only signal there is. */
const THROTTLED = /rate limit|rate-limit|429|usage limit|quota|too many requests|upgrade to continue/i;

function callCodex(body: string): Promise<CodexResult> {
  return new Promise((resolve) => {
    const child = spawn("codex", [
      "exec", "--sandbox", "read-only", "--skip-git-repo-check",
      "-c", `model_reasoning_effort=${EFFORT}`, "-",
    ], { cwd: REPO });
    let out = "";
    let err = "";
    let settled = false;
    const finish = (value: CodexResult): void => {
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
      finish({ ok: false, why: "timeout", detail: `no answer in ${TIMEOUT_MS / 60000} min` });
    }, TIMEOUT_MS);
    child.stdout.on("data", (d) => { out += String(d); });
    /* Kept now rather than discarded. It was ignored as MCP transport noise,
       which it mostly is — but it is also where a refusal says why. */
    child.stderr.on("data", (d) => { err += String(d); });
    child.on("close", (code) => {
      /* The CLI wraps its answer in its own chatter, so take the last object
         that carries the key we asked for. */
      const matches = [...out.matchAll(/\{[\s\S]*?"references"[\s\S]*?\]\s*\}/g)];
      const last = matches[matches.length - 1]?.[0];
      if (last) {
        try {
          const parsed = JSON.parse(last) as { references?: Ref[] };
          if (Array.isArray(parsed.references)) { finish({ ok: true, refs: parsed.references }); return; }
        } catch {
          finish({ ok: false, why: "bad-json", detail: last.slice(0, 120) });
          return;
        }
      }
      const said = `${out}\n${err}`;
      const throttle = THROTTLED.exec(said);
      if (throttle) { finish({ ok: false, why: "throttled", detail: quotedLine(said, throttle.index) }); return; }
      if (code !== 0) { finish({ ok: false, why: "crashed", detail: `exit ${code}: ${tail(err)}` }); return; }
      finish({ ok: false, why: "no-json", detail: tail(out) });
    });
    child.on("error", (error) => finish({ ok: false, why: "crashed", detail: String(error).slice(0, 120) }));
    child.stdin.write(body);
    child.stdin.end();
  });
}

/** The line a match landed on, so a refusal is quoted rather than paraphrased. */
function quotedLine(text: string, index: number): string {
  const start = text.lastIndexOf("\n", index) + 1;
  const end = text.indexOf("\n", index);
  return text.slice(start, end === -1 ? undefined : end).trim().slice(0, 160);
}

const tail = (text: string): string =>
  text.trim().split("\n").filter(Boolean).slice(-1)[0]?.slice(0, 120) ?? "(silence)";

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
 * Keyed on episode, and — since 2026-07-30 — actually keyed on episode.
 *
 * The comment that stood here claimed it already was, and it was not. Resume
 * was rebuilt from the record ids appearing in the output rows, so an episode
 * that answered honestly with no references wrote no row, left no trace, and
 * was re-read on every subsequent pass forever. Measured on the 2026-07-30
 * sweep: 3,521 transcripts, 3,208 episodes with a reference, 313 episodes
 * paid for and forgotten — about 309 wasted calls in one pass for 22 marginal
 * references. So the ledger beside the output (`.read-log.json`) is now what
 * "already read" means, and the rows only seed it. See
 * `scripts/reference-read-log.ts` for why it is a file of its own.
 */
const READ_LOG = readLogPathFor(OUT);
const restart = process.argv.includes("--restart");
/** Print the resume accounting and stop, without spending a single call. */
const dryRun = process.argv.includes("--dry-run");

const resume = restart
  ? emptyResume()
  : resumeFrom({
    rows: existsSync(OUT) ? readFileSync(OUT, "utf-8") : "",
    log: existsSync(READ_LOG) ? readFileSync(READ_LOG, "utf-8") : null,
  });
const { carried, alreadyRead } = resume;

/** Rewritten whole, and through a temp file: a half-written ledger reads as none. */
function writeReadLog(): void {
  writeFileSync(`${READ_LOG}.tmp`, serializeReadLog(SOURCE, OUT, alreadyRead));
  renameSync(`${READ_LOG}.tmp`, READ_LOG);
}

/**
 * Named episodes, repeatable, for the case a spread sample cannot serve.
 *
 * One episode hit the twelve-minute timeout on a hung call and was left
 * unread while its 675 neighbours were done. Reaching it through the ordinary
 * pick means offering the whole source and taking whatever the stride lands
 * on; naming it costs one call. Resume still wins — an episode already read
 * stays read, and `--restart` is how you overrule that.
 */
const ONLY = new Set(
  process.argv.flatMap((a, i) => (a === "--only" && process.argv[i + 1] ? [process.argv[i + 1]!] : [])),
);

const recordIdOf = (file: string): string => file.replace(/\.json$/, "").replace(/__/g, ":");
const transcripts = readdirSync(TRANSCRIPTS)
  .filter((f) => f.endsWith(".json") && f.startsWith(`${SOURCE.replace(/:/g, "__")}__`));
const files = transcripts
  .filter((f) => !alreadyRead.has(recordIdOf(f)))
  .filter((f) => ONLY.size === 0 || ONLY.has(recordIdOf(f)));
/* Spread through the catalogue rather than taking its head, which is one
   series and one era. Named episodes are already the whole selection. */
const stride = Math.max(1, Math.floor(files.length / EPISODES));
const picked = ONLY.size > 0
  ? files
  : files.filter((_, i) => i % stride === OFFSET % stride).slice(0, EPISODES);

if (resume.unreadableLog) {
  console.log(`  WARNING ${READ_LOG} is not a read log — falling back to the output rows,`);
  console.log(`          so episodes that yielded nothing will be read again.`);
}
if (alreadyRead.size > 0) {
  console.log(
    `${alreadyRead.size} episodes already read (${resume.barren} of them yielded nothing),`
    + ` ${carried.length} references carried forward`,
  );
}
if (dryRun) {
  console.log(
    `\n${SOURCE}: ${transcripts.length} transcripts, ${alreadyRead.size} already read,`
    + ` ${files.length} left to read`,
  );
  process.exit(0);
}
/* Persisted before any call is made, so an output written before the ledger
   existed becomes a ledger even if this run is killed on its first episode. */
if (alreadyRead.size > 0 || existsSync(READ_LOG)) writeReadLog();
console.log(`reading ${picked.length} transcripts, ${CONCURRENCY} at a time, effort=${EFFORT}\n`);

const results: Array<Record<string, unknown>> = [...carried];
let cursor = 0;
const refusals = new Map<Refusal, number>();
/* Set once by whichever worker meets the wall; read by all of them. */
let throttled = false;

async function worker(): Promise<void> {
  while (cursor < picked.length && !throttled) {
    const file = picked[cursor++]!;
    const recordId = file.replace(/\.json$/, "").replace(/__/g, ":");
    const t = JSON.parse(readFileSync(join(TRANSCRIPTS, file), "utf-8")) as
      { segments: Array<{ t: string; s: number }>; audioSeconds: number };

    /* One timestamped line per segment. The model can only cite a moment it
       can see, so the timestamps have to be in the text rather than implied. */
    const body = `${PROMPT}\n\nTRANSCRIPT:\n${t.segments.map((s) => `[${clock(s.s)}] ${s.t}`).join("\n")}\n`;
    const answer = await callCodex(body);
    if (!answer.ok) {
      refusals.set(answer.why, (refusals.get(answer.why) ?? 0) + 1);
      console.log(
        `  ${recordId.replace(/^[a-z-]+:podcast:/, "").slice(0, 32).padEnd(34)}`
        + `${answer.why.toUpperCase().padEnd(10)} ${answer.detail}`,
      );
      /* A quota wall is not this episode's problem, and it will not be the next
         episode's either. Every worker racing on to spend another message
         against a closed door turns one refusal into two hundred, so the run
         stops and says so — and resume means nothing already paid for is lost. */
      if (answer.why === "throttled") { throttled = true; return; }
      continue;
    }
    const refs = answer.refs;

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
    /* The same trimming as the refusal line above, rather than the literal
       "bibleproject:podcast:" this once stripped. With one publisher those were
       the same thing; with eight, every other source kept its whole prefix and
       was then cut to 32 characters — so 5 Minutes in Church History logged
       676 episodes as "five-minutes-church-history:podc" and the run log could
       not say which episode any line was about. That mattered on 2026-07-30:
       the logs were the obvious place to look for which episodes had been read
       when the ledger below did not yet exist, and they could not answer. */
    console.log(
      `  ${recordId.replace(/^[a-z-]+:podcast:/, "").slice(0, 32).padEnd(34)}`
      + `${String(refs.length).padStart(3)} found, ${String(kept.length).padStart(3)} kept`
      + `  (dropped: book ${dropped.book}, time ${dropped.time}, evidence ${dropped.evidence})`,
    );
    /* Written as we go. An earlier run held everything in memory and one hung
       call nearly cost the batch. */
    writeFileSync(OUT, `${results.map((r) => JSON.stringify(r)).join("\n")}\n`);
    /* And the ledger with it. This line is the fix: the episode is recorded as
       read because it was answered, whether or not the answer had anything in
       it. A refusal never reaches here — no answer is not a reading, and it
       must be retried. */
    alreadyRead.add(recordId);
    writeReadLog();
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const rel = (k: string): number => results.filter((r) => r["relation"] === k).length;

/* Reported before the reference counts rather than after, because this is the
   number that decides whether the ones below mean anything. A run that refused
   half its episodes still prints a plausible-looking median. */
const refused = [...refusals.values()].reduce((total, n) => total + n, 0);
if (refused > 0) {
  console.log(`\n  ${refused} episode${refused === 1 ? "" : "s"} produced nothing:`);
  for (const [why, count] of [...refusals].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${why.padEnd(10)} ${count}`);
  }
}
if (throttled) {
  console.log(`\n  STOPPED EARLY — the limit was reached, so the remaining episodes were not attempted.`);
  console.log(`  Nothing already paid for is lost: re-running skips every episode already read.`);
  process.exitCode = 2;
}

/* Episodes read across every pass, not just this one — `results` carries the
   earlier passes' references, so dividing by this pass alone would report a
   rate several times the real one.
 *
 * Read off the ledger rather than reckoned as `already + picked - refused`,
 * which was the same arithmetic the resume bug was made of: it assumed every
 * picked episode was either answered or counted as a refusal, and a throttled
 * run abandons the rest without either. The ledger only ever grows on an
 * answer, so it is the count rather than an estimate of it. */
const episodesRead = alreadyRead.size;
console.log(`\n${results.length} references kept from ${episodesRead} episodes  (${(results.length / Math.max(1, episodesRead)).toFixed(1)} each)`);
console.log(`  subject ${rel("subject")}   crossref ${rel("crossref")}   mention ${rel("mention")}   allusion ${rel("allusion")}`);
console.log(`  unnamed (allusions and implicit): ${results.filter((r) => r["named"] !== true).length}`);

/* Extent is a ranking signal rather than decoration: a passage a show stays
   with for twelve minutes should outrank one it touches in a sentence, and
   without this the ordering between them is arbitrary. */
const spans = results.map((r) => Number(r["seconds"])).sort((a, b) => a - b);
const passing = spans.filter((s) => s < 60).length;
/* A pass whose episodes all answered "nothing here" has no distribution, and
   said so as "median undefineds". An honest zero is now an ordinary outcome
   rather than a sign something went wrong — `--only` on one short episode
   reaches it in a single call. */
if (spans.length === 0) {
  console.log(`\n  extent:  no references, so nothing to distribute`);
} else {
  console.log(`\n  extent:  median ${spans[spans.length >> 1]}s   longest ${spans[spans.length - 1]}s`);
  console.log(`  under a minute (passing): ${passing}   a minute or more (treated): ${spans.length - passing}`);
}
for (const k of ["subject", "crossref", "mention", "allusion"]) {
  const s = results.filter((r) => r["relation"] === k).map((r) => Number(r["seconds"]));
  if (s.length === 0) continue;
  s.sort((a, b) => a - b);
  console.log(`    ${k.padEnd(9)} median ${String(s[s.length >> 1]).padStart(4)}s   max ${String(s[s.length - 1]).padStart(4)}s`);
}
console.log(`\nwrote ${OUT}`);

/* Exit rather than fall off the end.
 *
 * The CLI leaves something behind — a grandchild holding the inherited pipe,
 * most likely — so the event loop stays alive after the last worker returns and
 * the process sits there indefinitely. Pass two printed this summary at 13:55
 * and was still running at 19:30. One of those is a curiosity; a queue of them,
 * left by run after run at thirty-four workers, is a machine slowly filling
 * with processes that have nothing to do.
 *
 * Safe to do bluntly here: every result was written with writeFileSync as it
 * landed, so there is no buffered output to lose. */
process.exit(process.exitCode ?? 0);
