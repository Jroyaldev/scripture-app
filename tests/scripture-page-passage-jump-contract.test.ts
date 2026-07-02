import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");

test("ScripturePage wires the passage-jump input through the parsePassage util and an atomic goTo helper", () => {
  const source = readFileSync(
    join(repoRoot, "src", "renderer", "components", "ScripturePage.tsx"),
    "utf-8",
  );

  assert.match(source, /import \{ parsePassage \} from "\.\.\/utils\/parsePassage\.js";/);
  assert.match(source, /className="passage-jump"/);

  const goToStart = source.indexOf("const goTo = useCallback");
  assert.notEqual(goToStart, -1);
  const goToEnd = source.indexOf("}, []);", goToStart);
  assert.notEqual(goToEnd, -1);
  const goToBody = source.slice(goToStart, goToEnd);

  assert.ok(goToBody.includes("setBook("));
  assert.ok(goToBody.includes("setChapter("));
});
