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
