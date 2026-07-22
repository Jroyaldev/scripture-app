import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import * as versePeekModule from "../src/renderer/components/VersePeek.js";

const peek = readFileSync(
  resolve(import.meta.dirname, "../src/renderer/components/VersePeek.tsx"),
  "utf8",
);
const page = readFileSync(
  resolve(import.meta.dirname, "../src/renderer/components/ScripturePage.tsx"),
  "utf8",
);
const app = readFileSync(resolve(import.meta.dirname, "../src/renderer/app.tsx"), "utf8");

test("VersePeek presents Keep and Open as independent keyboard actions", () => {
  assert.match(peek, /const hasActions = Boolean\(onKeepReference \|\| onOpenPassageTab\)/);
  assert.match(peek, /role=\{hasActions \? "dialog" : "tooltip"\}/);
  assert.match(peek, /panel\.querySelector<HTMLElement>\("\.verse-peek-keep, \.verse-peek-open"\)/);
  assert.match(peek, /className="verse-peek-keep"[\s\S]{0,260}>\s*Keep in Study\s*</);
  const openAction = peek.slice(
    peek.indexOf('className="verse-peek-open"'),
    peek.indexOf("</button>", peek.indexOf('className="verse-peek-open"')),
  );
  assert.match(openAction, />\s*\{openingPassage \? "Opening…" : "Open passage tab"\}\s*$/);
});

test("VersePeek closes only after an accepted passage-tab open", () => {
  const actionStart = peek.indexOf('className="verse-peek-open"');
  const action = peek.slice(actionStart, actionStart + 700);
  assert.ok(actionStart >= 0);
  assert.match(action, /setOpeningPassage\(true\)/);
  assert.match(action, /if \(await onOpenPassageTab\(peek\.target, \{ focusDestination \}\)\) onClose\(\)/);
  assert.match(action, /finally \{\s*setOpeningPassage\(false\)/);
  assert.match(action, /disabled=\{openingPassage\}/);
});

test("VersePeek advertises a dialog whenever either durable action exists", () => {
  assert.match(peek, /"aria-haspopup": hasActions \? "dialog" : undefined/);
  assert.match(peek, /"aria-expanded": hasActions/);
  assert.match(peek, /onOpenPassageTab=\{onOpenPassageTab\}/);
});

test("keyboard Peek open hands focus to the committed passage without changing pointer flow", () => {
  const shouldFocus = (versePeekModule as Record<string, unknown>).versePeekShouldFocusDestination;
  assert.equal(typeof shouldFocus, "function");
  if (typeof shouldFocus !== "function") return;
  assert.equal(shouldFocus(0), true);
  assert.equal(shouldFocus(1), false);

  const actionStart = peek.indexOf('className="verse-peek-open"');
  const action = peek.slice(actionStart, actionStart + 900);
  assert.match(action, /onClick=\{\(event\) =>/);
  assert.match(action, /const focusDestination = versePeekShouldFocusDestination\(event\.detail\)/);
  assert.match(action, /onOpenPassageTab\(peek\.target, \{ focusDestination \}\)/);

  assert.match(page, /openPassageTab\(reference, "verse-peek", options\)/);
  const openPassageStart = app.indexOf("const openPassageTab = useCallback");
  const openPassageEnd = app.indexOf("const duplicateActivePassageTab", openPassageStart);
  const openPassage = app.slice(openPassageStart, openPassageEnd);
  assert.match(openPassage, /options\?\.source === undefined \|\| options\?\.focusDestination/);
  assert.match(openPassage, /focusWorkspaceTabAfterCommit\(openedTabId\)/);
});
