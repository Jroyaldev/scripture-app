/**
 * Labels anchors with a swarm of Codex calls.
 *
 *   node --import tsx scripts/label-anchors-codex.ts --calibrate
 *   node --import tsx scripts/label-anchors-codex.ts --all [--concurrency 6]
 *
 * CALIBRATE BEFORE TRUSTING, ALWAYS
 *
 * A model labelling a model's output is not ground truth. It is a second
 * opinion, and a second opinion is worth exactly what its agreement with a
 * known-good judgement says it is worth. So `--calibrate` runs the swarm
 * BLIND over the items already labelled by hand — the labeller never sees the
 * human verdict — and reports agreement. Only if that agreement is high does
 * labelling at scale mean anything; if it is low, the swarm's ten thousand
 * verdicts are ten thousand guesses and the hand-labelled thirty remain the
 * only real measurement in the project.
 *
 * The distractors matter more here than anywhere. They are real moments paired
 * with passages chosen at random, and a labeller that does not call them wrong
 * is agreeing with whatever it is shown, which is the failure mode that would
 * quietly validate everything.
 *
 * WHY A SEPARATE MODEL AT ALL
 *
 * The judgement wanted here — is this conversation working THROUGH this
 * passage, or merely touching it — is the one thing the embedding cannot do by
 * construction, since it is the thing the embedding gets wrong. A reader of the
 * actual words can tell "we'll come back to Genesis 13" from a discussion of
 * Genesis 13. That is why this is worth the calls.
 */
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const GOLD = "/Volumes/External/Transcripts/gold-sample.jsonl";
const OUT = "/Volumes/External/Transcripts/codex-labels.jsonl";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const has = (n: string): boolean => process.argv.includes(`--${n}`);
const CONCURRENCY = Number(arg("concurrency", "6"));
const EFFORT = arg("effort", "medium");

interface Item {
  key: string; kind: string; episode: string; passage: string; bref: string;
  at: number; score: number; band: string; tagged: boolean;
  passageText: string; said: string; verdict: string;
}

/**
 * The categories are the whole instrument. "Correct" hides the distinction
 * that matters most — a passage genuinely quoted in service of a different
 * subject is right about the text and wrong about the moment, and a reader
 * sent there feels misled just as much as by a plain error.
 */
const PROMPT = `You are auditing an automatic index that claims a podcast conversation discusses a Bible passage at a particular moment. Your judgement decides whether that claim is shown to pastors preparing sermons, so a generous verdict is worse than a harsh one.

You will be given a PASSAGE and a TRANSCRIPT EXCERPT from the moment the index points at.

Answer only this: what relation does the excerpt have to the passage?

  subject   — the speakers are working through THIS passage here: reading it,
              explaining it, arguing about its meaning, retelling its events.
              This is the only verdict that justifies showing the claim.
  crossref  — the passage is brought in to illuminate a DIFFERENT passage that
              is the real subject of this moment. Right about the text, wrong
              about the moment.
  mention   — named or cited in passing, a sentence or two, no engagement.
  allusion  — unmistakably this passage's content, language or events, but
              never named. Counts as engagement if they are genuinely working
              with it.
  wrong     — a different passage, or nothing to do with it. If the excerpt is
              about a NEIGHBOURING chapter of the same book, that is "wrong",
              not "subject". Chapter precision matters.
  unclear   — you genuinely cannot tell from this excerpt.

Rules:
- Judge ONLY from the excerpt. Do not infer from the episode title.
- Do NOT reward the passage merely being named. Naming without engagement is
  "mention". Engagement without naming is "allusion".
- Being about the right BOOK but the wrong CHAPTER is "wrong".
- Prefer "unclear" over a guess.

Reply with ONE line of JSON and nothing else:
{"verdict":"subject|crossref|mention|allusion|wrong|unclear","confidence":"high|medium|low","why":"<12 words>","evidence":"<a short phrase from the excerpt, or empty>"}`;

function callCodex(item: Item): Promise<{ verdict: string; confidence: string; why: string; evidence: string } | null> {
  const body = `${PROMPT}\n\nPASSAGE: ${item.passage}\n\nPASSAGE TEXT:\n${item.passageText.slice(0, 700)}\n\nTRANSCRIPT EXCERPT:\n${item.said.slice(0, 2600)}\n`;
  return new Promise((resolve) => {
    const child = spawn("codex", [
      "exec", "--sandbox", "read-only", "--skip-git-repo-check",
      "-c", `model_reasoning_effort=${EFFORT}`, "-",
    ], { cwd: process.cwd() });
    let out = "";
    child.stdout.on("data", (d) => { out += String(d); });
    child.stderr.on("data", () => { /* MCP transport noise; the verdict is on stdout */ });
    child.on("close", () => {
      /* The CLI frames its answer with its own chatter, so take the last
         well-formed object rather than assuming a clean stdout. */
      const matches = [...out.matchAll(/\{[^{}]*"verdict"[^{}]*\}/g)];
      const last = matches[matches.length - 1]?.[0];
      if (!last) { resolve(null); return; }
      try { resolve(JSON.parse(last)); } catch { resolve(null); }
    });
    child.on("error", () => resolve(null));
    child.stdin.write(body);
    child.stdin.end();
  });
}

const all = readFileSync(GOLD, "utf-8").trim().split("\n").map((l) => JSON.parse(l) as Item);
const calibrate = has("calibrate");
const items = calibrate ? all.filter((i) => i.verdict) : all.filter((i) => !i.verdict);
if (items.length === 0) { console.error("nothing to label"); process.exit(1); }

console.log(`${calibrate ? "CALIBRATING against hand labels" : "labelling"}: ${items.length} items, ${CONCURRENCY} at a time, effort=${EFFORT}\n`);

const results: Array<Item & { codex: string; confidence: string; why: string; evidence: string }> = [];
let cursor = 0;
let done = 0;
const started = Date.now();

async function worker(): Promise<void> {
  while (cursor < items.length) {
    const item = items[cursor++]!;
    const answer = await callCodex(item);
    done += 1;
    if (answer) {
      results.push({ ...item, codex: answer.verdict, confidence: answer.confidence, why: answer.why, evidence: answer.evidence });
    }
    if (done % 10 === 0 || done === items.length) {
      const rate = done / ((Date.now() - started) / 1000);
      console.log(`  ${done}/${items.length}  ${rate.toFixed(2)}/s  ~${Math.ceil((items.length - done) / rate / 60)}m left`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

writeFileSync(OUT, `${results.map((r) => JSON.stringify(r)).join("\n")}\n`);
console.log(`\nwrote ${results.length} to ${OUT}`);

if (calibrate) {
  const anchors = results.filter((r) => r.kind === "anchor");
  const distractors = results.filter((r) => r.kind === "distractor");
  const agree = anchors.filter((r) => r.codex === r.verdict).length;
  /* The decision the product actually makes is show / do not show, so agreement
     on that binary matters more than agreement on the finer label. */
  const shows = (v: string): boolean => v === "subject" || v === "allusion";
  const binaryAgree = anchors.filter((r) => shows(r.codex) === shows(r.verdict)).length;

  console.log(`\n  DISTRACTOR CONTROL: ${distractors.filter((r) => r.codex === "wrong").length}/${distractors.length} called wrong`);
  console.log(`\n  exact label agreement:   ${agree}/${anchors.length}  (${((agree / anchors.length) * 100).toFixed(0)}%)`);
  console.log(`  show/hide agreement:     ${binaryAgree}/${anchors.length}  (${((binaryAgree / anchors.length) * 100).toFixed(0)}%)`);

  const grid = new Map<string, number>();
  for (const r of anchors) {
    const k = `${r.verdict} -> ${r.codex}`;
    grid.set(k, (grid.get(k) ?? 0) + 1);
  }
  console.log(`\n  human -> codex:`);
  for (const [k, n] of [...grid.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${k.padEnd(26)} ${n}`);
}
