import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
  bootstrapStudyWorkspaceSetting,
  migrateLegacyStudyWorkspace,
  type StudyWorkspaceBootstrapInput,
} from "../src/electron/study-workspace-settings.js";

const root = resolve(import.meta.dirname, "..");
const read = (path: string): string => readFileSync(join(root, path), "utf8");

test("newer workspace versions short-circuit before migration and request no write", () => {
  const raw = {
    version: 3,
    groups: [{ id: "future", payload: { bytePreserved: true } }],
    futureField: "must survive in electron-store",
  };
  const before = JSON.stringify(raw);
  let legacyReads = 0;
  const input = {
    hasStudyWorkspaceKey: true,
    studyWorkspace: raw,
  } as StudyWorkspaceBootstrapInput;
  for (const key of ["researchWorkspace", "researchSession", "lastRead", "keptContext"] as const) {
    Object.defineProperty(input, key, {
      enumerable: true,
      get() {
        legacyReads += 1;
        return null;
      },
    });
  }

  assert.deepEqual(bootstrapStudyWorkspaceSetting(input), {
    studyWorkspace: null,
    studyWorkspaceRefusal: "newer-version",
    write: null,
  });
  assert.equal(legacyReads, 0);
  assert.equal(JSON.stringify(raw), before);
});

test("valid V2 is authoritative while a missing or invalid key migrates and clears legacy inputs", () => {
  const current = migrateLegacyStudyWorkspace({
    researchWorkspace: null,
    researchSession: null,
    lastRead: { book: "JHN", chapter: 3, packageId: "nrsv" },
    keptContext: null,
  });
  assert.equal(current.status, "migrated");
  assert.ok(current.value);
  const legacy = {
    researchWorkspace: null,
    researchSession: {
      origin: { book: "ACT", chapter: 19, packageId: "bsb" },
      trail: [{ id: "person:paul", displayName: "Paul", kind: "person" }],
    },
    lastRead: { book: "ACT", chapter: 19, packageId: "bsb" },
    keptContext: { book: "GEN", chapter: 1, verse: 1 },
  };
  const authoritative = bootstrapStudyWorkspaceSetting({
    hasStudyWorkspaceKey: true,
    studyWorkspace: current.value,
    ...legacy,
  });
  assert.deepEqual(authoritative.studyWorkspace, current.value);
  assert.deepEqual(authoritative.write, {
    studyWorkspace: current.value,
    researchWorkspace: null,
    researchSession: null,
    keptContext: null,
  });

  const migrated = bootstrapStudyWorkspaceSetting({
    hasStudyWorkspaceKey: false,
    studyWorkspace: undefined,
    ...legacy,
  });
  assert.equal(migrated.studyWorkspace?.tabsById["legacy-research-session"]?.kind, "entity");
  assert.deepEqual(migrated.write, {
    studyWorkspace: migrated.studyWorkspace,
    researchWorkspace: null,
    researchSession: null,
    keptContext: null,
  });

  const retainedNull = bootstrapStudyWorkspaceSetting({
    hasStudyWorkspaceKey: true,
    studyWorkspace: null,
    ...legacy,
  });
  assert.equal(retainedNull.studyWorkspace, null);
  assert.equal(retainedNull.write?.studyWorkspace, null);
});

test("App establishes V2 authority only after refusal and projects it into transitional rendering", () => {
  const app = read("src/renderer/app.tsx");
  const api = read("src/renderer/api.ts");
  const hydration = app.slice(
    app.indexOf("safeCall(() => window.api.settings.get())"),
    app.indexOf("// Persist sidebarCollapsed"),
  );
  const refusal = hydration.indexOf('res.value.studyWorkspaceRefusal === "newer-version"');
  assert.ok(refusal >= 0);
  assert.ok(refusal < hydration.indexOf("settingsLoaded.current = true"));
  assert.ok(refusal < hydration.indexOf("setStudyWorkspace"));
  assert.ok(refusal < hydration.indexOf("createWorkspacePersistenceController"));
  assert.equal(app.indexOf("useState<ResearchWorkspaceState>"), -1);
  assert.equal(app.indexOf("setResearchWorkspace"), -1);
  assert.doesNotMatch(app, /createResearchWorkspaceState/);
  assert.match(app, /projectStudyWorkspaceCompatibility\(studyWorkspace\)/);
  assert.match(app, /workspacePersistenceRef\.current\.persistStructure/);
  assert.match(hydration, /const persisted = await window\.api\.settings\.set\(\{ studyWorkspace: workspace \}\)/);
  assert.match(hydration, /if \(persisted\.studyWorkspaceRefusal\) throw new Error/);
  assert.match(
    hydration,
    /if \(!isStudyWorkspaceSnapshotAcknowledged\(workspace, persisted\.studyWorkspace\)\) throw new Error/,
  );
  assert.doesNotMatch(hydration, /persisted\.studyWorkspace\?\.version !== 2/);
  assert.match(hydration, /setStudyWorkspaceRefusal\("newer-version"\)/);
  assert.match(hydration, /studyWorkspaceRefusalRef\.current = "newer-version"/);
  assert.match(app, /role="alert"[\s\S]{0,500}?newer version of Pericope/);
  assert.match(app, /if \(studyWorkspaceRefusal === "newer-version"\)/);
  assert.match(api, /studyWorkspace\?: StudyWorkspaceStateV2 \| null/);
  assert.match(api, /studyWorkspaceRefusal\?: "newer-version"/);
  assert.doesNotMatch(api, /\bresearchSession\?:/);
  assert.doesNotMatch(api, /\bresearchWorkspace\?:/);
  assert.doesNotMatch(api, /\bkeptContext\?:/);
  assert.doesNotMatch(
    app,
    /settings\.set\(\{\s*(?:researchWorkspace|researchSession|keptContext)\b/,
  );
  assert.doesNotMatch(app, /res\.value\.(?:researchWorkspace|researchSession|keptContext)/);
});

test("window close distinguishes refusal from bootstrap and flushes normal workspace", () => {
  const app = read("src/renderer/app.tsx");
  const closeHandler = app.slice(
    app.indexOf("window.api.appWindow.onCloseRequested"),
    app.indexOf("const handleCreateNoteFromPassage"),
  );
  const authoredExit = closeHandler.indexOf('await controller.requestExit("window-close")');
  const decision = closeHandler.indexOf("decideStudyWorkspaceClose(");
  const refusalApprove = closeHandler.indexOf('workspaceClose.kind === "approve"');
  const unresolvedVeto = closeHandler.indexOf('workspaceClose.kind === "veto"');
  const flush = closeHandler.indexOf("await persistence.flush(workspaceClose.workspace)");
  const approve = closeHandler.indexOf("window.api.appWindow.resolveCloseRequest(true)", flush);
  assert.ok(authoredExit >= 0);
  assert.ok(decision > authoredExit);
  assert.ok(refusalApprove > decision);
  assert.ok(unresolvedVeto > refusalApprove);
  assert.ok(flush > unresolvedVeto);
  assert.ok(flush > authoredExit);
  assert.ok(approve > flush);
  assert.match(closeHandler, /workspaceClose\.kind === "approve"[\s\S]{0,120}?resolveCloseRequest\(true\);[\s\S]{0,80}?return;/);
  assert.match(closeHandler, /workspaceClose\.kind === "veto"[\s\S]{0,120}?resolveCloseRequest\(false\);[\s\S]{0,80}?return;/);
  assert.match(closeHandler, /if \(!proceed\) \{[\s\S]{0,120}?resolveCloseRequest\(false\);[\s\S]{0,80}?return;/);
  assert.match(closeHandler, /if \(!flushed\) \{[\s\S]{0,120}?resolveCloseRequest\(false\);[\s\S]{0,80}?return;/);
  assert.match(closeHandler, /catch \{[\s\S]{0,120}?resolveCloseRequest\(false\)/);
});

test("Electron settles V2 once, preserves V3, and merges workspace patches by key presence", () => {
  const main = read("src/electron/main.ts");
  assert.match(main, /bootstrapStudyWorkspaceSetting/);
  assert.match(main, /mergeRawStudyWorkspaceSetting/);
  const getHandler = main.slice(
    main.indexOf("const readSettings = () =>"),
    main.indexOf('ipcMain.handle("settings:set"'),
  );
  assert.match(getHandler, /hasStudyWorkspaceKey:/);
  assert.match(getHandler, /if \(workspaceBootstrap\.write\) store\.set\(\{ \.\.\.current, \.\.\.workspaceBootstrap\.write \}\)/);
  assert.match(getHandler, /studyWorkspace: workspaceBootstrap\.studyWorkspace/);
  assert.match(getHandler, /\.\.\.\(workspaceBootstrap\.studyWorkspaceRefusal/);
  const setHandler = main.slice(
    main.indexOf('ipcMain.handle("settings:set"'),
    main.indexOf('ipcMain.handle("dialog-open-directory"'),
  );
  assert.match(setHandler, /hasStudyWorkspace/);
  assert.match(setHandler, /hasCurrentStudyWorkspace/);
  assert.match(setHandler, /const sanitizedPartial = \{ \.\.\.partial \};[\s\S]{0,100}?delete sanitizedPartial\.studyWorkspace/);
  assert.match(setHandler, /\.\.\.sanitizedPartial/);
  assert.match(setHandler, /const mergedStudyWorkspace = mergeRawStudyWorkspaceSetting\(/);
  assert.match(setHandler, /\.\.\.\(hasStudyWorkspace \|\| hasCurrentStudyWorkspace/);
  assert.match(setHandler, /studyWorkspace: mergedStudyWorkspace/);
  assert.doesNotMatch(setHandler, /studyWorkspace:\s*normalizeStudyWorkspace/);
  assert.doesNotMatch(setHandler, /^\s*studyWorkspace:\s*undefined/m);
});
