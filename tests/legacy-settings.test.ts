import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { sanitizeLegacySettings } from "../src/electron/legacy-settings.js";

// This used to assert that `readingWidth: "wide"` came through the sanitizer
// untouched, alongside readingSize and verseNumbers. That was correct while a
// Narrow/Medium/Wide control existed. Reading size has since absorbed the
// measure, the width preference is gone from the schema, and a migration that
// still adopted it would write a key no code reads. So the key now leaves by
// the same door as `unknown`, and the input keeps it precisely to prove that.
test("legacy settings adopt only validated Pericope-owned values", () => {
  assert.deepEqual(sanitizeLegacySettings({
    theme: "dark-glass",
    markingSurface: "radial",
    sidebarCollapsed: true,
    marginVisible: false,
    readingSize: "l",
    readingWidth: "wide",
    verseNumbers: "faint",
    libraryPath: "/tmp/Library",
    unknown: "dropped",
  }), {
    theme: "dark-glass",
    markingSurface: "radial",
    sidebarCollapsed: true,
    marginVisible: false,
    readingSize: "l",
    verseNumbers: "faint",
    libraryPath: "/tmp/Library",
  });
});

// The retired preference must not be able to prove Pericope identity on its
// own either. A store holding nothing but a theme and a readingWidth is not
// recognizably ours any more, and adopting it would resurrect a dead key.
test("legacy settings no longer treat the retired reading width as a signal", () => {
  assert.equal(sanitizeLegacySettings({ theme: "light", readingWidth: "wide" }), null);
});

test("legacy settings refuse unrelated and corrupt Electron profiles", () => {
  assert.equal(sanitizeLegacySettings({ theme: "light" }), null);
  assert.equal(sanitizeLegacySettings({ libraryPath: 42, recentPassages: "nope" }), null);
  assert.equal(sanitizeLegacySettings({ sidebarCollapsed: false, marginVisible: true }), null);
  assert.equal(sanitizeLegacySettings(null), null);
});

test("legacy settings retain valid reading history but reject malformed arrays", () => {
  assert.deepEqual(sanitizeLegacySettings({
    theme: "light",
    recentPassages: [{ book: "ROM", chapter: 8, verse: 1, packageId: "web", visitedAt: 123 }],
    lastRead: { book: "ROM", chapter: 8, packageId: "web" },
  })?.recentPassages?.[0], {
    book: "ROM",
    chapter: 8,
    verse: 1,
    packageId: "web",
    visitedAt: 123,
  });
  assert.equal(sanitizeLegacySettings({ theme: "light", recentPassages: [{ book: "ROM" }] }), null);
});

test("Pericope identity precedes path lookup and startup holds only successful states", () => {
  const root = resolve(import.meta.dirname, "..");
  const main = readFileSync(resolve(root, "src/electron/main.ts"), "utf8");
  const app = readFileSync(resolve(root, "src/renderer/app.tsx"), "utf8");
  assert.ok(main.indexOf('app.setName("Pericope")') < main.indexOf('app.getPath("logs")'));
  assert.ok(main.indexOf('app.setName("Pericope")') < main.indexOf("new Store<AppSettingsSchema>"));
  assert.match(main, /if \(existsSync\(dedicatedConfig\)\) return \{ status: "dedicated-exists" \}/);
  assert.match(main, /sanitizeLegacySettings/);
  assert.doesNotMatch(main, /copyFileSync/);

  const hold = app.indexOf("setTimeout(resolve, 2400)");
  const firstError = app.indexOf('setLoadState({ status: "error"', hold);
  const firstAwait = app.indexOf("await splashHold", hold);
  assert.ok(hold >= 0 && firstError > hold && firstError < firstAwait, "errors must render before the splash hold");
  assert.match(app, /await splashHold;\s*setLoadState\(\{ status: "first-run"/);
});
