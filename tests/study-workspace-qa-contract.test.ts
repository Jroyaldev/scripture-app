import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ATMOSPHERES,
  ATMOSPHERE_LABELS,
  RETIRED_ATMOSPHERE_MATERIALS,
} from "../scripts/qa-support/app-vocabulary.mjs";

const readRepoFile = (path: string): string => readFileSync(path, "utf8");

const packageJson = JSON.parse(readRepoFile("package.json")) as {
  scripts?: Record<string, string>;
};
const desktopQa = readRepoFile("scripts/qa-desktop-reading-control.mjs");
const workspaceBarQa = readRepoFile("scripts/qa-study-workspace-bar.mjs");
const electronMain = readRepoFile("src/electron/main.ts");

test("package scripts keep build steps separate from the runnable QA entrypoints", () => {
  assert.equal(
    packageJson.scripts?.["qa:desktop-reading-control:run"],
    "node scripts/qa-desktop-reading-control.mjs",
  );
  assert.equal(
    packageJson.scripts?.["qa:desktop-reading-control"],
    "npm run build && npm run build:renderer && npm run qa:desktop-reading-control:run",
  );
  assert.equal(
    packageJson.scripts?.["qa:study-workspace-bar:run"],
    "node scripts/qa-study-workspace-bar.mjs",
  );
  assert.equal(
    packageJson.scripts?.["qa:study-workspace-bar"],
    "npm run build && npm run build:renderer && npm run qa:study-workspace-bar:run",
  );
});

test("desktop control retains the Acts 19 precision, ordering, attention, and draft-exit oracle", () => {
  for (const marker of [
    "pericope-d8-qa-",
    'getChapterText("bsb", "ACT", 19)',
    'quote: "Holy Spirit"',
    'quote: "baptism"',
    "qa-d8-later",
    "qa-d8-earlier",
    "selectedBrackets",
    "visible",
    "inspector",
    "Keep editing",
    "Save connection",
    "Discard draft",
    "window.api.appWindow.requestClose()",
  ]) {
    assert.ok(desktopQa.includes(marker), `missing preserved desktop marker: ${marker}`);
  }

  assert.match(desktopQa, /readFileSync\(connectionEventLogPath\)/);
  assert.match(desktopQa, /assert\.deepEqual\([^;]*connectionEventLogBytes[^;]*\)/s);
  assert.ok(
    !desktopQa.includes("createHash") && !desktopQa.includes(".digest("),
    "the authored-log oracle must compare actual JSONL bytes, not hashes",
  );
});

test("desktop control covers the bounded V2 pastoral workflow and active-only startup fixture", () => {
  for (const marker of [
    'view("ACT", 19',
    'view("JHN", 3',
    'view("ROM", 6',
    "Apollos",
    "Ephesus",
    "Priscilla",
    "[data-study-workspace-bar]",
    "[data-study-group-id]",
    "[data-study-tab-id]",
    "[data-study-tab-kind]",
    "[data-study-collapsed-proxy]",
    "[data-study-all-tabs]",
    "[data-study-all-tabs-search]",
    "[data-study-all-tabs-row]",
    "[data-study-group-rename]",
    "[data-study-tab-move]",
    "[data-study-group-collapse]",
    "[data-study-reopen-recent]",
    "[data-study-passage-fallback]",
    "[data-study-entity-unavailable]",
    "[data-study-persistence-status]",
    "STUDY_WORKSPACE_TAB_LIMIT",
    "64",
    "invalid-passage",
    "missing-entity",
    "active-only",
    '[data-dirty="true"]',
    "data-pending-mutation",
    "recovery",
  ]) {
    assert.ok(desktopQa.includes(marker), `missing V2 desktop marker: ${marker}`);
  }

  assert.match(desktopQa, /SCRIPTURE_QA_STUDY_WORKSPACE_TRACE/);
  assert.match(desktopQa, /study-workspace-qa:chapter/);
  assert.match(desktopQa, /study-workspace-qa:entity/);
  assert.match(desktopQa, /Page\.reload/);
  assert.doesNotMatch(
    desktopQa,
    /driver\.evaluate\(`\(await /,
    "CDP Runtime.evaluate does not accept an unwrapped top-level await",
  );
});

test("the request trace is an exact opt-in with no production-side behavior", () => {
  assert.match(
    electronMain,
    /process\.env\["SCRIPTURE_QA_STUDY_WORKSPACE_TRACE"\] === "1"/,
  );
  assert.match(electronMain, /if \(!studyWorkspaceQaTraceEnabled\) return;/);
  assert.match(electronMain, /study-workspace-qa:chapter/);
  assert.match(electronMain, /study-workspace-qa:entity/);
  assert.match(electronMain, /traceStudyWorkspaceQa\("chapter"/);
  assert.match(electronMain, /traceStudyWorkspaceQa\("entity"/);
});

test("workspace-bar QA captures one identical fixture across four atmospheres and the material", () => {
  /* This used to assert six themes by name — light, dark, glass, dark-glass,
     porcelain, onyx — matched as `id: "..."` literals in the tour's source.
     Rev 04 §6 retired that framing: Glass and Candlelight were never
     atmospheres, they were Paper and Ink wearing the translucent material, and
     carrying them as themes meant every colour decision was made six times
     instead of four. There are four appearances and one switch over any of
     them, so the capture matrix is four solid plus the two the retired ids
     actually named.

     It also used to keep its own copy of that list, which is why it went stale
     the moment the tour was corrected: the tours are not in `npm test`, so
     only the test half runs, and a disagreement resolves in favour of the
     stale half by default. Both halves now import one constant, so there is
     nothing left to drift. */
  const expectedCaptures = [
    ...ATMOSPHERES.map((id) => ({ id, material: "solid", file: `${ATMOSPHERE_LABELS[id]}.png` })),
    ...RETIRED_ATMOSPHERE_MATERIALS.map(({ id, material }) => ({
      id,
      material,
      file: `${ATMOSPHERE_LABELS[id]}-${material}.png`,
    })),
  ];
  assert.equal(expectedCaptures.length, 6, "four atmospheres solid, plus the two that were Glass and Candlelight");

  // The tour must derive its matrix from the shared constant, not restate it.
  // A restated list is exactly what drifted, so its absence is the assertion.
  assert.match(
    workspaceBarQa,
    /ATMOSPHERES,\s*\n\s*ATMOSPHERE_LABELS,\s*\n\s*RETIRED_ATMOSPHERE_MATERIALS,/,
    "the workspace-bar tour must import the shared atmosphere constants",
  );
  assert.match(
    workspaceBarQa,
    /const THEMES = \[\s*\.\.\.ATMOSPHERES\.map/,
    "the capture matrix must be derived from ATMOSPHERES, not hand-listed",
  );
  for (const atmosphere of [...ATMOSPHERES, "glass", "dark-glass"]) {
    assert.ok(
      !workspaceBarQa.includes(`id: "${atmosphere}"`),
      `the tour hand-lists id: "${atmosphere}" — derive it from ATMOSPHERES instead`,
    );
  }
  // The tour drives both halves of the axis it now covers.
  assert.ok(workspaceBarQa.includes('material: "solid"'), "solid captures are missing");
  assert.ok(
    workspaceBarQa.includes("material: ${JSON.stringify(theme.material)}"),
    "the material must reach settings, or the translucent captures are solid ones twice",
  );
  assert.match(
    workspaceBarQa,
    /classList\.contains\("material-translucent"\) === \$\{JSON\.stringify\(theme\.material === "translucent"\)\}/,
    "the tour must wait for the material it asked for, in both directions",
  );

  for (const marker of [
    "output/playwright/study-workspace-bar",
    "paper-tabs.png",
    "width: 1180",
    "height: 900",
    "ZOOM_VIEWPORT",
    "width: 590",
    "height: 450",
    "scrollHeight",
    "scrollIntoView",
    "zoomLastTabVisible",
    "named-expanded-study",
    "collapsed-study",
    "bsb",
    "kjv",
    "person",
    "place",
    "patient teacher, fellow worker",
    "active-entity",
    "data-study-all-tabs-search",
    "document.fonts.ready",
    /* `requestAnimationFrame(() => requestAnimationFrame` was here, five times
       over in the tour, as the way a capture waited for the page to settle. It
       is gone as of 2026-07-30 and is replaced by `driver.settle()`: an Electron
       window that has slipped behind another one FREEZES its animations at the
       from-keyframe and throttles rAF to never, so an evaluate that awaits a
       frame does not fail at the gate it belongs to — it hangs the CDP call and
       reports as the tour losing the renderer, with no gate named. The tour
       measures settled states, so it settles them: front the window, await the
       fonts, finish every running animation. */
    "const settle = async ()",
    "document.getAnimations()",
    "Page.bringToFront",
    "pendingScreenshots",
    /* The study control is captured on its own, at 3x, in the clean state and
       after a switch, plus a forced-colours frame. Eleven-pixel type in a 40px
       row is not something a designer can read in a 1180x900 viewport shot, and
       the six theme captures are taken with the All Tabs popover open over the
       page. The names changed with the device on 2026-08-03: the row of chips in
       the band above the strip became one control at the end of it. */
    "study-control.png",
    "study-control-switched.png",
    "study-control-single.png",
    /* Added 2026-07-30 with the waking pass: the tour starts a study from the
       floor IN ONE SESSION and measures the first name again, instead of
       comparing the resting name to the sixteen-study row across two reloads.
       Two loads are two lines, and neither of them is a line waking.

       The 1px flip that sent someone looking — the same chip reading 52 then 53
       — was not sub-pixel layout across reloads. Each shape read was taken the
       instant its chip existed, which is up to 4px into the chip's own 150ms
       `translateX(-4px)` entrance; `loadShape` settles the animations now, and
       that is what the `driver.settle()` inside it is for. */
    "study-control-woken.png",
    /* AND THE GESTURE, added 2026-08-03. Reordering a tab and taking one to
       another study are the same pointer doing two different things, and neither
       had a capture or a gate. Both are driven with real pointer events, because
       a drag is a sequence and the only faithful version of it is the real one. */
    "study-control-drag-shuffle.png",
    "study-control-drag-landing.png",
    "study-control-many.png",
    "study-control-narrow.png",
    "forced-colors.png",
  ]) {
    assert.ok(workspaceBarQa.includes(marker), `missing bar-fixture marker: ${marker}`);
  }
  assert.match(workspaceBarQa, /passageView\("ACT", 19, "bsb"/);
  assert.match(workspaceBarQa, /passageView\("ACT", 19, "kjv"/);
  assert.ok(!workspaceBarQa.includes("createHash") && !workspaceBarQa.includes(".digest("));
});

test("workspace-bar QA computes geometry, material, focus, and accessibility assertions", () => {
  for (const marker of [
    "backgroundAlpha",
    "activeAlpha",
    "popoverAlpha",
    "labelOpacity",
    "railHeight",
    "backdropFilter",
    "elementFromPoint",
    "contrastRatio",
    "hitTarget",
    "neutralHalo",
    "forced-colors",
    "prefers-reduced-motion",
    "rovingTabCount",
    "ArrowRight",
    "managementControl",
    "focusRingWidth",
    "systemSelection",
    /* `systemKeyline` was here and is `systemField` as of 2026-07-30. The tour
       required a border-bottom on the strip under forced colours, and Rev 05
       §05·2 retired every line in the register — a rule under the strip fights
       the fillet that joins the tab to the page — so the check was asking for a
       device the design had removed and the gate could not pass. What it asks
       for now is that forced colours REACH the register at all: the system's
       own field, with forced-color-adjust off. */
    "systemField",
    /* The strip's own new-tab control, seated in the tab row. Added with the
       check, because the plus overhung the row by a pixel into the drag band
       for a day and no source-reading test could have seen it. */
    "openInStrip",
    /* THE STUDY LINE, measured rather than read. `groupVisible` was here and
       is `groupNamedInStrip` now, inverted: it asserted that the strip carried
       a control with a study's name on it, and it pointed at the kicker, then at
       the Manage control, then at a row of chips, and outlived all three.
       Nothing in the strip stands for a study except the control at its end, and
       these are the properties a source-reading test cannot see: that the
       control is IN the register, that no band stands above the tabs any more,
       that the frame's top edge is the register's own 40, that the row carries
       the window's drag region without eating a press on the control, and that
       switching studies moves nothing in the frame.

       RESTATED 2026-08-03 with the device. Every name below that began `chip` or
       `line` named a row that no longer exists — and `bandGone` is the one that
       replaces them all, because the failure this whole pass was about was
       things LIVING in that band rather than anything about how they looked. */
    "groupNamedInStrip",
    "bandGone",
    "frameTop",
    "controlInRegister",
    "faceName",
    "restCount",
    "studyTargets",
    "barDrags",
    "faceNoDrag",
    "faceFilled",
    "sealVisible",
    "studyLineForced",
    "geometryBefore",
    "data-study-face",
    "data-study-start",
    /* AND THE GESTURE'S OWN STATE. Every one of these is written somewhere React
       cannot see it — an offset on a node, a cursor on the document, a proxy in
       a body portal — which is exactly why the tour asserts them together and
       after the fact. A drag that ends down a path nobody wrote a cleanup for
       leaves a tab stranded mid-air under a cursor that will not change back. */
    "data-study-tab-ghost",
    "data-tab-drag",
    "data-drag-live",
    "Input.dispatchMouseEvent",
    "minimumTargetSize",
    "centerVisible",
    "Escape",
    "focusReturn",
    "zeroDuration",
  ]) {
    assert.ok(workspaceBarQa.includes(marker), `missing computed bar check: ${marker}`);
  }
  const unobstructedProbe = workspaceBarQa.indexOf("const unobstructedHitTarget");
  const keyboardFocusProbe = workspaceBarQa.indexOf("const keyboardFocusMetrics");
  const openAllTabs = workspaceBarQa.indexOf('document.querySelector("[data-study-all-tabs]")?.click()');
  assert.ok(
    unobstructedProbe >= 0 && openAllTabs > unobstructedProbe,
    "tab hit testing must run before the All Tabs popover mounts its intentional full-viewport scrim",
  );
  assert.ok(
    keyboardFocusProbe >= 0 && openAllTabs > keyboardFocusProbe,
    "keyboard focus styling must be measured before All Tabs intentionally moves focus to search",
  );
  assert.match(
    workspaceBarQa,
    /normalMetricsExpression\(\s*theme\.id,\s*unobstructedHitTarget,\s*keyboardFocusMetrics,?\s*\)/,
  );
});
