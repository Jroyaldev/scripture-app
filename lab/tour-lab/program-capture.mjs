#!/usr/bin/env node
// Whole-program film capture for the /magic theater.
//
// Walks a named replay through the real page — every compiled shot of every
// step, in order — and photographs what the viewer would see at that moment.
// This is the deterministic equivalent of watching the entire program: the
// page resolves one media-time shot per seek, exactly as it does for a
// reader's own scrub, so a screenshot at each shot boundary plus a settled
// mid-shot frame is the film.
//
// Hermetic by construction: the page runs in QA silent drive, so no publisher
// audio stream, no model route, and no search is ever requested. The harness
// proves that by recording every network request and every console error.
//
//   node lab/tour-lab/program-capture.mjs                        # every named replay
//   node lab/tour-lab/program-capture.mjs exodus-34-mercy-judgment --mobile
//   node lab/tour-lab/program-capture.mjs --motion normal --theme light <id>
//
// Output: output/program-capture/<replay-id>/shots/*.png, index.html
// (the filmstrip), and report.json (shot parity, request firewall, console).

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LAB_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(LAB_DIR, '..', '..');
const DEFAULT_OUT_DIR = path.join(REPO_ROOT, 'output', 'program-capture');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter(Boolean);

const DESKTOP = { width: 1280, height: 720, mobile: false };
const MOBILE = { width: 390, height: 844, mobile: true };
const SHORT_PHONE = { width: 320, height: 568, mobile: true };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function argValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

async function waitForHttp(url, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(url);
      if (response.ok) return true;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${url}`);
    await sleep(250);
  }
}

function startServer(port) {
  const child = spawn(process.execPath, [path.join(LAB_DIR, 'server.mjs')], {
    cwd: REPO_ROOT,
    env: { ...process.env, TOUR_LAB_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', () => {});
  return child;
}

function startChrome(cdpPort, userDataDir) {
  const binary = CHROME_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  if (!binary) throw new Error('no Chrome/Chromium binary found (set CHROME_PATH)');
  const child = spawn(binary, [
    '--headless=new',
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--disable-extensions',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.on('data', () => {});
  return child;
}

async function connect(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let nextId = 0;
  const pending = new Map();
  const listeners = [];
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
      return;
    }
    for (const listener of listeners) listener(message);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, (message) => {
      if (message.error) reject(new Error(`${method}: ${message.error.message}`));
      else resolve(message.result || {});
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const onEvent = (listener) => listeners.push(listener);
  return { send, onEvent, close: () => socket.close() };
}

async function evaluate(cdp, expression) {
  const response = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) {
    throw new Error(`page evaluate failed: ${JSON.stringify(response.exceptionDetails).slice(0, 400)}`);
  }
  return response.result?.value;
}

async function setViewport(cdp, viewport) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: viewport.mobile,
  });
}

async function screenshot(cdp, file) {
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
}

const slug = (value) => String(value).replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();

function shotFileName(stepIndex, shotIndex, shot, suffix = '') {
  const at = String(Math.round(shot.fromSec * 10) / 10).replace('.', '_');
  return `s${stepIndex + 1}-${String(shotIndex).padStart(3, '0')}-${at}s-${slug(shot.component)}-${slug(shot.variant)}-${slug(shot.phase)}${suffix}.png`;
}

function filmstripHtml(replayId, program, entries) {
  const cards = entries.map((entry) => `
      <figure>
        <img src="shots/${entry.file}" loading="lazy" alt="">
        <figcaption><b>${entry.stepId}</b> · ${entry.fromSec}s → ${entry.toSec}s<br>
        ${entry.component} / ${entry.variant} / ${entry.phase}<br>
        <span>${entry.role}${entry.semanticKind ? ` · ${entry.semanticKind}` : ''} · ${entry.transition}${entry.parity === false ? ' · <em>PARITY MISS</em>' : ''}</span></figcaption>
      </figure>`).join('\n');
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>film — ${replayId}</title>
<style>
  body { background: #14120e; color: #cfc7b8; font: 13px/1.5 -apple-system, sans-serif; margin: 24px; }
  h1 { font-size: 18px; font-weight: 600; } h2 { font-size: 14px; margin: 28px 0 10px; color: #9a8f7a; }
  section { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }
  figure { margin: 0; background: #1d1a15; border: 1px solid #2e2921; border-radius: 8px; overflow: hidden; }
  img { display: block; width: 100%; }
  figcaption { padding: 8px 10px; color: #b3a890; } figcaption b { color: #e8dfc9; }
  figcaption span { color: #877d68; } figcaption em { color: #d06a5a; font-style: normal; font-weight: 700; }
</style></head><body>
<h1>${replayId} — ${program.title}</h1>
<section>
${cards}
</section>
</body></html>`;
}

async function captureReplay(cdp, replayId, options) {
  const outDir = path.join(options.outDir, replayId);
  const shotsDir = path.join(outDir, 'shots');
  fs.mkdirSync(shotsDir, { recursive: true });
  const query = `replay=${encodeURIComponent(replayId)}&qa=1&motion=${options.motion}&theme=${options.theme}`;
  await setViewport(cdp, DESKTOP);
  await cdp.send('Page.navigate', { url: `${options.baseUrl}/magic?${query}` });

  const deadline = Date.now() + 30000;
  let program = null;
  while (Date.now() < deadline) {
    await sleep(300);
    program = await evaluate(cdp, `window.__magicQA ? window.__magicQA.program() : null`).catch(() => null);
    if (program?.steps?.length && program.steps.every((step) => step.directed && Array.isArray(step.shots))) break;
    program = null;
  }
  if (!program) throw new Error(`program never became ready for ${replayId}`);

  const entries = [];
  const parityMisses = [];
  const mobileSeen = new Set();

  for (const step of program.steps) {
    const opened = await evaluate(cdp, `window.__magicQA.openStepSilent(${step.index})`);
    if (!opened) throw new Error(`could not open step ${step.id} silently`);
    await sleep(400); // caption window fetch + initial scene mount
    const shots = step.shots;
    for (let shotIndex = 0; shotIndex < shots.length; shotIndex += 1) {
      const shot = shots[shotIndex];
      const atMedia = Number(step.startSec) + Number(shot.fromSec) + 0.05;
      await evaluate(cdp, `window.__magicQA.seekSilent(${atMedia})`);
      await sleep(options.settleMs);
      const state = await evaluate(cdp, `window.__magicQA.getEditorialState().current`);
      const resolvedId = state?.activeShot?.id || null;
      const parity = resolvedId === shot.id;
      if (!parity) parityMisses.push({ stepId: step.id, expected: shot.id, resolved: resolvedId, atMedia });
      const file = shotFileName(step.index, shotIndex, shot);
      await screenshot(cdp, path.join(shotsDir, file));
      entries.push({
        stepId: step.id, fromSec: shot.fromSec, toSec: shot.toSec, role: shot.role,
        component: shot.component, variant: shot.variant, phase: shot.phase,
        transition: shot.transition, semanticKind: shot.semanticKind, file, parity,
      });

      const mobileKey = `${shot.component}/${shot.variant}`;
      if (options.mobile && !mobileSeen.has(mobileKey)) {
        mobileSeen.add(mobileKey);
        for (const [label, viewport] of [['m390', MOBILE], ['m320', SHORT_PHONE]]) {
          await setViewport(cdp, viewport);
          await sleep(350); // theater resize rebuild
          await evaluate(cdp, `window.__magicQA.seekSilent(${atMedia})`);
          await sleep(options.settleMs);
          await screenshot(cdp, path.join(shotsDir, shotFileName(step.index, shotIndex, shot, `-${label}`)));
        }
        await setViewport(cdp, DESKTOP);
        await sleep(350);
        await evaluate(cdp, `window.__magicQA.seekSilent(${atMedia})`);
        await sleep(options.settleMs);
      }
    }
    await evaluate(cdp, `window.__magicQA.closeStepSilent()`);
    await sleep(150);
  }

  fs.writeFileSync(path.join(outDir, 'index.html'), filmstripHtml(replayId, program, entries));
  const report = {
    replayId,
    title: program.title,
    mode: program.mode,
    motion: options.motion,
    theme: options.theme,
    shots: entries.length,
    parityMisses,
    capturedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

async function main() {
  const args = process.argv.slice(2);
  const port = Number(argValue(args, '--port') || 5621);
  const cdpPort = Number(argValue(args, '--cdp-port') || 9333);
  const options = {
    outDir: argValue(args, '--out') || DEFAULT_OUT_DIR,
    baseUrl: `http://127.0.0.1:${port}`,
    mobile: args.includes('--mobile'),
    motion: argValue(args, '--motion') || 'reduce',
    theme: argValue(args, '--theme') || 'dark',
    settleMs: Number(argValue(args, '--settle-ms') || (argValue(args, '--motion') === 'normal' ? 600 : 160)),
  };
  const replayIds = args.filter((arg, index) => !arg.startsWith('--')
    && !['--port', '--cdp-port', '--out', '--motion', '--theme', '--settle-ms'].includes(args[index - 1]));
  if (!replayIds.length) {
    const { listReplayFixtures } = await import('./director-evidence.mjs');
    replayIds.push(...listReplayFixtures().map((fixture) => fixture.id));
  }

  const server = startServer(port);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'magic-capture-'));
  let chrome = null;
  const requests = [];
  const consoleErrors = [];
  try {
    await waitForHttp(`${options.baseUrl}/api/status`);
    chrome = startChrome(cdpPort, userDataDir);
    await waitForHttp(`http://127.0.0.1:${cdpPort}/json/version`);
    let pageTarget = null;
    for (let attempt = 0; attempt < 40 && !pageTarget; attempt += 1) {
      const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
      pageTarget = targets.find((target) => target.type === 'page');
      if (!pageTarget) await sleep(200);
    }
    if (!pageTarget) throw new Error('no CDP page target');
    const cdp = await connect(pageTarget.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    cdp.onEvent((message) => {
      if (message.method === 'Network.requestWillBeSent') {
        requests.push(message.params.request.url);
      }
      if (message.method === 'Runtime.exceptionThrown'
        || (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error')) {
        consoleErrors.push(JSON.stringify(message.params).slice(0, 300));
      }
    });

    const reports = [];
    for (const replayId of replayIds) {
      const report = await captureReplay(cdp, replayId, options);
      reports.push(report);
      console.log(`${replayId}: ${report.shots} shots captured, ${report.parityMisses.length} parity misses`);
    }
    cdp.close();

    const modelRoutes = requests.filter((url) => /\/api\/(tour|whispers|form|direct)\b/.test(url));
    const external = requests.filter((url) => !url.startsWith(options.baseUrl) && !url.startsWith('data:') && !url.startsWith('about:'));
    const firewall = { modelRoutes, external, consoleErrors };
    for (const report of reports) {
      const file = path.join(options.outDir, report.replayId, 'report.json');
      const current = JSON.parse(fs.readFileSync(file, 'utf8'));
      current.firewall = firewall;
      fs.writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`);
    }
    console.log(`requests: ${requests.length} local, ${external.length} external, ${modelRoutes.length} model-route, ${consoleErrors.length} console errors`);
    if (modelRoutes.length || external.length || consoleErrors.length || reports.some((report) => report.parityMisses.length)) {
      process.exitCode = 1;
    }
  } finally {
    chrome?.kill('SIGKILL');
    server.kill('SIGKILL');
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
