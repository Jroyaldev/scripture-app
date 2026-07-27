import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import type { BackboneData, BookNameMap } from "../src/core/reference/types.js";
import {
  extractWorkingPreacherAuthorFromHtml,
  extractWorkingPreacherTitlePassages,
  namesBookOutsideBackbone,
  normalizeWorkingPreacherRecord,
  rankWorkingPreacherResources,
} from "../src/core/resources/working-preacher.js";

const root = resolve(import.meta.dirname, "..");
const backbone = JSON.parse(readFileSync(resolve(root, "data/scripture/backbone.json"), "utf8")) as BackboneData;
const bookNames = JSON.parse(readFileSync(resolve(root, "data/scripture/book-names-en.json"), "utf8")) as BookNameMap;

function record(id: number, title: string, date = "2026-01-01"): unknown {
  return {
    id,
    date,
    modified: date,
    link: `https://www.workingpreacher.org/commentaries/revised-common-lectionary/test/commentary-${id}`,
    title: { rendered: title },
    yoast_head_json: { description: "Public summary", twitter_misc: { "Est. reading time": "5 minutes" } },
  };
}

test("Working Preacher normalization supports exact, discontinuous, cross-chapter, chapter-only, and Spanish titles", () => {
  assert.deepEqual(extractWorkingPreacherTitlePassages("Commentary on Romans 8:1-11", bookNames, backbone), { ok: true, value: { passageLabel: "Romans 8:1-11", brefs: ["bref:v1/ROM.8.1-ROM.8.11"] } });
  assert.deepEqual(extractWorkingPreacherTitlePassages("Commentary on Romans 4:1-5, 13-17", bookNames, backbone), { ok: true, value: { passageLabel: "Romans 4:1-5, 13-17", brefs: ["bref:v1/ROM.4.1-ROM.4.5", "bref:v1/ROM.4.13-ROM.4.17"] } });
  assert.deepEqual(extractWorkingPreacherTitlePassages("Commentary on Romans 8:31-9:5", bookNames, backbone), { ok: true, value: { passageLabel: "Romans 8:31-9:5", brefs: ["bref:v1/ROM.8.31-ROM.9.5"] } });
  const chapter = extractWorkingPreacherTitlePassages("Commentary on Psalm 23", bookNames, backbone);
  assert.equal(chapter.ok, true);
  if (chapter.ok) assert.equal(chapter.value.brefs[0], "bref:v1/PSA.23.1-PSA.23.6");
  assert.deepEqual(extractWorkingPreacherTitlePassages("Comentario del Romanos 8:22-27", bookNames, backbone), { ok: true, value: { passageLabel: "Romanos 8:22-27", brefs: ["bref:v1/ROM.8.22-ROM.8.27"] } });
});

test("Working Preacher normalization is strict and ranking deterministic", () => {
  const first = normalizeWorkingPreacherRecord(record(2, "Commentary on Romans 8:1-11", "2026-01-02"), bookNames, backbone);
  const second = normalizeWorkingPreacherRecord(record(1, "Commentary on Romans 8:1-11", "2026-01-01"), bookNames, backbone);
  assert.equal(first.ok, true); assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;
  const ranked = rankWorkingPreacherResources([second.value, first.value], "bref:v1/ROM.8.1-ROM.8.11");
  assert.equal(ranked.ok, true);
  if (ranked.ok) assert.deepEqual(ranked.value.map((entry) => entry.resource.sourceRecordId), [2, 1]);
  assert.equal(normalizeWorkingPreacherRecord({ ...(record(3, "Commentary on Romans 8:1") as object), body: "forbidden" }, bookNames, backbone).ok, false);
  assert.equal(normalizeWorkingPreacherRecord({ ...(record(4, "Commentary on Romans 8:1") as Record<string, unknown>), link: "https://example.com/x" }, bookNames, backbone).ok, false);
  assert.equal(normalizeWorkingPreacherRecord(record(5, "Commentary on Romans 8:99"), bookNames, backbone).ok, false);
});

test("Working Preacher byline extraction keeps no page body", () => {
  const html = '<div class="card--author-small"><div class="card__title"><h4>Carolyn B. Helsel</h4></div></div>';
  assert.equal(extractWorkingPreacherAuthorFromHtml(html), "Carolyn B. Helsel");
});

test("a title naming a book outside the backbone is skipped, never given its lectionary day's other readings", () => {
  /* Regression: working-preacher:commentary:28957, "Commentary on Sirach
     35:12-17", shipped carrying seven brefs — Jeremiah, Joel, 2 Timothy, Luke,
     Psalm 84 — the rest of its lectionary day. The commentary is about none of
     them. The fallback that rescues a title naming no passage must not fire for
     a title that names one we cannot express. */
  assert.equal(namesBookOutsideBackbone("Commentary on Sirach 35:12-17"), true);
  assert.equal(extractWorkingPreacherTitlePassages("Commentary on Sirach 35:12-17", bookNames, backbone).ok, false);

  for (const title of ["Commentary on Wisdom of Solomon 3:1-9", "Commentary on Baruch 5:1-9", "Commentary on Tobit 4:5-11", "Commentary on 1 Maccabees 4:36-59", "Commentary on Ecclesiasticus 15:15-20"]) {
    assert.equal(namesBookOutsideBackbone(title), true, title);
  }

  /* And it stays out of the way of the canon it resembles. "O.T. Wisdom and
     Poetry" is a real series over Proverbs and Ecclesiastes. */
  for (const title of ["NL183: Preaching Series on O.T. Wisdom and Poetry", "Commentary on Ecclesiastes 3:1-13", "Commentary on Judges 4:1-7", "Commentary on Proverbs 8:1-11"]) {
    assert.equal(namesBookOutsideBackbone(title), false, title);
  }
});
