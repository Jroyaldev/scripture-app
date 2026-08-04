import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  workspaceDecisionPresentation,
  type WorkspaceDecisionPresentation,
} from "../src/renderer/components/WorkspaceDecisionDialog.js";
import type { WorkspaceConfirmation } from "../src/renderer/utils/studyWorkspace.js";

function presentation(confirmation: WorkspaceConfirmation): WorkspaceDecisionPresentation {
  return workspaceDecisionPresentation(confirmation);
}

test("dependent research close names both safe outcomes", () => {
  const result = presentation({
    kind: "passage-dependencies",
    tabId: "romans",
    dependentEntityIds: ["paul", "rome"],
    entityNonces: [{ tabId: "paul", nonce: 1 }, { tabId: "rome", nonce: 2 }],
    sourceGroupId: "sermon",
    sourceTabIds: ["romans", "paul", "rome"],
  });

  assert.equal(result.title, "Close this passage?");
  assert.match(result.description, /2 research tabs/);
  assert.deepEqual(result.actions.map((action) => action.decision), [
    "keep-research",
    "close-passage-and-research",
  ]);
  assert.equal(result.actions[1]?.tone, "danger");
});

test("study close and every move confirmation expose truthful explicit choices", () => {
  const cases: Array<{
    confirmation: WorkspaceConfirmation;
    decisions: string[];
  }> = [
    {
      confirmation: {
        kind: "sole-group-passage",
        groupId: "study",
        tabId: "home",
        tabIds: ["home", "paul"],
        entityNonces: [{ tabId: "paul", nonce: 1 }],
      },
      decisions: ["close-study"],
    },
    {
      confirmation: {
        kind: "close-study",
        groupId: "study",
        tabIds: ["home", "paul"],
        entityNonces: [{ tabId: "paul", nonce: 1 }],
      },
      decisions: ["close-study"],
    },
    {
      confirmation: {
        kind: "move-branch",
        tabId: "romans",
        dependentEntityIds: ["paul"],
        entityNonces: [{ tabId: "paul", nonce: 1 }],
        sourceGroupId: "study-a",
        sourceTabIds: ["acts", "romans", "paul"],
        targetGroupId: "study-b",
      },
      decisions: ["move-branch"],
    },
    {
      confirmation: {
        kind: "move-entity-context",
        tabId: "paul",
        sourceGroupId: "study-a",
        nonce: 1,
        targetGroupId: "study-b",
      },
      decisions: ["copy-origin-passage"],
    },
    {
      confirmation: {
        kind: "move-home-passage",
        tabId: "acts",
        groupId: "study-a",
        sourceTabIds: ["acts", "paul"],
        entityNonces: [{ tabId: "paul", nonce: 1 }],
        targetGroupId: "study-b",
      },
      decisions: ["duplicate-home", "move-study"],
    },
  ];

  for (const { confirmation, decisions } of cases) {
    const result = presentation(confirmation);
    assert.ok(result.title.length > 0);
    assert.ok(result.description.length > 0);
    assert.deepEqual(result.actions.map((action) => action.decision), decisions);
  }
});

test("every decision dialog leaves Cancel to the common dialog footer", () => {
  const result = presentation({
    kind: "close-study",
    groupId: "study",
    tabIds: ["home", "paul"],
    entityNonces: [{ tabId: "paul", nonce: 1 }],
  });

  assert.equal(result.actions.some((action) => action.decision === "cancel"), false);
});

test("the question is asked in the top layer, where a click can reach it", () => {
  /* `.app-shell` carries `isolation: isolate`, which opens a stacking context —
     so every z-index inside it, including this dialog's 1360, is scoped to that
     context, and the shell itself sits in the root context at `z-index: auto`.
     Popovers portal to the body and lay a hit shield at 900. Nine hundred beats
     zero, so while ANY popover was open this dialog painted underneath its
     scrim: the question was visible, dimmed and unclickable, and the reader had
     to dismiss the menu by clicking outside it before they could answer the
     question that menu had just asked them.

     Reported from All Tabs — drop a study's only tab into another study and the
     move confirmation is unreachable — but it was never about All Tabs. Any
     decision raised while any popover stood was behind it, from the strip's
     context menu as much as from the overview.

     So the dialog portals to the body, beside the scrims it must outrank, where
     its z-index means what it says. The material classes travel with it because
     design tokens are declared on the shell and a portalled node leaves that
     subtree behind — the same reason Popover and Tooltip copy them. */
  const source = readFileSync(
    resolve(import.meta.dirname, "../src/renderer/components/WorkspaceDecisionDialog.tsx"),
    "utf8",
  );
  assert.match(source, /import \{ createPortal \} from "react-dom";/);
  assert.match(source, /return createPortal\(/);
  assert.match(source, /\s+document\.body,\s*\);/);
  assert.match(source, /className=\{`workspace-decision-root \$\{materialClasses\}`\}/);
  assert.match(
    source,
    /\[\.\.\.shell\.classList\]\.filter\(\(name\) => name === "dark" \|\| name\.startsWith\("theme-"\)\)/,
  );
});

test("every dialog describes the buttons it actually offers, and offers no word twice", () => {
  /* AUDIT · 2026-08-03. Three things were wrong in the same family, and all
     three were about a reader trying to tell two answers apart. */

  /* ONE · The home-passage dialog described one option twice. "Keep this study
     intact, or leave a copy of its home passage here and move only this passage
     branch" reads as two choices and is one — both halves are `duplicate-home`
     — so the button that takes a study out of existence as a study was never
     described at all. Each clause maps to a button now, in the order they
     stand. */
  const home = presentation({
    kind: "move-home-passage",
    tabId: "home", groupId: "g1", sourceTabIds: ["home"], entityNonces: [], targetGroupId: "g2",
  });
  assert.deepEqual(home.actions.map((action) => action.decision), ["duplicate-home", "move-study"]);
  assert.match(home.description, /Leave a copy behind and only this branch moves/);
  assert.match(home.description, /the whole study moves with it/);
  assert.doesNotMatch(home.description, /Keep this study intact/);

  /* TWO · The two ways to close a study made different promises. The one raised
     by closing a passage — the more alarming of the pair, since you asked about
     a tab and are being told a study will go — was the one that withheld the
     reassurance. They end the same way and recover the same way. */
  const sole = presentation({
    kind: "sole-group-passage", groupId: "g1", tabId: "a", tabIds: ["a"], entityNonces: [],
  });
  const study = presentation({ kind: "close-study", groupId: "g1", tabIds: ["a", "b"], entityNonces: [] });
  for (const closing of [sole, study]) {
    assert.match(closing.description, /Recently closed/);
    assert.match(closing.description, /reopened/);
  }

  /* THREE · Every tone a dialog can ask for must be a tone the sheet draws.
     `is-secondary` and `is-cancel` were both class names with no rule behind
     them, so the second real choice in the home-passage dialog rendered exactly
     like Cancel: one emphasised button and two identical scraps of text, the
     quieter of which moved an entire study. */
  const styles = readFileSync(
    resolve(import.meta.dirname, "../src/renderer/styles.css"),
    "utf8",
  );
  for (const tone of ["primary", "secondary", "danger"]) {
    assert.match(
      styles,
      new RegExp(`\\.workspace-decision-action\\.is-${tone}`),
      `a dialog can ask for the ${tone} tone, so the sheet has to draw it`,
    );
  }
});
