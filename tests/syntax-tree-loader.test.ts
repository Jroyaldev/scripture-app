import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildSyntaxBookIndex, type SyntaxSentence } from "../src/core/language/syntax-tree.js";
import { SyntaxTreeLoader } from "../src/host/syntax-tree-loader.js";

test("syntax loader returns unavailable instead of guessing a Hebrew focus", () => {
  const root = mkdtempSync(join(tmpdir(), "scripture-syntax-focus-"));
  try {
    const packageDir = join(root, "macula-hebrew-wlc");
    mkdirSync(packageDir, { recursive: true });
    const sentence: SyntaxSentence = {
      id: "GEN.1.1.0",
      refLabel: "GEN 1:1",
      book: "GEN",
      chapter: 1,
      verseStart: 1,
      verseEnd: 1,
      tokenIds: ["o010010010011", "o010010010021"],
      root: {
        id: "sentence",
        cat: "S",
        children: [
          { id: "first", cat: "noun", tokenId: "o010010010011", surface: "א", strong: "1" },
          { id: "second", cat: "noun", tokenId: "o010010010021", surface: "ב", strong: "1" },
        ],
      },
    };
    const index = buildSyntaxBookIndex("GEN", [sentence], {
      source: "test",
      language: "hbo",
    });
    writeFileSync(join(packageDir, "GEN.json"), JSON.stringify(index));
    const loader = new SyntaxTreeLoader([root]);

    assert.equal(
      loader.getForToken("oshb-wlc", "GEN", "different-package-id", {
        chapter: 1,
        verse: 1,
        position: 3,
        strong: "1",
        surface: "ג",
      }),
      null,
    );
    assert.equal(
      loader.getForToken("oshb-wlc", "GEN", "o010010010021")?.focusTokenId,
      "o010010010021",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
