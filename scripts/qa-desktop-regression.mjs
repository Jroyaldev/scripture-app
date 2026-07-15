/**
 * Complete desktop visual-system regression.
 *
 * Requires the built Electron app on --remote-debugging-port=9222. Each
 * bounded tour restores the active library and preferences before returning;
 * together they exercise every destination and all four atmospheres.
 */

import { spawnSync } from "node:child_process";

const tours = [
  ["Sidebar and navigation", "scripts/qa-sidebar-tour.mjs"],
  ["Reading topbar", "scripts/qa-topbar-tour.mjs"],
  ["Reading canvas", "scripts/qa-reading-canvas-tour.mjs"],
  ["Living Margin", "scripts/qa-living-margin-tour.mjs"],
  ["Shared controls", "scripts/qa-shared-controls-tour.mjs"],
  ["Settings and onboarding", "scripts/qa-setup-tour.mjs"],
  ["Write, Notes, and Search", "scripts/qa-note-workspace-tour.mjs"],
  ["Study overlays", "scripts/qa-study-overlays-tour.mjs"],
];

for (const [label, script] of tours) {
  console.log(`\nDesktop regression · ${label}`);
  const result = spawnSync(process.execPath, [script], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status ?? "unknown"}`);
  }
}

console.log(`\nDesktop regression complete · ${tours.length} suites`);
