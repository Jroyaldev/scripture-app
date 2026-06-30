/**
 * Native module preflight — run under the Electron runtime.
 *
 * Task A1: `npm start` runs this before launching the app so that an ABI
 * mismatch in `better-sqlite3` fails visibly in the terminal with an
 * actionable message instead of a confusing crash inside the main process.
 *
 *   npm run preflight:electron   # electron scripts/preflight-native.cjs
 *
 * Exit 0 = native module loads under Electron's ABI.
 * Exit 1 = ABI mismatch (or other load failure) — run `npm run rebuild:electron`.
 */
"use strict";

try {
  const Database = require("better-sqlite3");
  const db = new Database(":memory:");
  db.exec("CREATE TABLE preflight_probe (x INTEGER)");
  db.close();
  process.stdout.write(
    "preflight: better-sqlite3 loads under Electron ABI " +
      process.versions.modules +
      "\n",
  );
  process.exit(0);
} catch (err) {
  const msg = String((err && err.message) || err).split("\n").slice(0, 4).join("\n");
  process.stderr.write(
    "\npreflight: FAILED to load better-sqlite3 under the Electron runtime.\n" +
      "This is almost always an ABI mismatch (the module was built for a\n" +
      "different Node/Electron ABI than the one running now).\n\n" +
      "Fix: npm run rebuild:electron\n" +
      "Then re-run: npm start\n\n" +
      "Underlying error:\n" +
      msg +
      "\n",
  );
  process.exit(1);
}
