/**
 * Rewrite an inventory's audio URLs to where they actually redirect.
 *
 *   node resolve_redirects.mjs --inventory <in> --out <out> [--concurrency 8]
 *
 * WHY THIS EXISTS
 *
 * Substack's `api.substack.com` returns 403 to Modal's containers and 200 to a
 * laptop, with any user agent — it refuses the address, not the client. The file
 * it fronts is on `substackcdn.com`, which serves Modal perfectly well. So the
 * redirect is followed from here, where it is allowed, and the container is
 * handed the destination.
 *
 * The alternative was fetching 13.7 GB locally and pushing it into the Volume.
 * This costs 301 HEAD requests.
 *
 * WHAT IT COSTS INSTEAD
 *
 * **The output is perishable.** These CDN URLs are signed and carry an expiry —
 * Substack's ran a little under 23 hours. An inventory resolved on Monday and
 * run on Wednesday fails on every episode at once, and the error will say
 * Forbidden rather than expired. Resolve immediately before the run, and resolve
 * again before any retry.
 *
 * Only the pipeline's inventory is rewritten. The manifest keeps the publisher's
 * canonical URL, because that is what a reader's browser requests and a reader's
 * browser is not blocked — and because a signed URL in a stored catalogue would
 * be a link that quietly stops working.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const inPath = resolve(arg("inventory", ""));
const outPath = resolve(arg("out", inPath.replace(/\.json$/, "-resolved.json")));
const concurrency = Number(arg("concurrency", "8"));
/** Pause after each request. Substack needs one; most hosts do not. */
const delayMs = Number(arg("delay-ms", "0"));
const userAgent = arg("user-agent", "scripture-app/transcription");

if (!inPath) {
  console.error("usage: --inventory <path> [--out <path>] [--concurrency N]");
  process.exit(1);
}

const inventory = JSON.parse(readFileSync(inPath, "utf-8"));
const episodes = inventory.episodes ?? [];
console.log(`resolving ${episodes.length} URLs, ${concurrency} at a time`);

let cursor = 0;
let changed = 0;
const failures = [];

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function worker() {
  while (cursor < episodes.length) {
    const index = cursor++;
    const episode = episodes[index];
    /* Already done on an earlier pass. Substack rate-limits hard, so this is
       run repeatedly against its own output until nothing is left rather than
       in one go — and re-requesting a URL that is already the destination
       spends the budget that the unresolved ones need. */
    if (episode.resolvedFrom) continue;

    /* Up to five attempts, backing off. 429 is the expected answer at any real
       concurrency: 8 workers got 243 of 301 refused. */
    let attempt = 0;
    for (;;) {
      attempt += 1;
      try {
        /* GET rather than HEAD: some CDNs answer HEAD from the router without
           ever issuing the redirect, which would leave the URL unchanged and
           the failure to be discovered on the GPU. The body is abandoned as
           soon as the final URL is known. */
        const controller = new AbortController();
        const response = await fetch(episode.audioUrl, {
          headers: { "user-agent": userAgent },
          signal: controller.signal,
        });
        const final = response.url;
        controller.abort();
        if (response.status === 429 && attempt < 5) {
          await sleep(delayMs * 2 ** attempt);
          continue;
        }
        if (!response.ok) { failures.push({ id: episode.id, status: response.status }); break; }
        if (final && final !== episode.audioUrl) {
          episode.resolvedFrom = episode.audioUrl;
          episode.audioUrl = final;
          episode.audioHost = new URL(final).hostname;
          changed += 1;
        }
        break;
      } catch (error) {
        if (attempt >= 5) { failures.push({ id: episode.id, status: String(error).slice(0, 60) }); break; }
        await sleep(delayMs * 2 ** attempt);
      }
    }
    if (delayMs > 0) await sleep(delayMs);
    if ((index + 1) % 50 === 0) console.log(`  ${index + 1}/${episodes.length}  (${changed} rewritten)`);
  }
}

await Promise.all(Array.from({ length: concurrency }, worker));

inventory.audioHosts = [...new Set(episodes.map((e) => e.audioHost))];
inventory.resolvedAt = new Date().toISOString();
inventory.resolvedNote = "audio URLs follow their redirect; signed URLs expire — re-resolve before any retry";

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(inventory, null, 2)}\n`);

console.log(`\n  rewritten: ${changed}/${episodes.length}`);
console.log(`  hosts:     ${inventory.audioHosts.join(", ")}`);
if (failures.length > 0) {
  console.log(`  FAILED:    ${failures.length}`);
  for (const failure of failures.slice(0, 10)) console.log(`    ${failure.status}  ${failure.id}`);
}
console.log(`  wrote      ${outPath}`);
