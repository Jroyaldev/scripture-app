import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");

// Regression test for a real, reproduced bug: clicking the sidebar collapse
// button (or toggling margin/theme/marking surface) immediately applied the new state, but
// within ~100ms-2000ms it silently reverted with no further user
// interaction. Root cause: the mount-time settings-load effect resolves
// window.api.settings.get() asynchronously (an IPC round trip) and, when it
// finally resolves, unconditionally called setSidebarCollapsed /
// setMarginVisible / setTheme / setMarkingSurface with the *persisted* value — clobbering any
// change the user made via the UI while that promise was still in flight.
// The settingsLoaded ref was set to true only *inside* that same callback,
// so it could never protect against the callback's own stale writes.
//
// The fix tracks per-setting "dirty" flags (userDirtySettings), set
// synchronously inside each toggle handler at click time, and the
// settings-load effect skips applying the persisted value for any setting
// the user has already touched.

test("App's settings-load effect does not clobber a setting the user already toggled", () => {
  const source = readFileSync(join(repoRoot, "src", "renderer", "app.tsx"), "utf-8");

  // A dirty-tracking ref must exist and cover every independently editable
  // setting loaded by this mount-time request.
  const dirtyRefDecl = source.indexOf("userDirtySettings");
  assert.notEqual(dirtyRefDecl, -1, "expected a userDirtySettings ref to exist");
  assert.match(
    source,
    /userDirtySettings\s*=\s*useRef\(\{\s*sidebarCollapsed:\s*false,\s*marginVisible:\s*false,\s*theme:\s*false,\s*markingSurface:\s*false\s*\}\)/,
  );

  // The settings-load effect (mount effect calling settings.get()) must gate
  // each setState call on the corresponding dirty flag being false.
  const loadEffectStart = source.indexOf("safeCall(() => window.api.settings.get())");
  assert.notEqual(loadEffectStart, -1, "expected the settings.get() load effect");

  const loadEffectEnd = source.indexOf("}, []);", loadEffectStart);
  assert.notEqual(loadEffectEnd, -1);
  const loadEffectBody = source.slice(loadEffectStart, loadEffectEnd);

  for (const key of ["sidebarCollapsed", "marginVisible", "theme", "markingSurface"] as const) {
    const guardIdx = loadEffectBody.indexOf(`if (!userDirtySettings.current.${key})`);
    assert.ok(guardIdx !== -1, `expected a userDirtySettings guard for ${key} in the load effect`);

    const setterName = `set${key[0]!.toUpperCase()}${key.slice(1)}`;
    const setterCall = key === "markingSurface"
      ? `${setterName}(res.value.${key} ?? "palette")`
      : `${setterName}(res.value.${key})`;
    const setterIdx = loadEffectBody.indexOf(setterCall, guardIdx);
    assert.ok(
      setterIdx !== -1 && setterIdx > guardIdx,
      `expected ${setterCall} to be guarded by the dirty check`,
    );
  }

  // Each toggle handler must mark its setting dirty synchronously (before
  // calling the corresponding setState), not inside any async callback —
  // this is what closes the race window.
  const toggleHandlers: Array<{
    name: string;
    key: "sidebarCollapsed" | "marginVisible" | "theme" | "markingSurface";
    updater: RegExp;
  }> = [
    { name: "toggleSidebarCollapsed", key: "sidebarCollapsed", updater: /set[A-Za-z]+\(\(prev\)/ },
    { name: "toggleMargin", key: "marginVisible", updater: /set[A-Za-z]+\(\(prev\)/ },
    { name: "toggleTheme", key: "theme", updater: /setTheme\(\(\)\s*=>\s*nextTheme\)/ },
    { name: "changeMarkingSurface", key: "markingSurface", updater: /setMarkingSurface\(nextSurface\)/ },
  ];

  for (const { name, key, updater } of toggleHandlers) {
    const handlerStart = source.indexOf(`const ${name} = (`);
    assert.ok(handlerStart !== -1, `expected handler ${name} to exist`);
    const handlerEnd = source.indexOf("};", handlerStart);
    const handlerBody = source.slice(handlerStart, handlerEnd);

    const dirtyAssignIdx = handlerBody.indexOf(`userDirtySettings.current.${key} = true`);
    assert.ok(dirtyAssignIdx !== -1, `expected ${name} to synchronously set userDirtySettings.current.${key} = true`);

    const setStateIdx = handlerBody.search(updater);
    assert.ok(
      setStateIdx !== -1 && dirtyAssignIdx < setStateIdx,
      `expected ${name} to mark the setting dirty before calling its setState updater`,
    );
  }

  // settingsLoaded must still gate the persist-on-change effects (this
  // invariant — don't write back defaults before real settings arrive —
  // must be preserved by the fix).
  const persistGuards = source.match(/if \(!settingsLoaded\.current\) return;/g) ?? [];
  // sidebarCollapsed, marginVisible, theme, markingSurface, reading preferences,
  // the bounded research session, and the single kept comparison subject.
  assert.equal(persistGuards.length, 7, "expected all persist effects to still guard on settingsLoaded");
  assert.match(source, /const \[settingsReady, setSettingsReady\] = useState\(false\)/);
  assert.match(source, /settingsLoaded\.current = true;[\s\S]*setSettingsReady\(true\)/);
  for (const dependency of ["sidebarCollapsed", "marginVisible", "theme", "markingSurface"] as const) {
    assert.match(
      source,
      new RegExp(`\\}, \\[settingsReady, ${dependency}\\]\\);`),
      `${dependency} persistence must rerun when the initial settings read settles`,
    );
  }
});

test("markingSurface persists as a stable production setting with a palette fallback", () => {
  const appSource = readFileSync(join(repoRoot, "src", "renderer", "app.tsx"), "utf-8");
  const apiSource = readFileSync(join(repoRoot, "src", "renderer", "api.ts"), "utf-8");
  const mainSource = readFileSync(join(repoRoot, "src", "electron", "main.ts"), "utf-8");

  const stableSurfaceIds = /"palette"\s*\|\s*"rail"\s*\|\s*"radial"\s*\|\s*"dock"/;
  assert.match(apiSource, /export type MarkingSurface\s*=\s*"palette"\s*\|\s*"rail"\s*\|\s*"radial"\s*\|\s*"dock"/, "renderer API must expose the four durable marking-surface ids");
  assert.match(apiSource, /markingSurface:\s*MarkingSurface/, "AppSettings must use the shared marking-surface type");
  assert.match(mainSource, stableSurfaceIds, "Electron settings schema must accept the same four durable ids");
  assert.match(mainSource, /markingSurface:\s*"palette"/, "new profiles must default to the palette surface");

  assert.match(
    appSource,
    /setMarkingSurface\(res\.value\.markingSurface\s*\?\?\s*"palette"\)/,
    "older settings files without markingSurface must fall back to palette",
  );
  assert.match(
    appSource,
    /if \(!settingsLoaded\.current\) return;\s*void safeCall\(\(\) => window\.api\.settings\.set\(\{ markingSurface \}\)\);\s*\}, \[settingsReady, markingSurface\]\);/,
    "surface changes must persist only after the initial settings load finishes",
  );
});
