#!/usr/bin/env node
const { existsSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = resolve(__dirname, "..");
const electronVersion = require(join(repoRoot, "node_modules", "electron", "package.json")).version;
const betterSqliteDir = join(repoRoot, "node_modules", "better-sqlite3");
const nodeGypBin = join(
  repoRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "node-gyp.cmd" : "node-gyp",
);

if (!existsSync(betterSqliteDir)) {
  console.error("better-sqlite3 is not installed. Run npm install first.");
  process.exit(1);
}

if (!existsSync(nodeGypBin)) {
  console.error("node-gyp is not available in node_modules/.bin. Run npm install first.");
  process.exit(1);
}

const args = [
  "rebuild",
  "--release",
  `--target=${electronVersion}`,
  `--arch=${process.env["npm_config_arch"] || process.arch}`,
  "--dist-url=https://electronjs.org/headers",
  "--runtime=electron",
];

console.log(`Rebuilding better-sqlite3 for Electron ${electronVersion} (${process.arch})...`);
const result = spawnSync(nodeGypBin, args, {
  cwd: betterSqliteDir,
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
