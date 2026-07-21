import { existsSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import type { RevisionAppend } from "../../src/core/interfaces.js";
import { appendRevisionJsonl } from "../../src/host/revision-append.js";

const [libraryPath, startPath, encodedAppend] = process.argv.slice(2);
if (!libraryPath || !startPath || !encodedAppend) {
  throw new Error("revision append worker requires library, barrier, and append arguments");
}
const append = JSON.parse(Buffer.from(encodedAppend, "base64url").toString("utf8")) as RevisionAppend;
while (!existsSync(startPath)) await delay(2);
try {
  const result = appendRevisionJsonl(libraryPath, append);
  process.stdout.write(JSON.stringify({ ok: true, result }));
} catch (error) {
  process.stdout.write(JSON.stringify({
    ok: false,
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
  }));
}
