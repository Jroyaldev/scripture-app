import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");

test("ScripturePage exposes Command K and preserves atomic passage navigation", () => {
  const source = readFileSync(
    join(repoRoot, "src", "renderer", "components", "ScripturePage.tsx"),
    "utf-8",
  );
  const command = readFileSync(
    join(repoRoot, "src", "renderer", "components", "CommandPalette.tsx"),
    "utf-8",
  );

  assert.match(source, /import \{ parsePassage \} from "\.\.\/utils\/parsePassage\.js";/);
  assert.match(source, /className="passage-jump command-palette-trigger"/);
  assert.match(command, /parsePassage\(trimmed, bookNames, backbone\)/);
  assert.match(command, /onNavigate\(book, chapter, verse, endVerse\)/);

  const goToStart = source.indexOf("const goTo = useCallback");
  assert.notEqual(goToStart, -1);
  const goToEnd = source.indexOf("}, []);", goToStart);
  assert.notEqual(goToEnd, -1);
  const goToBody = source.slice(goToStart, goToEnd);

  assert.ok(goToBody.includes("setBook("));
  assert.ok(goToBody.includes("setChapter("));
});
