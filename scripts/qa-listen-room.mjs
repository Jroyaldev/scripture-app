/**
 * Desktop visual and interaction QA for the Listen room.
 *
 * Usage (app launched with --remote-debugging-port=9222):
 *   node scripts/qa-listen-room.mjs
 *
 * WHAT THIS IS FOR. The room was read as a mockup rather than a finished
 * screen, and every defect named was a state nobody had looked at: a
 * description that could not be opened, a shelf that jumped when its data
 * landed, a series page that got none of the treatment its sibling got. Those
 * are not things a unit test can see. So the gates below are the ones that
 * caught something, and they run against the engine rather than the source.
 *
 * THE GATE THAT MATTERS MOST is `achromatic()`. The room derives every accent
 * from the record's own artwork, and the obvious way to guarantee a visible
 * colour — floor the chroma — is exactly how the BEMA card turned pink: black
 * and white art has no hue, a floor invents chroma anyway, and an undefined
 * hue resolves to 0°, which is red. Two records here are genuinely achromatic
 * (All My Delight is #000000, BEMA's cover reads #ffffff) and both must come
 * out grey. That was found by a reader looking at a card, once. Not twice.
 */

import { mkdirSync, writeFileSync } from "node:fs";

const CDP_HTTP = "http://localhost:9222/json/list";
const OUT_DIR = "docs/ui-audit/listen";

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  return {
    send: (method, params = {}) => new Promise((res) => {
      const msgId = ++id;
      pending.set(msgId, res);
      ws.send(JSON.stringify({ id: msgId, method, params }));
    }),
  };
}

const pages = await (await fetch(CDP_HTTP)).json();
const app = pages.find((p) => p.title === "Pericope");
if (!app) {
  console.error("FAIL: Pericope not on :9222 (launch with --remote-debugging-port=9222)");
  process.exit(1);
}
const cdp = await connect(app.webSocketDebuggerUrl);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * WAKE THE PAGE UP BEFORE ASKING IT ANYTHING.
 *
 * A window launched detached is `visibilityState: "hidden"`, and Chromium
 * throttles a hidden page all the way down: `requestAnimationFrame` never
 * fires and IntersectionObserver never delivers a single callback — not even
 * the initial one. Scrolling still works, React still renders, screenshots
 * still come back. So everything LOOKS live while every observer in the app
 * is switched off.
 *
 * That cost an hour here. The compact bar reported broken through three
 * rounds of fixes and the bar was fine; the tour was interrogating a page
 * that had stopped animating. Any tour in this directory that waits on a
 * transition, an observer, or a frame wants this line.
 */
await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
const awake = await cdp.send("Runtime.evaluate", {
  expression: "document.visibilityState", returnByValue: true,
});
if (awake.result?.result?.value !== "visible") {
  console.error("FAIL: page still hidden — observers will not fire and nothing below is trustworthy");
  process.exit(1);
}

async function evaluate(expression) {
  const resp = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (resp.result?.exceptionDetails) throw new Error(JSON.stringify(resp.result.exceptionDetails).slice(0, 400));
  return resp.result?.result?.value;
}

mkdirSync(OUT_DIR, { recursive: true });
async function shot(name) {
  const resp = await cdp.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${OUT_DIR}/${name}.png`, Buffer.from(resp.result.data, "base64"));
}

const failures = [];
function gate(ok, label, detail = "") {
  console.log(`${ok ? "  ok  " : "FAIL  "}${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

/* A fixed sleep is a guess about a machine you are not on. Every wait here is
   a condition, because the first run of this tour reported an empty shelf and
   no achromatic records — both of which were the tour reading the room mid-
   render, and neither of which was true a second later. */
async function waitFor(expression, label, tries = 60) {
  for (let n = 0; n < tries; n += 1) {
    if (await evaluate(expression)) return true;
    await sleep(250);
  }
  gate(false, `timed out waiting for ${label}`);
  return false;
}

/* ── Into the room ───────────────────────────────────────────────────────── */
await evaluate(`(() => {
  const rail = [...document.querySelectorAll('button')]
    .find((b) => /listen/i.test(b.getAttribute('aria-label') || b.title || b.textContent || ''));
  rail?.click();
  return true;
})()`);

gate(await waitFor(`!!document.querySelector('.listen')`, "the room"), "the room draws");

/* START FROM THE SHELF, whatever the last session left open. The room keeps
   its own state, so a tour that assumes the shelf is showing measures an album
   page instead and reports nonsense with total confidence — which is exactly
   what the first run of this did. */
await evaluate(`(() => {
  const back = document.querySelector('.listen-back');
  if (back) back.click();
  return true;
})()`);
await waitFor(
  `document.querySelectorAll('.listen-shelf').length === 2
   && document.querySelectorAll('.listen-card.is-ghost').length === 0`,
  "both shelves, with the skeleton replaced",
);
/* Covers below the fold are deliberately not fetched — `loading="lazy"` is why
   opening a 22-record shelf costs one screen of images and not twenty-two. So
   the gate is about what is ON SCREEN; a lazy cover that has not loaded is the
   feature working. */
await waitFor(`[...document.querySelectorAll('.listen-cover img')]
  .filter((i) => i.getBoundingClientRect().top < innerHeight)
  .every((i) => i.complete && i.naturalWidth > 0)`, "the visible covers");

const shelf = await evaluate(`(() => {
  const cards = [...document.querySelectorAll('.listen-shelf')].map((s) => ({
    name: s.querySelector('.listen-shelf-name')?.textContent,
    cards: s.querySelectorAll('.listen-card').length,
  }));
  const seen = [...document.querySelectorAll('.listen-cover img')]
    .filter((i) => i.getBoundingClientRect().top < innerHeight);
  return {
    shelves: cards,
    covers: seen.length,
    loaded: seen.filter((i) => i.complete && i.naturalWidth > 0).length,
    ghosts: document.querySelectorAll('.listen-card.is-ghost').length,
  };
})()`);
gate(shelf.ghosts === 0, "the skeleton has been replaced by records");
gate(shelf.loaded === shelf.covers && shelf.covers > 0,
  "every cover the reader can see has loaded", `${shelf.loaded}/${shelf.covers}`);
console.log(`      ${shelf.shelves.map((s) => `${s.name}: ${s.cards}`).join(" · ")}`);
await shot("shelf");

/**
 * THE PINK GATE. Read the accent the engine actually computed for records whose
 * artwork has no hue, and insist the three channels agree. A chroma floor would
 * show up here as a red cast and nowhere else.
 */
const achromatic = await evaluate(`(() => {
  const out = [];
  for (const face of document.querySelectorAll('.listen-card-face')) {
    const tint = face.style.getPropertyValue('--record-tint').trim();
    if (!/^#(000000|ffffff)$/i.test(tint)) continue;
    const play = face.querySelector('.listen-card-play');
    const paint = getComputedStyle(play).backgroundColor;
    /* The engine hands back the oklch it computed, not a legacy rgb triple —
       which is better, because chroma is the number the gate is actually
       about and it can be read straight off rather than inferred from how
       far apart three channels landed. */
    const oklch = paint.match(/^oklch\\(([\\d.]+) ([\\d.]+) ([\\d.]+)/);
    const rgb = paint.match(/^rgba?\\(([\\d.]+),\\s*([\\d.]+),\\s*([\\d.]+)/);
    out.push({
      name: face.querySelector('.listen-card-name')?.textContent,
      tint,
      paint,
      chroma: oklch ? Number(oklch[2])
        : (rgb ? (Math.max(+rgb[1], +rgb[2], +rgb[3]) - Math.min(+rgb[1], +rgb[2], +rgb[3])) / 255 : NaN),
    });
  }
  return out;
})()`);
for (const record of achromatic) {
  /* Not "close to grey" — grey. A floored chroma would land near 0.15 here,
     three orders of magnitude above anything rounding produces. */
  gate(record.chroma < 0.005, `${record.name} (${record.tint}) stays grey`,
    `chroma ${record.chroma} · ${record.paint}`);
}
gate(achromatic.length >= 2, "both achromatic records were actually checked",
  `${achromatic.length} found`);

/* ── An album, opened ────────────────────────────────────────────────────── */
await evaluate(`(() => {
  const face = [...document.querySelectorAll('.listen-card-face')]
    .find((f) => /EveryPsalm/i.test(f.querySelector('.listen-card-name')?.textContent || ''));
  face?.click();
  return true;
})()`);
await waitFor(`!!document.querySelector('.listen-about-text')`, "the album hero");

const album = await evaluate(`(() => {
  const about = document.querySelector('.listen-about-text');
  const hero = document.querySelector('.listen-hero-name');
  return {
    name: hero?.textContent,
    fontPx: hero ? parseFloat(getComputedStyle(hero).fontSize) : 0,
    line: document.querySelector('.listen-hero-line')?.textContent,
    hasAbout: !!about,
    clipped: about ? about.scrollHeight - about.clientHeight > 2 : false,
    more: document.querySelector('.listen-about-more')?.textContent ?? null,
    groups: document.querySelectorAll('.listen-group').length,
    tracks: document.querySelectorAll('.listen-track').length,
    accent: getComputedStyle(document.querySelector('.listen-play-all')).backgroundColor,
    ambient: !!document.querySelector('.listen-ambient'),
    twoLine: getComputedStyle(document.querySelector('.listen-track-title')).webkitLineClamp,
  };
})()`);
console.log(`      ${album.name} — ${album.line} · ${album.groups} groups · ${album.tracks} tracks`);
gate(album.hasAbout && album.more === "More", "the description offers a way in", album.more ?? "no control");
gate(album.fontPx >= 30, "the record's name is display type", `${album.fontPx}px`);
gate(album.ambient, "the album carries a field of its own colour");
gate(album.twoLine === "2", "a track title may take two lines", album.twoLine);
gate(!album.accent.startsWith("rgb(150, 104, 74)"), "the accent is the record's, not the app's seal", album.accent);
await shot("album");

/* THE ARTWORK MUST NOT MOVE. Opening the description used to grow the hero
   row, and the hero bottom-aligns, so the cover was shoved down the page —
   press MORE to read a sentence, watch the record jump. Measured rather than
   eyeballed, because a few pixels of drift is exactly what an eye forgives
   and a reader notices. */
const opened = await evaluate(`(() => {
  const cover = document.querySelector('.listen-cover.is-hero');
  const before = cover.getBoundingClientRect().top;
  document.querySelector('.listen-about-more').click();
  return new Promise((r) => setTimeout(() => {
    const about = document.querySelector('.listen-about-text');
    r({
      open: about.hasAttribute('data-open'),
      whole: about.scrollHeight - about.clientHeight <= 2,
      mask: getComputedStyle(about).maskImage,
      label: document.querySelector('.listen-about-more').textContent,
      moved: Math.round(Math.abs(cover.getBoundingClientRect().top - before)),
    });
  }, 260));
})()`);
gate(opened.open && opened.whole, "the description opens to all of it");
gate(opened.mask === "none", "and drops the fade once there is nothing to fade", opened.mask);
gate(opened.label === "Less", "and says how to close it", opened.label);
gate(opened.moved === 0, "and the artwork does not move when it opens", `${opened.moved}px`);
await shot("album-description-open");

/* ── The bar that takes over when the hero leaves ────────────────────────── */
const bar = await evaluate(`(() => {
  const room = document.querySelector('.listen');
  const before = getComputedStyle(document.querySelector('.listen-bar')).opacity;
  room.scrollTo({ top: 900 });
  return new Promise((r) => setTimeout(() => {
    const el = document.querySelector('.listen-bar');
    r({
      before,
      after: getComputedStyle(el).opacity,
      name: el.querySelector('.listen-bar-name')?.textContent,
      top: Math.round(el.getBoundingClientRect().top),
    });
  }, 700));
})()`);
gate(Number(bar.before) === 0, "the bar is absent while the hero is visible", bar.before);
gate(Number(bar.after) === 1, "and arrives once it is not", bar.after);
gate(!!bar.name, "carrying the record's name", bar.name);
await shot("album-compact-bar");

/* ── A series, which must be the album's sibling and not its poor relation ── */
await evaluate(`document.querySelector('.listen-back').click()`);
await waitFor(`document.querySelectorAll('.listen-shelf').length === 2`, "the shelf again");
await evaluate(`(() => {
  const face = [...document.querySelectorAll('.listen-card-face')]
    .find((f) => /BEMA/i.test(f.querySelector('.listen-card-name')?.textContent || ''));
  face?.click();
  return true;
})()`);
await waitFor(`!!document.querySelector('.listen-track')`, "the series episode list");

const series = await evaluate(`(() => ({
  name: document.querySelector('.listen-hero-name')?.textContent,
  line: document.querySelector('.listen-hero-line')?.textContent,
  ambient: !!document.querySelector('.listen-ambient'),
  hero: !!document.querySelector('.listen-hero'),
  bar: !!document.querySelector('.listen-bar'),
  years: document.querySelectorAll('.listen-group').length,
  tracks: document.querySelectorAll('.listen-track').length,
  dated: document.querySelectorAll('.listen-track-when').length,
}))()`);
console.log(`      ${series.name} — ${series.line}`);
gate(series.ambient && series.hero && series.bar,
  "the series page gets every instrument the album page gets");
gate(/\d{4}–\d{4}/.test(series.line ?? ""), "and says its span", series.line);
gate(/hr/.test(series.line ?? ""), "and its runtime", series.line);
gate(series.dated === series.tracks && series.tracks > 0,
  "every episode row carries its date", `${series.dated}/${series.tracks}`);
await shot("series");

/* ── A record, played as a record ────────────────────────────────────────── */

/* The dock has TWO FACES and one transport. A song must not be handed the
   instruments a ninety-minute exposition needs — fifteen seconds back inside a
   three-minute hymn is a nudge nobody asked for, and a rate control on a psalm
   setting is a control for spoiling it. This is the gate on that, and on the
   thing a record does that a single episode never did: play on. */
await evaluate(`document.querySelector('.listen-back')?.click()`);
await waitFor(`document.querySelectorAll('.listen-shelf').length === 2`, "the shelf");
await evaluate(`(() => {
  const face = [...document.querySelectorAll('.listen-card-face')]
    .find((f) => /^Hymns I$/.test(f.querySelector('.listen-card-name')?.textContent || ''));
  face?.click();
  return true;
})()`);
await waitFor(`document.querySelectorAll('.listen-track-face').length > 0`, "the album's tracks");
/* A track that is NOT already playing, so it loads from the top. Pressing the
   running one toggles it — correct behaviour, and it left an earlier run of
   this tour resumed two seconds from the end of a song, where the seek below
   had nothing left to play. */
await evaluate(`(() => {
  const rows = [...document.querySelectorAll('.listen-track-face')];
  (rows.find((r) => !r.hasAttribute('data-on')) ?? rows[0]).click();
  return true;
})()`);
/* Coerced: a DOM node cannot come back through returnByValue, so an
   uncoerced query is falsy forever and the wait can only time out. */
await waitFor(`!!document.querySelector('.podcast-dock')`, "the dock");
/* LOADED, not RUNNING — and the difference matters for what this tour can
   honestly claim.
 *
 * Everything below tests the record's controls: which instruments a song is
 * given, that they are painted, and that next and previous move the queue.
 * None of that needs the playhead to be moving, and waiting on it made the
 * tour depend on something this harness cannot guarantee: in a headless,
 * occluded Electron window the media clock can sit at zero with the element
 * reporting `paused: false` and `readyState: 4`. Audio played and advanced
 * normally earlier in the same session, so this is the window's condition
 * rather than the player's — but a gate that fails for that reason teaches
 * nobody anything.
 *
 * Generous even so: this is a four-megabyte file off a publisher's CDN, and
 * how fast it arrives is their weather, not ours. */
await waitFor(`(document.querySelector('audio')?.readyState ?? 0) >= 3`, "the song to be loaded", 160);

const face = await evaluate(`(() => {
  const dock = document.querySelector('.podcast-dock');
  const sleeve = dock.querySelector('.podcast-mast-cover img');
  return {
    controls: [...dock.querySelectorAll('.podcast-transport button')].map((b) => b.getAttribute('aria-label')),
    rate: !!dock.querySelector('.podcast-rate'),
    sleeve: !!(sleeve && sleeve.complete && sleeve.naturalWidth > 0),
    coloured: dock.hasAttribute('data-record'),
    named: dock.getAttribute('aria-label'),
    playing: dock.querySelector('.podcast-mast-kind')?.textContent,
    glyph: (() => {
      const path = dock.querySelector('.transport-step svg path');
      const box = path.getBoundingClientRect();
      return {
        fill: getComputedStyle(path).fill,
        w: Math.round(box.width), h: Math.round(box.height),
        painted: box.width > 4 && box.height > 4,
      };
    })(),
  };
})()`);
gate(face.controls.some((l) => /Previous track/.test(l ?? "")) && face.controls.some((l) => /Next track/.test(l ?? "")),
  "a song gets the track either side", face.controls.join(" · "));
/* AND THEY CAN BE SEEN. The dock's icon system draws with strokes and sets
   `fill: none` on every svg inside it, which rendered these two solid glyphs
   as nothing — present, focusable, labelled, invisible. A gate that only
   counts buttons cannot tell that apart from a working transport. */
gate(face.glyph.fill !== "none" && face.glyph.painted,
  "and they are actually painted, not just present",
  `fill ${face.glyph.fill}, ${face.glyph.w}×${face.glyph.h}`);
gate(!face.controls.some((l) => /15 seconds|30 seconds/.test(l ?? "")),
  "and not the instruments a long file needs");
gate(!face.rate, "a song is not offered a playback rate");
gate(face.sleeve, "the record's sleeve is drawn in the mast");
gate(face.coloured, "and the dock wears the record's own colour");
gate(/^Music player/.test(face.named ?? ""), "a song is not announced as a podcast", face.named ?? "");

/* THE RECORD ADVANCES, tested through the control a listener actually presses.
 *
 * An earlier version of this gate seeked to the last seconds of the file and
 * waited for the element's own `ended`. That is the truest possible test and
 * it is the wrong one to leave in a tour: it depends on a four-megabyte file
 * off a publisher's CDN reaching its end inside a long-lived Electron window,
 * and in a window that has been open for an hour the media clock can simply
 * stop advancing while the element still reports itself unpaused. The gate
 * then fails for reasons that have nothing to do with the queue.
 *
 * Auto-advance at the end of a track WAS verified by hand — "Be Still My Soul"
 * ran out and "A Mighty Fortress Is Our God" followed it, with the room's row
 * marking moving too — and the wiring that does it is held at the source level
 * by "the walk is declared, finite, and never a radio" in resources-contract,
 * which asserts that a record ENDS rather than rolling on.
 *
 * What is left here is the same machinery reached the way a listener reaches
 * it: press next, press previous, and see the record move under both.
 */
const stepped = await evaluate(`(() => {
  const dock = document.querySelector('.podcast-dock');
  const was = dock.getAttribute('aria-label');
  [...dock.querySelectorAll('.podcast-transport button')]
    .find((b) => /Next track/.test(b.getAttribute('aria-label') || ''))?.click();
  return new Promise((r) => setTimeout(() => r({
    was,
    now: document.querySelector('.podcast-dock')?.getAttribute('aria-label'),
    marked: document.querySelector('.listen-track-face[data-on] .listen-track-title')?.textContent,
  }), 1200));
})()`);
gate(stepped.now !== stepped.was, "next moves the record on",
  `${stepped.was} -> ${stepped.now}`);
gate(!!stepped.marked && stepped.now?.includes(stepped.marked),
  "and the room follows it there", stepped.marked ?? "nothing marked");

const back = await evaluate(`(() => {
  const dock = document.querySelector('.podcast-dock');
  const audio = document.querySelector('audio');
  /* Under the restart threshold, so "previous" means the track before this one
     rather than the top of this one. */
  audio.currentTime = 0;
  const was = dock.getAttribute('aria-label');
  [...dock.querySelectorAll('.podcast-transport button')]
    .find((b) => /Previous track/.test(b.getAttribute('aria-label') || ''))?.click();
  return new Promise((r) => setTimeout(() => r({
    was, now: document.querySelector('.podcast-dock')?.getAttribute('aria-label'),
  }), 1200));
})()`);
gate(back.now !== back.was, "and previous brings it back", `${back.was} -> ${back.now}`);

/* At the ends of a record the controls say so rather than doing nothing.
   Walked back to the top first — the check needs to be AT the boundary, and
   the run before this left us one track inside it. */
const ends = await evaluate(`(() => {
  const dock = document.querySelector('.podcast-dock');
  const prev = () => [...dock.querySelectorAll('.podcast-transport button')]
    .find((b) => /Previous track/.test(b.getAttribute('aria-label') || ''));
  const step = () => {
    document.querySelector('audio').currentTime = 0;
    const button = prev();
    if (button && !button.disabled) { button.click(); return true; }
    return false;
  };
  return new Promise((r) => {
    let guard = 0;
    const walk = () => {
      if (guard++ > 30 || !step()) {
        document.querySelector('audio').currentTime = 0;
        setTimeout(() => r({ firstTrackPrevDisabled: prev()?.disabled ?? null }), 300);
        return;
      }
      setTimeout(walk, 350);
    };
    walk();
  });
})()`);
gate(ends.firstTrackPrevDisabled === true,
  "at the top of a record, previous is dimmed rather than dead",
  String(ends.firstTrackPrevDisabled));

/* The tour plays audio and does not leave it playing. */
await evaluate(`(() => { const a = document.querySelector('audio'); a?.pause(); return true; })()`);

/* ── Escape leaves, from either page ─────────────────────────────────────── */
const left = await evaluate(`(() => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return new Promise((r) => setTimeout(() => r(!!document.querySelector('.listen-shelf')), 400));
})()`);
gate(left, "Escape leaves a series, the way it already left an album");

console.log(`\n${failures.length === 0 ? "PASS" : `FAIL (${failures.length})`} — captures in ${OUT_DIR}/`);
process.exit(failures.length === 0 ? 0 : 1);
