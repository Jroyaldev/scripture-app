import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");

// Regression test for a real, reproduced bug: clicking the sidebar collapse
// button (or toggling margin/theme) immediately applied the new state, but
// within ~100ms-2000ms it silently reverted with no further user
// interaction. Root cause: the mount-time settings-load effect resolves
// window.api.settings.get() asynchronously (an IPC round trip) and, when it
// finally resolves, unconditionally called setSidebarCollapsed /
// setMarginVisible / setTheme with the *persisted* value — clobbering any
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

  // A dirty-tracking ref must exist and cover all three racy settings.
  const dirtyRefDecl = source.indexOf("userDirtySettings");
  assert.notEqual(dirtyRefDecl, -1, "expected a userDirtySettings ref to exist");
  assert.match(
    source,
    /userDirtySettings\s*=\s*useRef\(\{\s*sidebarCollapsed:\s*false,\s*marginVisible:\s*false,\s*theme:\s*false\s*\}\)/,
  );

  // The settings-load effect (mount effect calling settings.get()) must gate
  // each setState call on the corresponding dirty flag being false.
  const loadEffectStart = source.indexOf("safeCall(() => window.api.settings.get())");
  assert.notEqual(loadEffectStart, -1, "expected the settings.get() load effect");

  const loadEffectEnd = source.indexOf("}, []);", loadEffectStart);
  assert.notEqual(loadEffectEnd, -1);
  const loadEffectBody = source.slice(loadEffectStart, loadEffectEnd);

  for (const key of ["sidebarCollapsed", "marginVisible", "theme"] as const) {
    const guardIdx = loadEffectBody.indexOf(`if (!userDirtySettings.current.${key})`);
    assert.ok(guardIdx !== -1, `expected a userDirtySettings guard for ${key} in the load effect`);

    const setterName = `set${key[0]!.toUpperCase()}${key.slice(1)}`;
    const setterIdx = loadEffectBody.indexOf(`${setterName}(res.value.${key})`, guardIdx);
    assert.ok(
      setterIdx !== -1 && setterIdx > guardIdx,
      `expected ${setterName}(res.value.${key}) to be guarded by the dirty check`,
    );
  }

  // Each toggle handler must mark its setting dirty synchronously (before
  // calling the corresponding setState), not inside any async callback —
  // this is what closes the race window.
  const toggleHandlers: Array<{ name: string; key: "sidebarCollapsed" | "marginVisible" | "theme" }> = [
    { name: "toggleSidebarCollapsed", key: "sidebarCollapsed" },
    { name: "toggleMargin", key: "marginVisible" },
    { name: "toggleTheme", key: "theme" },
  ];

  for (const { name, key } of toggleHandlers) {
    const handlerStart = source.indexOf(`const ${name} = ()`);
    assert.ok(handlerStart !== -1, `expected handler ${name} to exist`);
    const handlerEnd = source.indexOf("};", handlerStart);
    const handlerBody = source.slice(handlerStart, handlerEnd);

    const dirtyAssignIdx = handlerBody.indexOf(`userDirtySettings.current.${key} = true`);
    assert.ok(dirtyAssignIdx !== -1, `expected ${name} to synchronously set userDirtySettings.current.${key} = true`);

    const setStateIdx = handlerBody.search(/set[A-Za-z]+\(\(prev\)/);
    assert.ok(
      setStateIdx !== -1 && dirtyAssignIdx < setStateIdx,
      `expected ${name} to mark the setting dirty before calling its setState updater`,
    );
  }

  // settingsLoaded must still gate the persist-on-change effects (this
  // invariant — don't write back defaults before real settings arrive —
  // must be preserved by the fix).
  const persistGuards = source.match(/if \(!settingsLoaded\.current\) return;/g) ?? [];
  assert.equal(persistGuards.length, 3, "expected all three persist effects to still guard on settingsLoaded");
});
