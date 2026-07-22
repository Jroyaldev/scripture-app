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
  assert.ok(current);
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
    studyWorkspace: current,
    ...legacy,
  });
  assert.deepEqual(authoritative.studyWorkspace, current);
  assert.deepEqual(authoritative.write, {
    studyWorkspace: current,
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

test("App refuses a newer workspace before hydration and leaves every workspace write gate closed", () => {
  const app = read("src/renderer/app.tsx");
  const api = read("src/renderer/api.ts");
  const hydration = app.slice(
    app.indexOf("safeCall(() => window.api.settings.get())"),
    app.indexOf("// Persist sidebarCollapsed"),
  );
  const refusal = hydration.indexOf('res.value.studyWorkspaceRefusal === "newer-version"');
  assert.ok(refusal >= 0);
  assert.ok(refusal < hydration.indexOf("settingsLoaded.current = true"));
  assert.equal(hydration.indexOf("setResearchWorkspace"), -1);
  assert.match(hydration, /setStudyWorkspaceRefusal\("newer-version"\)/);
  assert.match(app, /role="alert"[\s\S]{0,500}?newer version of Pericope/);
  assert.match(app, /if \(studyWorkspaceRefusal === "newer-version"\)/);
  assert.match(api, /studyWorkspace\?: StudyWorkspaceStateV2 \| null/);
  assert.match(api, /studyWorkspaceRefusal\?: "newer-version"/);
  assert.doesNotMatch(
    app,
    /settings\.set\(\{\s*(?:studyWorkspace|researchWorkspace|researchSession|keptContext)\b/,
  );
  assert.doesNotMatch(app, /res\.value\.(?:researchWorkspace|researchSession|keptContext)/);
});

test("Electron settles V2 once, preserves V3, and merges workspace patches by key presence", () => {
  const main = read("src/electron/main.ts");
  assert.match(main, /bootstrapStudyWorkspaceSetting/);
  assert.match(main, /mergeStudyWorkspaceSetting/);
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
  assert.match(setHandler, /studyWorkspace: mergeStudyWorkspaceSetting\(/);
  assert.doesNotMatch(setHandler, /studyWorkspace:\s*normalizeStudyWorkspace/);
});
