import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "..");
const read = (path: string): string => readFileSync(resolve(root, path), "utf8");

/**
 * The file with its prose taken out.
 *
 * Same instrument, same reason, as the resources contract beside this: every
 * ordering and absence asserted below is about what the CODE does, and each
 * would otherwise be satisfied by the comment explaining it — which is exactly
 * the comment this codebase asks for.
 */
const code = (path: string): string => read(path)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .map((line) => line.replace(/(^|[^:\w"'`])\/\/.*$/, "$1"))
  .join("\n");

/**
 * LISTENING MEMORY — a place per episode, and the four ways it can go wrong.
 *
 * The room now remembers every episode rather than only the last one, keeps a
 * queue as a recipe, and puts the place down before the app closes. Each of
 * those has one failure mode that is invisible in review and cheap to assert:
 *
 *   1. A SETTINGS KEY THAT SKIPS ITS NORMALISER. `settings:set` spreads the
 *      partial RAW and then overrides only the keys named after it. A key added
 *      to the schema and forgotten in either handler is written to disk exactly
 *      as the renderer sent it and read back the same way — which is the whole
 *      thing this main process exists to prevent.
 *
 *   2. A LEDGER THAT FAILS WHOLE. `normalizeLastHeard` fails closed on one bad
 *      field and is right to; the same rule on a map of hundreds would let a
 *      single malformed entry erase every position a reader had.
 *
 *   3. A POSITION FILED UNDER THE WRONG EPISODE. Setting `element.src` queues a
 *      `pause` that lands after `nowPlaying` has moved on. The outgoing place
 *      must be captured BEFORE the src changes, and the shutter closed for
 *      everything the load algorithm fires afterwards.
 *
 *   4. AUDIO THAT STARTS ITSELF. A resume is an offer. Nothing reached from
 *      boot may press play, because `preload="none"` is a permission boundary
 *      and an autoplaying relaunch would tell a publisher the app had opened.
 */

test("every listening key is normalised on the way in and on the way out", () => {
  const main = code("src/electron/main.ts");

  const reader = main.slice(main.indexOf("const readSettings = ()"));
  const readBody = reader.slice(0, reader.indexOf("ipcMain.handle(\"settings:get\""));
  assert.match(readBody, /heardLedger: normalizeHeardLedger\(/);
  assert.match(readBody, /listeningRate: normalizeListeningRate\(/);

  const writer = main.slice(main.indexOf("ipcMain.handle(\"settings:set\""));
  const writeBody = writer.slice(0, writer.indexOf("ipcMain.handle(\"dialog-open-directory\""));
  assert.match(writeBody, /heardLedger: normalizeHeardLedger\(/);
  assert.match(writeBody, /listeningRate: normalizeListeningRate\(/);
  // The hasOwnProperty pattern is what distinguishes "absent" from "cleared".
  assert.match(writeBody, /hasHeardLedger = Object\.prototype\.hasOwnProperty\.call\(partial, "heardLedger"\)/);
});

test("the ledger drops bad entries one at a time and keeps their neighbours", () => {
  const main = code("src/electron/main.ts");
  const start = main.indexOf("function normalizeHeardLedger(");
  assert.ok(start > 0, "normalizeHeardLedger must exist");
  const body = main.slice(start, main.indexOf("\nfunction ", start + 10));

  /* `continue` and not `return`: the difference between dropping one place and
     dropping the reader's whole listening history. */
  assert.ok(
    body.split("continue;").length - 1 >= 4,
    "each malformed field must skip its own entry rather than fail the map",
  );
  assert.ok(
    !/return \{\};[\s\S]*positionSeconds/.test(body.slice(body.indexOf("for ("))),
    "no bail-out inside the entry loop — one bad entry must not empty the map",
  );
  // Bounded here, so an overgrown file heals on the next write.
  assert.match(body, /slice\(0, LEDGER_ENTRIES\)/);
  assert.match(body, /heardAt/);
});

test("a bad queue recipe costs only the recipe, never the resume", () => {
  const main = code("src/electron/main.ts");
  const start = main.indexOf("function normalizeLastHeard(");
  const body = main.slice(start, main.indexOf("\nconst LEDGER_ENTRIES", start));
  const queueAt = body.indexOf("const rawQueue");
  assert.ok(queueAt > 0, "the recipe must be validated inside normalizeLastHeard");
  /* Every `return null` in this function is a whole-record refusal. None may
     live after the recipe is examined, or an album that could not be rebuilt
     would read as "you have never listened to anything". */
  assert.ok(
    !body.slice(queueAt).includes("return null"),
    "a malformed recipe must be omitted, not fail the whole lastHeard",
  );
});

test("the outgoing place is captured before the source changes, and the shutter closes", () => {
  const player = code("src/renderer/components/PodcastPlayer.tsx");
  const start = player.indexOf("export function playPodcastEpisode(");
  assert.ok(start > 0);
  const body = player.slice(start, player.indexOf("\nexport function resumePodcast(", start));

  const captured = body.indexOf("rememberHeard(element.currentTime, { force: true })");
  const shutter = body.indexOf("heardSuppressed = true");
  const source = body.indexOf("element.src = episode.audioUrl");
  assert.ok(captured > 0, "the outgoing track's place must be captured here");
  assert.ok(shutter > 0, "writes must be suppressed across the change");
  assert.ok(source > 0);
  assert.ok(
    captured < shutter && shutter < source,
    "capture, then suppress, then re-point — any other order files a position under the wrong episode",
  );

  /* The write this stops is itself a forced one, so the shutter has to be
     checked ahead of the force escape rather than behind it. */
  const remember = player.slice(player.indexOf("function rememberHeard("));
  const guard = remember.indexOf("if (heardSuppressed) return;");
  const forceCheck = remember.indexOf("now - heardWrittenAt < HEARD_CADENCE_MS");
  assert.ok(guard > 0 && guard < forceCheck, "suppression must not be escapable by force");
});

test("the shutter cannot stick", () => {
  const player = code("src/renderer/components/PodcastPlayer.tsx");
  assert.match(player, /function fileIsReal\(\): void \{\s*heardSuppressed = false;/);
  /* Four releases, and `onError` is the one that matters: a file that never
     loads would otherwise leave the ledger deaf for the rest of the session. */
  for (const handler of ["onError", "onLoadedMetadata", "onPlaying", "onTimeUpdate"]) {
    const at = player.indexOf(`${handler}={`);
    assert.ok(at > 0, `${handler} must exist`);
    const chunk = player.slice(at, at + 420);
    assert.ok(chunk.includes("fileIsReal()"), `${handler} must release the shutter`);
  }
});

test("closing the dock puts the offer away and keeps the library record", () => {
  const player = code("src/renderer/components/PodcastPlayer.tsx");
  const start = player.indexOf("function forgetHeard(");
  const body = player.slice(start, player.indexOf("\n}", start));
  assert.ok(body.includes("announceHeard(null)"), "the offer goes");
  assert.ok(
    !body.includes("ledger.clear()") && !body.includes("ledger.delete("),
    "the cross means done listening now, not erase what was heard",
  );
  // And it still writes the ledger through, so the two cannot drift apart.
  assert.match(body, /writeHeard\?\.\(null, Object\.fromEntries\(ledger\)\)/);
});

test("the place is flushed before the window resolves its close", () => {
  const app = code("src/renderer/app.tsx");
  const start = app.indexOf("onCloseRequested((request)");
  const body = app.slice(start, app.indexOf("}), [runWorkspaceTransition]);", start));
  const flush = body.indexOf("flushPodcastListening()");
  const resolve_ = body.indexOf("resolveCloseRequest");
  assert.ok(flush > 0, "the listening position must be flushed on close");
  assert.ok(flush < resolve_, "and flushed before the close is answered");
  /* Fifteen seconds of listening must never trap somebody in an app they asked
     to leave — unlike the workspace flush below it, this one cannot veto. */
  assert.match(body, /try \{ await flushPodcastListening\(\); \} catch/);
});

test("nothing reached from boot starts audio", () => {
  const app = code("src/renderer/app.tsx");
  for (const verb of ["playPodcastEpisode(", "startPodcastQueue(", "resumePodcastHeard("]) {
    assert.ok(
      !app.includes(verb),
      `app.tsx must not call ${verb} — a resume is an offer, and a relaunch that played would tell a publisher the app had opened`,
    );
  }
  // What it may do is hand the room a rebuilt record for the offer to use.
  assert.match(app, /offerPodcastRecord\(/);
});

test("the resume rebuilds its record from local data only", () => {
  const app = code("src/renderer/app.tsx");
  const start = app.indexOf("async function rebuildHeardRecord(");
  assert.ok(start > 0);
  const body = app.slice(start, app.indexOf("\nexport function App(", start));
  assert.ok(!/fetch\(|XMLHttpRequest|new Image\(/.test(body), "no network before a press");
  assert.match(body, /window\.api\.audio\.catalogue\(/);
  /* The anchor has to survive the rebuild, or a resumed record would start
     somewhere the reader never was. */
  assert.match(body, /if \(!episodes\.some\(/);
});

test("the reader's lists are normalised on the way in and on the way out", () => {
  const main = code("src/electron/main.ts");
  const reader = main.slice(main.indexOf("const readSettings = ()"));
  assert.match(
    reader.slice(0, reader.indexOf("ipcMain.handle(\"settings:get\"")),
    /playlists: normalizePlaylists\(/,
  );
  const writer = main.slice(main.indexOf("ipcMain.handle(\"settings:set\""));
  assert.match(
    writer.slice(0, writer.indexOf("ipcMain.handle(\"dialog-open-directory\"")),
    /playlists: normalizePlaylists\(/,
  );
});

test("a playlist stores identities, never anything fetchable", () => {
  const main = code("src/electron/main.ts");
  const start = main.indexOf("function normalizePlaylists(");
  assert.ok(start > 0);
  /* Anchored on CODE, not on the comment that follows it: `code()` strips block
     comments, so a comment used as an end marker does not exist by the time the
     slice runs — and the slice silently ran to the end of the file, where it
     found `officialUrl` in a normaliser three functions away. */
  const body = main.slice(start, main.indexOf("function normalizeListenSeriesOrder(", start));
  assert.ok(body.length > 0 && body.length < 4000, "the slice must be this function alone");
  /* No url, no artwork, no duration. Everything drawable or playable is
     resolved against the live catalogue when the list is opened — which is what
     keeps a muted publisher's tracks out of a playlist, keeps a renamed track
     showing its new name, and keeps anything on this list from ever becoming
     an `<img src>` or a fetch. */
  /* `durationSeconds` and `duration` are here because the comment above already
     claimed them and the assertion did not — a contract that says one thing and
     checks another is worse than none, because it is read as covered. The claim
     is enforced now: the episode shape carries a duration and the playlist rows
     print one, so the tempting shortcut is real and this is what stops it. A
     length cached on an entry would survive a re-cut file, an unmuted publisher
     and a re-import, and would be wrong after all three. */
  for (const forbidden of [
    "audioUrl", "artUrl", "officialUrl", "cover", "tint", "durationSeconds", "duration",
  ]) {
    assert.ok(!body.includes(forbidden), `a playlist entry must not carry ${forbidden}`);
  }
  // And per-entry drops, like the ledger, so one bad row costs only itself.
  assert.ok(body.split("continue;").length - 1 >= 3);
  assert.match(body, /PLAYLISTS_MAX/);
});

test("a playlist fills the queue and is never a machine of its own", () => {
  const room = code("src/renderer/components/ListenPage.tsx");
  /* There is one advancing machine for records and one for passages, and the
     note beside them says why a third ANSWER to "what plays next" is how a
     listener lands somewhere nobody chose. A playlist resolves to episodes and
     hands them over; it does not advance itself. */
  assert.match(room, /startPodcastQueue\(list\.name, live, from\)/);

  const player = code("src/renderer/components/PodcastPlayer.tsx");
  const machines = player.match(/export function startPodcast(Walk|Queue)\(/g) ?? [];
  assert.equal(machines.length, 2, "exactly two advancing machines, still");

  /* The menu is a way to FILL a list, so it must not become a fourth way to
     start audio behind the caller-list contract's back. */
  const menu = code("src/renderer/components/AddToPlaylist.tsx");
  assert.ok(
    !/startPodcastQueue\(|playPodcastEpisode\(|resumePodcast\(/.test(menu),
    "the add-to-playlist menu adds; it never plays",
  );
  const store = code("src/renderer/playlists.ts");
  assert.ok(!/startPodcastQueue\(|playPodcastEpisode\(/.test(store));
});

test("the add-to-playlist menu is placed in every room that can ask for it", () => {
  /* THE FAILURE THIS EXISTS FOR was not wrong code — it was correct code absent
     from three of the four places it had to be. `<AddToPlaylist>` was mounted
     once, in the shelf's return, while the rows that can ASK for it live on the
     album and series pages, whose branches return long before the shelf's does.
     Right-clicking a track set the state, re-rendered, and drew nothing. Both
     empty states instructed the reader to use that gesture. Nothing failed;
     nothing happened.

     Built once and placed four times, so the count is the assertion. A fifth
     return added later without a placement fails here rather than silently
     shipping another dead room. */
  const room = code("src/renderer/components/ListenPage.tsx");
  assert.equal(
    (room.match(/<AddToPlaylist /g) ?? []).length, 1,
    "one construction — four copies is three chances to drift",
  );
  assert.equal(
    (room.match(/\{menu\}/g) ?? []).length, 4,
    "placed in the playlist, series, album and shelf returns",
  );

  /* And the guard that makes it survivable. Both Escape handlers are on
     `window` and the room's registers first, so without this the popover's
     stopImmediatePropagation lands too late and one press closes the menu AND
     leaves the record. */
  const escape = room.slice(room.indexOf("if (!opened) return undefined;"));
  assert.match(
    escape.slice(0, 400),
    /event\.key !== "Escape" \|\| ask/,
    "the record's Escape must stand down while something smaller is open",
  );
});

test("the renderer never asks a question the engine cannot draw", () => {
  /* `window.prompt` is not implemented in Electron's renderer — it THROWS. The
     playlist rename called it, so Rename did nothing at all in the shipped app,
     and the `was != null` beside it read like careful cancel-handling while the
     call above it never returned a value to guard. It was the only one in the
     whole renderer, which is why nobody had met it: every other question this
     app asks, it asks in its own window on the reader's own page.

     Asserted across the renderer rather than at the one call site, because the
     next one will be written somewhere else. */
  const files = readdirSync(resolve(root, "src/renderer/components"))
    .filter((name) => name.endsWith(".tsx") || name.endsWith(".ts"))
    .map((name) => `src/renderer/components/${name}`)
    .concat(["src/renderer/app.tsx", "src/renderer/playlists.ts", "src/renderer/listen-view.ts"]);
  for (const file of files) {
    assert.doesNotMatch(
      code(file),
      /\bwindow\.(prompt|confirm|alert)\s*\(/,
      `${file}: Electron does not implement this — ask in the app's own window`,
    );
  }
});

test("the sung half of a seeded list cannot eat the spoken half", () => {
  /* THE DEFECT THIS PINS was arithmetic, not logic. `SEEDED_MAX` was checked in
     the podcast loop only, and the music loop ran ahead of it unbounded — so a
     chapter with twenty-five or more settings filled the list before the passage
     index was ever consulted. Psalm 119 has exactly twenty-five in EveryPsalm.
     "Psalm 119" seeded twenty-five songs and no teaching at all, silently, on
     the psalm most likely to be tried as a stress test, and the feature's stated
     premise — a psalm, a sermon and a hymn on one list — was defeated by a loop
     that simply got there first.

     Asserted against the sung loop's own slice rather than the file at large,
     because a bound that lives anywhere else is not a bound on this loop. */
  const room = code("src/renderer/components/ListenPage.tsx");
  const sung = room.indexOf("for (const album of MUSIC.albums)");
  const spoken = room.indexOf("window.api.passages.moments(");
  assert.ok(sung > 0 && spoken > sung, "the sung loop must still run before the spoken half");
  assert.match(
    room.slice(sung, spoken),
    /entries\.length >= SEEDED_SUNG_MAX/,
    "the music loop must carry its own ceiling — the spoken loop's SEEDED_MAX arrives too late",
  );

  /* And the ceiling has to leave room. Equal caps would be no cap. */
  const sungMax = /const SEEDED_SUNG_MAX = (\d+);/.exec(room)?.[1];
  const seededMax = /const SEEDED_MAX = (\d+);/.exec(room)?.[1];
  assert.ok(sungMax && seededMax, "both ceilings must be named constants");
  assert.ok(
    Number(sungMax) < Number(seededMax),
    "the sung ceiling must be strictly under the list ceiling, or the spoken half can still starve",
  );
});

test("the plate fallback survives having no live example", () => {
  /* THE HAZARD THIS EXISTS FOR. The hero draws a publisher's own mark on their
     own colour when a source carries no cover art, and the room's tour used to
     prove it against BibleProject — the one show that had none. Then the
     maintainer widened the image allowlist, BibleProject got its cover, and the
     fallback stopped being reachable from any page the tour can visit.
     Unreachable is not the same as unneeded: it is what the NEXT publisher
     without artwork will wear, and code that nothing exercises is code that
     quietly rots until somebody deletes it as dead.
     So the branch is pinned here instead, where it does not depend on a show
     happening to lack a cover. */
  const room = code("src/renderer/components/ListenPage.tsx");
  assert.match(room, /plate\?: string;/, "the hero must still accept a plate");
  assert.match(room, /listen-card-plate/, "and still draw one when there is no art");
  /* Passed by the series page, which is the surface that can meet a publisher
     the packaged art files do not cover. */
  assert.match(room, /plate=\{openedSeries\.id\}/);

  /* And the tokens it draws with. `.listen-card-plate` was absent from every
     brand-token selector group until the two onboarded shows exposed it, so the
     plate resolved `--resource-source` to nothing and painted an empty square on
     both the shelf and the hero. */
  const css = read("src/renderer/styles.css");
  const groups = css.match(/\.listen-card-plate\[data-source="[a-z0-9-]+"\],/g) ?? [];
  assert.ok(
    groups.length >= 13,
    `the plate must be in every publisher's token group — found ${groups.length}`,
  );
});

test("one shaper builds episode identities, not two", () => {
  /* A track's id is what every surface matches on. Two shapers drifting by a
     character means a resumed album plays while the room shows nothing
     playing — invisible in review, obvious and baffling in use. */
  const room = code("src/renderer/components/ListenPage.tsx");
  assert.ok(
    !room.includes("function asEpisode(") && !room.includes("function trackId("),
    "the room must import the shaper rather than keep its own copy",
  );
  assert.match(room, /from "\.\/listen-episodes"/);

  const shaper = code("src/renderer/components/listen-episodes.ts");
  assert.match(shaper, /export function trackId\(/);
  assert.match(shaper, /export function asEpisode\(/);
  /* The shaper is a `.ts` file, so the caller-list contract that names three
     components does not scan it. It must not become a fourth way to start
     audio behind that contract's back. */
  assert.ok(
    !/startPodcastQueue\(|playPodcastEpisode\(/.test(shaper),
    "the shaper shapes and resolves; it never plays",
  );
});
