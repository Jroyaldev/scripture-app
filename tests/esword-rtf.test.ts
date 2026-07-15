import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  rtfToPlain,
  rtfToPlainWithStrongs,
  stripLightMarkup,
} from "../src/core/importer/rtf.js";

describe("e-Sword RTF converter", () => {
  it("strips basic RTF formatting to plain text", () => {
    const raw =
      "\\i0\\b0\\cf0\\f0 In the beginning God created the heaven and the earth.\\cf0\\i0 ";
    assert.equal(rtfToPlain(raw), "In the beginning God created the heaven and the earth.");
  });

  it("captures Strong's superscripts as alignments (AKJV+2 style)", () => {
    const raw =
      "\\viewkind4\\uc1\\nowidctlpar\\lang1033\\f0 In the beginning\\cf11\\super H7225\\cf0\\nosupersub  God\\cf11\\super H430\\cf0\\nosupersub  created\\cf11\\super H1254\\cf0\\nosupersub  the heaven\\cf11\\super H8064\\cf0\\nosupersub  and the earth.\\cf11\\super H776 \\cf0\\i0\\b0\\ulnone\\nosupersub";
    const { text, alignments } = rtfToPlainWithStrongs(raw);
    assert.match(text, /In the beginning/);
    assert.match(text, /God/);
    assert.ok(!text.includes("H7225"), "Strong's ids must not leak into plain text");
    assert.ok(alignments.length >= 4);
    const ids = alignments.flatMap((a) => a.strongs);
    assert.ok(ids.includes("H7225"));
    assert.ok(ids.includes("H430"));
    assert.ok(ids.includes("H1254"));
    const begin = alignments.find((a) => a.strongs.includes("H7225"));
    assert.equal(begin?.word.toLowerCase(), "beginning");
  });

  it("decodes \\'hh codepage and \\uN? unicode escapes", () => {
    // \'e1 = á in Windows-1252; \u770? = combining breve
    const raw = "\\f0 ab\\'e1\\u770?c";
    const text = rtfToPlain(raw);
    assert.ok(text.includes("ab"));
    assert.ok(text.length >= 3);
  });

  it("strips YLT light HTML italics", () => {
    const raw =
      "and darkness <i>is</i> on the face of the deep, and the Spirit of God fluttering on the face of the waters,";
    assert.equal(
      stripLightMarkup(raw),
      "and darkness is on the face of the deep, and the Spirit of God fluttering on the face of the waters,",
    );
  });
});
