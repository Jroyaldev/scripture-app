// Headless bench runner — same loop the page uses, no browser.
//
//   node lab/tour-lab/run-cli.mjs --model deepseek-v4-flash --fixture text-genesis-6
//   node lab/tour-lab/run-cli.mjs --model gpt-5.6-luna --prompt "..."
//   node lab/tour-lab/run-cli.mjs --model deepseek-v4-flash --all

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildIndex, indexExists } from './corpus.mjs';
import { runTour, readLedger, rebuildLedger } from './tour-agent.mjs';

const LAB_DIR = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        out[k] = next;
        i += 1;
      } else out[k] = true;
    } else out._.push(a);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const modelKey = String(args.model || 'deepseek-v4-flash');
const fixtures = JSON.parse(fs.readFileSync(path.join(LAB_DIR, 'fixtures.json'), 'utf8')).prompts;

if (args['rebuild-ledger']) {
  const l = rebuildLedger();
  console.log(`ledger rebuilt from ${l.runs} run file(s): $${(l.totalUsd || 0).toFixed(6)}`);
  process.exit(0);
}

let jobs = [];
if (args.all) jobs = fixtures.map((f) => ({ promptId: f.id, prompt: f.prompt }));
else if (args.fixture) {
  const ids = String(args.fixture).split(',').map((s) => s.trim());
  for (const id of ids) {
    const f = fixtures.find((x) => x.id === id);
    if (!f) {
      console.error(`no fixture "${id}". Available: ${fixtures.map((x) => x.id).join(', ')}`);
      process.exit(1);
    }
    jobs.push({ promptId: f.id, prompt: f.prompt });
  }
} else if (args.prompt) jobs = [{ promptId: null, prompt: String(args.prompt) }];
else {
  console.error('usage: --model <key> (--fixture <id[,id]> | --prompt "..." | --all)');
  process.exit(1);
}

if (!indexExists()) {
  process.stdout.write('building corpus index… ');
  const meta = buildIndex();
  console.log(`${(meta.buildMs / 1000).toFixed(1)}s, ${meta.docCount} episodes`);
}

const fmtUsd = (n) => (n == null ? 'n/a' : `$${n.toFixed(6)}`);

for (const job of jobs) {
  console.log(`\n▸ ${modelKey} :: ${job.promptId || 'ad-hoc'}`);
  const record = await runTour({
    ...job,
    modelKey,
    emit: (event, data) => {
      if (event === 'model') {
        console.log(`  slug   ${data.resolution.slug}  (${data.resolution.via}${data.resolution.exact ? '' : ', FALLBACK'})`);
      }
      if (event === 'tool') console.log(`  tool   ${data.name} ${data.summary || ''}`);
      if (event === 'call') console.log(`  call   #${data.i} ${data.latencyMs}ms  in ${data.usage.promptTokens} / out ${data.usage.completionTokens}`);
    },
  });
  if (record.status === 'ok') {
    console.log(`  ✓ "${record.tour.title}" — ${record.tour.steps.length} steps, ${Math.round(record.tour.totalSeconds / 60)} min of audio`);
    for (const s of record.tour.steps) {
      console.log(`      ${s.source} · ${s.episodeTitle} · ${s.startSec}–${s.endSec}s`);
    }
  } else {
    console.log(`  ✗ ${record.error?.code}: ${record.error?.message}`);
  }
  console.log(`  cost   ${fmtUsd(record.cost.totalUsd)} (${record.cost.source})  ${record.totals.promptTokens} in / ${record.totals.completionTokens} out  ${record.totals.modelCalls} calls  ${record.totals.toolCalls} tools  ${(record.totals.wallMs / 1000).toFixed(1)}s`);
  console.log(`  run    lab/tour-lab/runs/${record.runId}.json`);
}

const ledger = readLedger();
console.log(`\nledger total ${fmtUsd(ledger.totalUsd)} over ${ledger.runs} run(s)`);
