import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
  appendEntityResearchTrail as appendMarginTrail,
  marginScrollRestoreKey,
  resolveMarginScrollRestoration,
  truncateEntityResearchTrail as truncateMarginTrail,
} from "../src/renderer/components/LivingMargin.js";
import {
  appendEntityResearchTrail,
  truncateEntityResearchTrail,
} from "../src/renderer/utils/studyWorkspace.js";

const root = resolve(import.meta.dirname, "..");
const marginSource = readFileSync(
  join(root, "src", "renderer", "components", "LivingMargin.tsx"),
  "utf8",
);
const scripturePageSource = readFileSync(
  join(root, "src", "renderer", "components", "ScripturePage.tsx"),
  "utf8",
);
const appSource = readFileSync(
  join(root, "src", "renderer", "app.tsx"),
  "utf8",
);

test("margin restore identity ignores ambient verse drift but distinguishes real subjects", () => {
  const base = {
    ownerTabId: "passage-a",
    sessionRestoreNonce: 4,
    workspace: "study" as const,
    activeTab: "connections" as const,
    book: "ACT",
    chapter: 19,
  };
  const followingAtTwo = marginScrollRestoreKey({
    ...base,
    scope: { kind: "following", verse: 2 },
  });
  const followingAtSix = marginScrollRestoreKey({
    ...base,
    scope: { kind: "following", verse: 6 },
  });
  assert.equal(followingAtTwo, followingAtSix);
  assert.notEqual(
    followingAtTwo,
    marginScrollRestoreKey({ ...base, scope: { kind: "chapter" } }),
  );
  assert.notEqual(
    marginScrollRestoreKey({ ...base, scope: { kind: "selection", start: 2, end: 2 } }),
    marginScrollRestoreKey({ ...base, scope: { kind: "selection", start: 3, end: 4 } }),
  );
  assert.notEqual(
    marginScrollRestoreKey({ ...base, scope: { kind: "kept", verse: 2 } }),
    marginScrollRestoreKey({ ...base, scope: { kind: "kept", verse: 6 } }),
  );
  assert.notEqual(
    followingAtTwo,
    marginScrollRestoreKey({ ...base, ownerTabId: "passage-b", scope: { kind: "following", verse: 2 } }),
  );
});

test("controlled snapshots win on restore while same-session subject changes reset", () => {
  const following = {
    ownerTabId: "passage-a",
    sessionRestoreNonce: 4,
    workspace: "study" as const,
    activeTab: "connections" as const,
    book: "ACT",
    chapter: 19,
    scope: { kind: "following" as const, verse: 2 },
  };
  assert.deepEqual(resolveMarginScrollRestoration(null, following, 84), {
    top: 84,
    publish: false,
  });
  assert.deepEqual(resolveMarginScrollRestoration(following, {
    ...following,
    sessionRestoreNonce: 5,
    book: "JHN",
    chapter: 3,
  }, 117), {
    top: 117,
    publish: false,
  });
  assert.deepEqual(resolveMarginScrollRestoration(following, {
    ...following,
    activeTab: "notes",
  }, 46), {
    top: 46,
    publish: false,
  });
  assert.deepEqual(resolveMarginScrollRestoration(following, {
    ...following,
    scope: { kind: "selection", start: 2, end: 3 },
  }, 84), {
    top: 0,
    publish: true,
  });
  assert.equal(resolveMarginScrollRestoration(following, {
    ...following,
    scope: { kind: "following", verse: 12 },
  }, 84), null);
});

test("connection inspector scroll is transient and restores the underlying lens", () => {
  const lens = {
    ownerTabId: "passage-a",
    sessionRestoreNonce: 4,
    workspace: "study" as const,
    activeTab: "connections" as const,
    book: "ACT",
    chapter: 19,
    scope: { kind: "following" as const, verse: 2 },
  };
  const inspector = {
    ...lens,
    scope: { kind: "connection" as const, connectionId: "connection-a" },
  };

  assert.deepEqual(resolveMarginScrollRestoration(lens, inspector, 84), {
    top: 0,
    publish: false,
  });
  assert.deepEqual(resolveMarginScrollRestoration(inspector, lens, 84), {
    top: 84,
    publish: false,
  });
});

test("margin scroll stays native while persistence is delayed, flushed, and owner-tagged", () => {
  assert.match(marginSource, /const MARGIN_SCROLL_PUBLISH_DELAY_MS = 220/);
  assert.match(marginSource, /pendingScrollPublicationRef/);
  assert.match(marginSource, /window\.setTimeout\([\s\S]{0,220}MARGIN_SCROLL_PUBLISH_DELAY_MS/);
  assert.match(marginSource, /sample\.context\.ownerTabId !== current\.ownerTabId/);
  assert.match(marginSource, /onScroll=\{scheduleWorkspaceScrollPublication\}/);
  assert.match(marginSource, /flushWorkspaceScrollPublication\(true\);[\s\S]{0,100}setActiveTab\(tab\)/);
  assert.match(marginSource, /onPointerLeave=\{handleMarginPointerLeave\}/);
  assert.match(marginSource, /onBlur=\{handleMarginBlur\}/);
  assert.match(marginSource, /window\.addEventListener\("blur", flushOnWindowBlur\)/);
  assert.match(
    marginSource,
    /export interface LivingMarginScrollController \{[\s\S]{0,120}ownerTabId: string;[\s\S]{0,120}flushPendingScroll\(\): void;/,
  );
  assert.match(
    marginSource,
    /onScrollControllerChange\?\.\(sessionOwnerTabId, scrollController\)[\s\S]{0,180}onScrollControllerChange\?\.\(sessionOwnerTabId, null\)/,
  );
  const unmountCleanup = marginSource.slice(
    marginSource.indexOf("useEffect(() => () => {", marginSource.indexOf("pendingScrollPublicationRef")),
    marginSource.indexOf("useEffect(() => {", marginSource.indexOf("useEffect(() => () => {", marginSource.indexOf("pendingScrollPublicationRef")) + 1),
  );
  assert.match(unmountCleanup, /flushWorkspaceScrollPublicationRef\.current\(\)/);
  assert.ok(
    unmountCleanup.indexOf("flushWorkspaceScrollPublicationRef.current()")
      < unmountCleanup.indexOf("pendingScrollPublicationRef.current = null"),
    "unmount must publish the pending owner-tagged sample before clearing it",
  );
  assert.doesNotMatch(
    marginSource,
    /\}, \[activeTab, activeWorkspace, controlledScrollTop, sessionOwnerTabId\]\);/,
  );
});

test("Research heading focus requires one explicit owner-scoped content request", () => {
  assert.match(appSource, /type EntityResearchFocusRequest = \{\s*ownerTabId: string;\s*requestId: number;\s*\}/);
  const tabSelectionStart = appSource.indexOf("const selectWorkspaceTab");
  const tabSelectionEnd = appSource.indexOf("const closeResearchTab", tabSelectionStart);
  const tabSelection = appSource.slice(tabSelectionStart, tabSelectionEnd);
  assert.ok(
    tabSelection.indexOf("setEntityResearchFocusRequest(null);")
      < tabSelection.indexOf('runWorkspaceTransition("tab-change"'),
    "workspace-tab activation must retire any pending content-originated focus request",
  );
  assert.match(appSource, /setEntityResearchFocusRequest\(\{\s*ownerTabId: openedOwnerTabId,\s*requestId:/,
    "an explicit content open must issue a request for the entity tab it actually activated");
  assert.match(scripturePageSource, /entityResearchFocusRequest=\{entityResearchFocusRequest\}/);
  assert.match(marginSource, /if \(entityResearchFocusRequest == null\) return;/);
  assert.match(marginSource, /onEntityResearchFocusRequestHandled\?\.\(sessionOwnerTabId, entityResearchFocusRequest\)/);

  const focusEffectStart = marginSource.indexOf("if (entityResearchFocusRequest == null) return;");
  const focusEffectEnd = marginSource.indexOf("  useEffect(() => {", focusEffectStart + 1);
  const focusEffect = marginSource.slice(focusEffectStart, focusEffectEnd);
  assert.match(focusEffect, /entityResearch\?\.entity\.id !== entityIntent\.id/);
  assert.match(focusEffect, /researchTitleRef\.current\?\.focus\(\{ preventScroll: true \}\)/);

  const fetchEffectStart = marginSource.indexOf("window.api.language.getEntityResearch(entityIntent.id)");
  const fetchEffectEnd = marginSource.indexOf("  const openRelatedEntity", fetchEffectStart);
  assert.doesNotMatch(
    marginSource.slice(fetchEffectStart, fetchEffectEnd),
    /researchTitleRef\.current\?\.focus/,
    "async data completion alone must remain focus-neutral",
  );
});

test("Words stays controlled and resumes against the live followed verse", () => {
  const wordsSource = readFileSync(
    join(root, "src", "renderer", "components", "LanguageWordsSection.tsx"),
    "utf8",
  );
  assert.match(wordsSource, /wordsFollowingReading\s*\?\s*followedVerse/);
  assert.match(wordsSource, /followedVerseRef\.current/);
  assert.match(wordsSource, /wordsVerse: followedVerseRef\.current,[\s\S]{0,80}wordsFollowingReading: true/);
  assert.match(wordsSource, /requestContextKey !== ownerContextKeyRef\.current/);
  assert.doesNotMatch(wordsSource, /setEngagedVerse/);
});

test("Living Margin re-exports the canonical entity trail operations", () => {
  assert.equal(appendMarginTrail, appendEntityResearchTrail);
  assert.equal(truncateMarginTrail, truncateEntityResearchTrail);
});
