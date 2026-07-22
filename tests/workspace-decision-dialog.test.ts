import assert from "node:assert/strict";
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
