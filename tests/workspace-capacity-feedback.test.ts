import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  STUDY_WORKSPACE_GROUP_LIMIT,
  STUDY_WORKSPACE_TAB_LIMIT,
  createStudyWorkspace,
  createStudyWorkspaceGroup,
  openPassageWorkspaceTab,
  type PassageViewState,
  type StudyWorkspaceStateV2,
} from "../src/renderer/utils/studyWorkspace.js";

const repoRoot = resolve(import.meta.dirname, "..");
const app = readFileSync(resolve(repoRoot, "src/renderer/app.tsx"), "utf8");
const toast = readFileSync(resolve(repoRoot, "src/renderer/components/Toast.tsx"), "utf8");

const acts19: PassageViewState = {
  book: "ACT",
  chapter: 19,
  packageId: "bsb",
  scrollTop: 0,
  margin: {
    activeTab: "overview",
    scope: null,
    scrollTopByTab: {},
    wordsFollowingReading: true,
  },
};

function section(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `missing ${start}`);
  assert.ok(endIndex > startIndex, `missing ${end} after ${start}`);
  return source.slice(startIndex, endIndex);
}

async function capacityFeedbackModule(): Promise<Record<string, unknown>> {
  const moduleUrl = pathToFileURL(resolve(
    repoRoot,
    "src/renderer/utils/workspaceCapacityFeedback.ts",
  )).href;
  return import(moduleUrl).catch(() => ({}));
}

function fillTabCapacity(): StudyWorkspaceStateV2 {
  let state = createStudyWorkspace(acts19, {
    groupId: "study-1",
    passageTabId: "passage-1",
  });
  for (let index = 1; index < STUDY_WORKSPACE_TAB_LIMIT; index += 1) {
    const result = openPassageWorkspaceTab(state, {
      id: `passage-${index + 1}`,
      sourceTabId: state.activeTabId,
      view: { ...acts19, chapter: index + 19 },
      duplicate: true,
    });
    assert.equal(result.outcome, "opened");
    state = result.state;
  }
  return state;
}

test("capacity feedback uses the shared calm warning toast", async () => {
  const module = await capacityFeedbackModule();
  const notify = module.notifyWorkspaceCapacity;
  assert.equal(typeof notify, "function");
  if (typeof notify !== "function") return;

  const calls: unknown[][] = [];
  const showToast = (...args: unknown[]): void => { calls.push(args); };

  assert.equal(notify("tab-limit", showToast), true);
  assert.equal(notify("group-limit", showToast), true);
  assert.equal(notify("unchanged", showToast), false);
  assert.deepEqual(calls, [
    [
      "You’ve reached the open-tab limit. Close a tab, then try again.",
      undefined,
      undefined,
      { tone: "warning" },
    ],
    [
      "You’ve reached the study-group limit. Close a study, then try again.",
      undefined,
      undefined,
      { tone: "warning" },
    ],
  ]);
});

test("capacity warnings have one live-region owner", () => {
  assert.doesNotMatch(toast, /className=\{`toast-container[^>]{0,200}?aria-live=/s);
  assert.match(toast, /role=\{toast\.tone === "error" \? "alert" : "status"\}/);
  assert.match(toast, /aria-live=\{toast\.tone === "error" \? "assertive" : "polite"\}/);
});

test("capacity rejections emit feedback without replacing workspace state", async () => {
  const module = await capacityFeedbackModule();
  const notify = module.notifyWorkspaceCapacity;
  assert.equal(typeof notify, "function");
  if (typeof notify !== "function") return;
  const messages: string[] = [];
  const showToast = (message: string): void => { messages.push(message); };

  const tabFull = fillTabCapacity();
  const refusedTab = openPassageWorkspaceTab(tabFull, {
    id: "one-too-many",
    sourceTabId: tabFull.activeTabId,
    view: { ...acts19, chapter: 100 },
    duplicate: true,
  });
  assert.equal(refusedTab.outcome, "tab-limit");
  assert.equal(refusedTab.state, tabFull);
  notify(refusedTab.outcome, showToast);

  let groupFull = createStudyWorkspace(acts19, {
    groupId: "study-1",
    passageTabId: "passage-1",
  });
  for (let index = 1; index < STUDY_WORKSPACE_GROUP_LIMIT; index += 1) {
    const result = createStudyWorkspaceGroup(groupFull, {
      id: `study-${index + 1}`,
      passageTabId: `study-${index + 1}-passage`,
      view: acts19,
    });
    assert.equal(result.outcome, "opened");
    groupFull = result.state;
  }
  const refusedGroup = createStudyWorkspaceGroup(groupFull, {
    id: "one-study-too-many",
    passageTabId: "one-study-too-many-passage",
    view: acts19,
  });
  assert.equal(refusedGroup.outcome, "group-limit");
  assert.equal(refusedGroup.state, groupFull);
  notify(refusedGroup.outcome, showToast);

  assert.equal(messages.length, 2);
});

test("every capacity-producing desktop workspace action reports its outcome", () => {
  assert.match(app, /ToastProvider[\s\S]*onShowToastReady=\{registerWorkspaceShowToast\}/);

  for (const [start, end] of [
    ["const openPassageTab", "const duplicateActivePassageTab"],
    ["const duplicateActivePassageTab", "const startStudyFromCurrentCanvas"],
    ["const startStudyFromCurrentCanvas", "const openEntityResearchAt"],
    ["const openEntityResearchAt", "const openEntityResearch ="],
    ["const branchEntityResearch", "const returnEntityOrigin"],
    ["const returnEntityOrigin", "const selectWorkspaceTab"],
    ["const moveWorkspaceTab", "const promoteWorkspaceTabToNewStudy"],
    // A tab founding a study of its own meets the same 16-study cap the study
    // line's + meets, and reports it in the same unit through the same lane.
    ["const promoteWorkspaceTabToNewStudy", "const reopenRecentWorkspaceItem"],
    ["const reopenRecentWorkspaceItem", "const updateEntityResearchTrail"],
  ] as const) {
    assert.match(
      section(app, start, end),
      /notifyWorkspaceCapacity\(/,
      `${start} must report capacity refusal`,
    );
  }

  const ordinaryNavigation = section(app, "const handleNavigateToRef", "const consumeNavigateRef");
  assert.doesNotMatch(ordinaryNavigation, /notifyWorkspaceCapacity|openPassageWorkspaceTab/);
});
