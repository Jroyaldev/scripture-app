/**
 * What the app can actually say — and a `waitFor` that refuses to wait for
 * anything else.
 *
 * The tours' worst failure has never been a wrong selector: a wrong selector
 * throws, and a thrown tour gets read. The worst failure is a `waitFor` gated
 * on a state the components have no way to emit. `waitFor` does not fail on an
 * impossible condition — it spins until its timeout, and a tour that spins
 * reads exactly like a tour running against a slow app. Everything below the
 * gate silently never runs, including whatever measurement was added to prove
 * the fix that the gate was written for.
 *
 * The timeout is not the bug. The bug is that a condition which is false
 * *because the app has not got there yet* and a condition which is false
 * *because the app cannot ever get there* are indistinguishable at runtime.
 * The only way to tell them apart is to know, before waiting, which states are
 * reachable — so that is written down here, once, with the emitter cited.
 *
 * Two rules keep this file honest:
 *
 *   1. `waitForState` parses a gate before it waits, and throws immediately if
 *      the gate names a governed attribute with a value not listed here. An
 *      impossible gate now fails in milliseconds, saying so.
 *   2. `tests/qa-tour-vocabulary-contract.test.ts` runs inside `npm test` — no
 *      Electron, no library, no debugging port — and asserts both that this
 *      table still matches the renderer and that no tour gates on a value
 *      outside it. The tours went stale precisely because nothing cheap ever
 *      looked at them; that test is the cheap thing that looks.
 *
 * When a component gains a state, add it here in the same commit. The contract
 * test fails until you do, which is the point.
 */

/**
 * The four atmospheres — temperature crossed with luminance, each cell filled
 * once. Glass and Candlelight were never in this list.
 *
 * Exported because a tour and its contract test must not keep two hand-written
 * copies of it. That asymmetry is how the rot spread: the tours are not in
 * `npm test`, so when a tour and its test disagree the test wins by default —
 * even when the test is the stale half. One constant, imported by both, has no
 * halves to disagree.
 */
export const ATMOSPHERES = ["light", "dark", "porcelain", "onyx"];
const THEMES = ATMOSPHERES;

/** What each atmosphere is called in prose, and in capture filenames. */
export const ATMOSPHERE_LABELS = Object.freeze({
  light: "paper",
  dark: "ink",
  porcelain: "porcelain",
  onyx: "onyx",
});

/** src/renderer/theme.ts · AppMaterial. One switch over any atmosphere. */
export const MATERIALS = ["solid", "translucent"];

/**
 * What the two retired ids actually named, as (atmosphere, material) pairs.
 * Any surface that used to be toured in Glass and Candlelight is toured here
 * instead, so the coverage moves with the model rather than being dropped.
 */
export const RETIRED_ATMOSPHERE_MATERIALS = Object.freeze([
  Object.freeze({ id: "light", material: "translucent", was: "glass" }),
  Object.freeze({ id: "dark", material: "translucent", was: "dark-glass" }),
]);

/** src/core/annotations/types.ts · CONNECTION_KINDS */
const CONNECTION_KINDS = [
  "link:parallel",
  "link:contrast",
  "link:echo",
  "mirror",
  "series",
  "hinge",
];

/** src/renderer/components/MarkingSurface.tsx · PIGMENTS */
const PIGMENTS = ["yellow", "green", "blue", "pink", "purple"];

/**
 * Every attribute a tour is allowed to gate on, with the complete set of
 * values its emitter can produce. `source` is where to look when this drifts.
 *
 * An attribute absent from this table is ungoverned: `waitForState` will not
 * vet it, and the contract test will not police it. Add attributes here as
 * tours come to depend on them — a gate on an ungoverned attribute is exactly
 * the hazard this module exists to remove.
 */
export const ATTRIBUTE_VOCABULARY = Object.freeze({
  "data-theme": {
    source: "src/renderer/app.tsx · data-theme={theme} · AppTheme in src/renderer/theme.ts",
    values: THEMES,
  },
  "data-theme-id": {
    source: "src/renderer/components/ThemePicker.tsx · THEME_OPTIONS",
    values: THEMES,
  },
  "data-margin-view": {
    source: "src/renderer/components/LivingMargin.tsx · the four panel wrappers",
    values: ["chapter", "reading", "selected", "connection"],
  },
  "data-dock-state": {
    source: "src/renderer/components/MarkingSurface.tsx · const dockState",
    values: ["busy", "session", "feedback", "choices", "selection", "rest"],
  },
  "data-dock-layout": {
    source: "src/renderer/components/MarkingSurface.tsx · const dockLayout",
    values: ["stacked", "shelf"],
  },
  "data-dock-action": {
    source: "src/renderer/components/MarkingSurface.tsx · the failure state's only action",
    values: ["retry"],
  },
  // The Dock's selection state is a bar of commands, not a set of modes. These
  // five ids are what replaced the retired `data-dock-tool` / `data-dock-intent`
  // pair: there is no mode to enter and no intent to declare, only an act to
  // perform on the words already selected. `remove` and `note` share one slot —
  // Remove appears only when there is already a wash under the selection — so a
  // tour must never expect both at once.
  "data-bar-action": {
    source: "src/renderer/components/MarkingSurface.tsx · MarkingBar",
    values: ["highlight", "remove", "note", "connect", "more"],
  },
  "data-more-action": {
    source: "src/renderer/components/MarkingSurface.tsx · MARKING_ACTIONS where home === \"more\"",
    values: ["capture", "study-verse", "keep-comparison", "open-in-tab", "copy-reference", "pericope"],
  },
  "data-action-kind": {
    source: "src/renderer/components/MarkingSurface.tsx · MarkingActionKind",
    values: ["immediate", "deferred", "modal"],
  },
  // The connection draft's own four-state machine, distinct from the Dock's.
  // The relationship chooser and the text field exist only from "two-anchors":
  // asking what the relation IS before a relation exists has no answer.
  "data-connect-state": {
    source: "src/renderer/components/MarkingSurface.tsx · connectDraftState",
    values: ["one-anchor", "two-anchors", "in-flight", "recovery"],
  },
  "data-focus-ring": {
    source: "src/renderer/components/MarkingSurface.tsx · focusRingMode",
    values: ["pointer", "keyboard"],
  },
  "data-marking-surface": {
    source: "src/renderer/components/MarkingSurface.tsx · the palette host and the dock host",
    values: ["palette", "dock"],
  },
  "data-surface-state": {
    source: "src/renderer/components/MarkingSurface.tsx · SurfaceStateId",
    values: [
      "loading", "empty", "failed", "offline", "truncated",
      "in-flight", "conflict", "read-only", "not-installed", "no-results",
    ],
  },
  "data-paint-state": {
    source: "src/renderer/components/ConnectionUnderlay.tsx · the two paintState ternaries",
    values: ["selection", "authoring", "selected", "needs-space"],
  },
  "data-anchor-resolution": {
    source: "src/renderer/components/ConnectionUnderlay.tsx",
    values: ["exact", "passage"],
  },
  "data-selection-capture": {
    source: "src/renderer/components/MarkingSurface.tsx · MarkingSelectionCapture, plus \"none\" when there is no selection",
    values: ["none", "pending", "exact", "refused"],
  },
  "data-instrument": {
    source: "ScripturePage.tsx, ReadingComfort.tsx, ThemePicker.tsx · the header words",
    values: ["translation", "margin", "focus", "comfort", "theme"],
  },
  // The transport reports the element's own state rather than our guess at it.
  // "reaching" is the publisher's server not having answered yet, which is a
  // different fact from paused and has to be able to look different.
  "data-status": {
    source: "src/renderer/components/PodcastPlayer.tsx · PodcastStatus",
    values: ["idle", "reaching", "playing", "paused", "failed"],
  },
  // How a floating surface names itself, so the "is a decision open?" probes in
  // app.tsx and ScripturePage.tsx can ask without a list of class names. The
  // player is deliberately outside the dialog/popover pair those probes read:
  // it is chrome that stays, not a question waiting for an answer.
  "data-floating-layer": {
    source: "app.tsx, MarkingSurface.tsx, PodcastPlayer.tsx, Toast.tsx, VersePeek.tsx",
    values: ["dialog", "peek", "player", "popover", "toast", "toolbar"],
  },
  "data-relationship-kind": {
    source: "src/renderer/utils/relationshipVocabulary.ts · RELATIONSHIPS",
    values: CONNECTION_KINDS,
  },
  "data-pigment": {
    source: "src/renderer/components/MarkingSurface.tsx · PIGMENTS",
    values: PIGMENTS,
  },
  "data-shape": {
    source: "src/renderer/components/CommandPalette.tsx · QueryShape, plus \"resting\" before anything is typed",
    values: ["resting", "reference", "phrase", "question", "name", "text"],
  },
  "data-tool-armed": {
    source: "src/renderer/components/MarkingSurface.tsx · const toolKey",
    // "false" is a real emitted string, not a boolean: `tool?.type ?? "false"`.
    values: [
      "false",
      ...PIGMENTS.map((pigment) => `wash:${pigment}`),
      ...CONNECTION_KINDS.map((kind) => `connect:${kind}`),
    ],
  },
});

/**
 * What is actually inside the Dock, mapped live against a running build.
 *
 * The Dock is one host, one toolbar, and ONE context area whose contents are
 * swapped — `connectNode ?? failureNode ?? barNode ?? resting`, plus the More
 * popover when it is open. It is not a set of panels that can be addressed
 * independently, which is what the retired `[data-dock-context="wash|connect|
 * intent"]` selectors assumed. There is no mode row, no measured thumb, no
 * intent group and no quotation inside the Dock; a tour that looks for any of
 * them is reading a surface that was replaced.
 *
 * Recorded here so the next hand does not have to drive Electron to learn it.
 */
export const DOCK_ANATOMY = Object.freeze({
  host: ".marking-dock-host",
  hostSelector: '[data-marking-surface="dock"]',
  toolbar: ".marking-dock",
  toolbarRole: "toolbar",
  toolbarLabel: "Marking Dock",
  context: ".marking-dock-context",
  /** data-dock-state → the element that must be inside the context area. */
  contents: Object.freeze({
    rest: ".marking-dock-resting",
    selection: ".marking-bar",
    choices: ".marking-more",
    session: ".marking-connect-draft",
    feedback: ".surface-state",
    // "busy" keeps whichever content it entered from and sets aria-busy.
    busy: null,
  }),
  /** Every class the Dock can render. Anything else is a stale selector. */
  classes: Object.freeze([
    "marking-dock-host", "marking-dock", "is-entered", "marking-dock-context",
    "marking-dock-resting", "marking-bar", "marking-bar-swatches",
    "marking-bar-swatch", "marking-bar-action", "marking-choice", "marking-wash",
    "marking-pigment", "marking-more", "marking-more-scope", "marking-more-list",
    "marking-more-row", "marking-more-item", "marking-more-label",
    "marking-more-reason", "marking-session", "marking-connect-draft",
    "marking-connect-progress", "marking-session-kind", "marking-connect-anchors",
    "marking-connect-ref", "marking-session-copy", "marking-connect-kinds",
    "marking-choice-grid", "marking-relationship-grid", "marking-relationship",
    "marking-choice-glyph", "marking-choice-label", "marking-connect-field",
    "marking-session-recovery", "marking-connect-kept-text",
    "marking-connect-actions", "marking-session-action", "surface-state",
    "surface-state-line", "surface-state-thing", "surface-state-reason",
    "surface-state-locality", "surface-state-actions", "sr-only",
  ]),
  /** Forced-colors codes on the pigment swatches, in bar order. */
  forcedCodes: Object.freeze(["Amber", "Sage", "Sky", "Rose", "Violet"]),
});

/**
 * Values the app used to emit and cannot any more, with what replaced them.
 *
 * A gate check alone cannot catch these. Tours drive themes through a list —
 * `const THEMES = [...]` fed into `[data-theme-id="${theme}"]` — so the dead
 * value never appears next to its attribute and the gate parser has nothing to
 * bite on. It is the same rot all the same: the picker has no such option, so
 * the click lands on nothing and the wait that follows it never comes true.
 *
 * These are matched as bare string literals anywhere in a tour, which is blunt
 * but right: there is no legitimate reason for a tour to name one.
 */
export const RETIRED_VOCABULARY = Object.freeze({
  glass: "Never an atmosphere — Paper with the translucent material on. "
    + "Use theme \"light\" plus the material switch.",
  "dark-glass": "Never an atmosphere — Ink with the translucent material on. "
    + "Use theme \"dark\" plus the material switch.",
});

/**
 * Pull every (attribute, value) pair a gate constrains.
 *
 * Covers the two forms the tours actually use:
 *   [data-x="v"]                       — an attribute selector
 *   getAttribute("data-x") === "v"     — a read compared to a literal
 *   dataset.x === "v"                  — the same read, camelCased
 *
 * Values carrying a `${...}` interpolation are skipped: their content is only
 * known at run time, so there is nothing to check statically.
 */
export function extractAttributeGates(expression) {
  const gates = [];
  const add = (attribute, value) => {
    if (value.includes("${") || value.includes("' +") || value.includes('" +')) return;
    gates.push({ attribute, value });
  };
  for (const match of expression.matchAll(/\[(data-[\w-]+)\s*=\s*"([^"]*)"\]/g)) add(match[1], match[2]);
  for (const match of expression.matchAll(/\[(data-[\w-]+)\s*=\s*'([^']*)'\]/g)) add(match[1], match[2]);
  for (const match of expression.matchAll(/getAttribute\(\s*["'](data-[\w-]+)["']\s*\)\s*===\s*["']([^"']*)["']/g)) {
    add(match[1], match[2]);
  }
  for (const match of expression.matchAll(/dataset\.([a-zA-Z][\w]*)\s*===\s*["']([^"']*)["']/g)) {
    const attribute = `data-${match[1].replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
    add(attribute, match[2]);
  }
  return gates;
}

/**
 * The vocabulary check on its own, so both the runtime wait and the contract
 * test apply exactly the same rule. Returns a list of complaints; empty means
 * every governed gate in the expression names a reachable state.
 */
export function findUnreachableGates(expression) {
  const problems = [];
  for (const { attribute, value } of extractAttributeGates(expression)) {
    const governed = ATTRIBUTE_VOCABULARY[attribute];
    if (!governed) continue;
    if (governed.values.includes(value)) continue;
    problems.push(
      `${attribute}="${value}" is not a state this app can emit. `
      + `${attribute} is one of: ${governed.values.join(", ")}. `
      + `Emitted by ${governed.source}.`,
    );
  }
  return problems;
}

/**
 * `waitFor` with the vocabulary checked first.
 *
 * `evaluate` runs an expression in the page and resolves to its value; `sleep`
 * pauses. Both are already present in every tour, so adopting this is a
 * one-line change at the top of a tour's own `waitFor`.
 *
 * A gate naming an unreachable state throws before the first poll, and says
 * which states exist. A gate naming reachable states behaves exactly as
 * before, and its timeout message now distinguishes itself from the other
 * case in as many words.
 */
export async function waitForState(evaluate, sleep, expression, timeout = 8_000) {
  const problems = findUnreachableGates(expression);
  if (problems.length > 0) {
    throw new Error(
      `Refusing to wait for a state the app cannot reach.\n  gate: ${expression}\n  `
      + problems.join("\n  ")
      + "\nThis would have hung until the timeout and then read like a slow app.",
    );
  }
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(expression)) return;
    await sleep(100);
  }
  throw new Error(
    `Timed out after ${timeout}ms waiting for ${expression}\n`
    + "Every governed attribute in this gate names a reachable state, so this is "
    + "a genuine timeout: the app did not get there, rather than could not.",
  );
}
