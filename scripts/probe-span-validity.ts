/**
 * Is `until` real, or did the model fill in a plausible number?
 *
 *   node --import tsx scripts/probe-span-validity.ts [--spans 24]
 *
 * Every reference was checked three ways — the book resolves, the timestamp
 * falls inside the episode, the quote appears verbatim. The one field nothing
 * checked is the end of the span, and ranking now rests entirely on it. If the
 * durations are noisy then ordering by duration is ordering by noise, and the
 * whole discovery design is built on a number nobody has looked at.
 *
 * The test has to ask a DIFFERENT question from the one that produced the span,
 * or it is the claim restated. So instead of "where does this discussion end",
 * each probe asks about ONE moment in isolation: is this passage what they are
 * working on right now? The model answering has no idea a span was ever
 * claimed, nor where its edges are.
 *
 * Two probes per span, and the pair is the point:
 *
 *   INSIDE   three quarters of the way through the claimed span. A real span
 *            should still be running here.
 *   OUTSIDE  a little past the claimed end. A real span should have stopped.
 *
 * Either probe alone proves nothing — a model inclined to agree says yes to
 * both, and one inclined to hedge says no to both. Only the DIFFERENCE between
 * them is evidence, which is what makes this a test rather than a second
 * opinion.
 */
import { spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const REPO = new URL("..", import.meta.url).pathname;
const LIBRARY = join(process.env["HOME"] ?? "", "ScriptureLibrary");
const REFS = join(LIBRARY, ".artifacts/references");
const TRANSCRIPTS = join(LIBRARY, ".artifacts/transcripts");

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const SPANS = Number(arg("spans", "24"));
const CONCURRENCY = Number(arg("concurrency", "6"));
/** Enough talk around the moment to judge it, and no more — a wide window
    would let a probe near the edge see into the span it is meant to be
    outside. */
const WINDOW = 40;

const PROMPT = `You are given a short excerpt from the middle of a podcast conversation, and one Bible passage.

Answer one question: at this moment, are the speakers working on that passage — reading it, explaining it, arguing about its meaning, retelling its events?

Judge only the excerpt. Do not guess from what might come before or after. If they have moved on to a different passage or a different topic, the answer is no. If they are merely mentioning it in passing, the answer is no — the question is whether it is what they are working on.

Reply with ONE line of JSON and nothing else:
{"working_on_it": true|false, "why": "<10 words>"}`;

function ask(passage: string, excerpt: string): Promise<boolean | null> {
  const body = `${PROMPT}\n\nPASSAGE: ${passage}\n\nEXCERPT:\n${excerpt}\n`;
  return new Promise((resolve) => {
    const child = spawn("codex", [
      "exec", "--sandbox", "read-only", "--skip-git-repo-check",
      "-c", "model_reasoning_effort=low", "-",
    ], { cwd: REPO });
    let out = "";
    child.stdout.on("data", (d) => { out += String(d); });
    child.stderr.on("data", () => { /* transport noise */ });
    child.on("close", () => {
      const m = [...out.matchAll(/\{[^{}]*"working_on_it"[^{}]*\}/g)];
      const last = m[m.length - 1]?.[0];
      if (!last) { resolve(null); return; }
      try { resolve(JSON.parse(last).working_on_it === true); } catch { resolve(null); }
    });
    child.on("error", () => resolve(null));
    child.stdin.write(body);
    child.stdin.end();
  });
}

interface Probe { passage: string; inside: string; outside: string }
const probes: Probe[] = [];

for (const file of readdirSync(REFS)) {
  if (probes.length >= SPANS) break;
  let t: { segments: Array<{ t: string; s: number }>; audioSeconds: number };
  try { t = JSON.parse(readFileSync(join(TRANSCRIPTS, file), "utf-8")); } catch { continue; }
  const set = JSON.parse(readFileSync(join(REFS, file), "utf-8")) as {
    references: Array<{ title: string; at: number; seconds: number; relation: string }> };

  /* Long spans only. A thirty-second claim has no inside to probe, and the
     spans that matter for ranking are the long ones anyway. */
  const long = set.references.filter((r) => r.relation === "subject" && r.seconds >= 420);
  if (long.length === 0) continue;
  const r = long[0]!;
  const end = r.at + r.seconds;
  const at = (s: number): string => t.segments
    .filter((x) => x.s >= s - WINDOW && x.s <= s + WINDOW).map((x) => x.t).join(" ").slice(0, 1800);

  const insideAt = r.at + r.seconds * 0.75;
  const outsideAt = end + Math.min(180, r.seconds * 0.25);
  if (outsideAt > (t.audioSeconds ?? 0) - WINDOW) continue;
  const inside = at(insideAt);
  const outside = at(outsideAt);
  if (inside.length < 400 || outside.length < 400) continue;

  probes.push({ passage: r.title, inside, outside });
}

console.log(`${probes.length} spans, two probes each — inside at 75%, outside just past the end\n`);

const results: Array<{ passage: string; inside: boolean | null; outside: boolean | null }> = [];
let cursor = 0;
async function worker(): Promise<void> {
  while (cursor < probes.length) {
    const p = probes[cursor++]!;
    const [inside, outside] = await Promise.all([ask(p.passage, p.inside), ask(p.passage, p.outside)]);
    results.push({ passage: p.passage, inside, outside });
    if (results.length % 6 === 0) console.log(`  ${results.length}/${probes.length}`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const usable = results.filter((r) => r.inside !== null && r.outside !== null);
const insideYes = usable.filter((r) => r.inside).length;
const outsideYes = usable.filter((r) => r.outside).length;

console.log(`\n  usable pairs: ${usable.length}`);
console.log(`  still working on it INSIDE the span:  ${insideYes}/${usable.length}  (${((insideYes / usable.length) * 100).toFixed(0)}%)`);
console.log(`  still working on it OUTSIDE the span: ${outsideYes}/${usable.length}  (${((outsideYes / usable.length) * 100).toFixed(0)}%)`);
console.log(`\n  the gap is the evidence: ${((insideYes - outsideYes) / usable.length * 100).toFixed(0)} points`);
console.log(`  no gap means the ends were guessed and duration cannot be ranked on.`);
