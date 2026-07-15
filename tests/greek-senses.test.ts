import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { describe, it } from "node:test";
import {
  buildGreekSemanticSenseOutline,
  parseMaculaSdbgSenseGlosses,
  semanticSenseLookupKey,
  semanticSenseTagsForToken,
  type GreekSemanticSenseTag,
  type TokenRecord,
} from "../src/core/language/index.js";

const xml = `<?xml version="1.0"?>
<marble-data>
  <morph marbleId="1" Domain="012001;Supernatural Beings" SDBG="πνεῦμα;12.18;Spirit, Spirit of God, Holy Spirit"/>
  <morph marbleId="2" Domain="012001;Supernatural Beings" SDBG="πνεῦμα;12.37;demon, evil spirit|πνεῦμα;12.38;demon, evil spirit"/>
  <morph marbleId="3" Domain="092004;Whom or What Spoken or Written About" SDBG="αὐτός;92.11;he, him, she, her, it, they, them"/>
</marble-data>`;

function token(
  id: string,
  senses: GreekSemanticSenseTag[],
  verse: number,
): TokenRecord {
  return {
    id,
    datasetId: "macula-greek-nestle1904",
    book: "LUK",
    chapter: 4,
    verse,
    position: 1,
    surface: "Πνεύματος",
    lemma: "πνεῦμα",
    strong: "4151",
    strongPrefixed: "G4151",
    morph: { pos: "noun" },
    semanticSenses: senses,
  };
}

describe("MACULA / MARBLE semantic senses", () => {
  it("parses source glosses and resolves multi-id token tags", () => {
    const parsed = parseMaculaSdbgSenseGlosses(xml);
    assert.equal(parsed.byKey.size, 4);
    assert.equal(parsed.conflicts.length, 0);
    const spirit = semanticSenseTagsForToken(
      { lemma: "πνεῦμα", louwNida: "12.18" },
      parsed,
    )[0];
    assert.equal(spirit?.label, "Spirit, Spirit of God, Holy Spirit");
    assert.equal(spirit?.domain, "Supernatural Beings");

    const tags = semanticSenseTagsForToken(
      { lemma: "πνεῦμα", louwNida: "12.18 12.37" },
      parsed,
    );
    assert.deepEqual(tags.map((tag) => tag.id), ["12.18", "12.37"]);
  });

  it("groups identical source glosses and keeps the selected sense visible", () => {
    const parsed = parseMaculaSdbgSenseGlosses(xml);
    const [holy, evilA, evilB] = ["12.18", "12.37", "12.38"].map((id) =>
      semanticSenseTagsForToken({ lemma: "πνεῦμα", louwNida: id }, parsed)[0]!,
    );
    const rare: GreekSemanticSenseTag[] = Array.from({ length: 7 }, (_, index) => ({
      id: `90.${index + 1}`,
      label: `Rare sense ${index + 1}`,
      domain: "Test",
    }));
    const tokens = [
      token("holy-1", [holy], 1),
      token("holy-2", [holy], 2),
      token("holy-3", [holy], 3),
      token("evil-1", [evilA], 4),
      token("evil-2", [evilB], 5),
      ...rare.map((sense, index) => token(`rare-${index}`, [sense], index + 6)),
    ];
    const focus = tokens.at(-1)!;
    const outline = buildGreekSemanticSenseOutline({ tokens, focus, maxVisible: 4 });

    assert.ok(outline);
    assert.equal(outline!.total, 9);
    assert.equal(outline!.hiddenCount, 5);
    assert.equal(outline!.senses[0]?.label, "Spirit, Spirit of God, Holy Spirit");
    assert.equal(outline!.senses[1]?.label, "demon, evil spirit");
    assert.equal(outline!.senses[1]?.count, 2);
    assert.ok(outline!.senses.some((sense) => sense.ids.includes("90.7") && sense.current));
  });

  it("suppresses a one-sense lemma", () => {
    const parsed = parseMaculaSdbgSenseGlosses(xml);
    const holy = semanticSenseTagsForToken(
      { lemma: "πνεῦμα", louwNida: "12.18" },
      parsed,
    )[0]!;
    const tokens = [token("a", [holy], 1), token("b", [holy], 2)];
    assert.equal(buildGreekSemanticSenseOutline({ tokens, focus: tokens[0]! }), null);
  });

  it("keeps the shipped corpus labels clean and lemma-specific", async () => {
    const tokenPath = resolve(
      import.meta.dirname,
      "../data/scripture/packages/macula-greek-nestle1904/tokens.jsonl",
    );
    const lines = createInterface({
      input: createReadStream(tokenPath, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });
    const labelByKey = new Map<string, string>();
    const labelsByLemma = new Map<string, Set<string>>();
    let tokenCount = 0;
    let taggedTokenCount = 0;

    for await (const line of lines) {
      if (!line.trim()) continue;
      const token = JSON.parse(line) as TokenRecord;
      tokenCount++;
      if (!token.semanticSenses?.length) continue;
      taggedTokenCount++;

      for (const sense of token.semanticSenses) {
        assert.ok(sense.label.length >= 2, `${token.id} has an empty semantic label`);
        assert.doesNotMatch(sense.label, /;;|\s{2,}/, `${token.id} has a malformed label`);
        const key = semanticSenseLookupKey(token.lemma, sense.id);
        const previous = labelByKey.get(key);
        assert.ok(!previous || previous === sense.label, `${key} has conflicting labels`);
        labelByKey.set(key, sense.label);

        const lemmaLabels = labelsByLemma.get(token.lemma ?? "") ?? new Set<string>();
        lemmaLabels.add(sense.label);
        labelsByLemma.set(token.lemma ?? "", lemmaLabels);
      }
    }

    assert.equal(tokenCount, 137_779);
    assert.ok(taggedTokenCount / tokenCount > 0.9, "semantic tagging should cover over 90% of tokens");
    assert.ok(labelByKey.size > 8_500, "expected broad lemma+sense coverage");
    assert.ok(labelsByLemma.get("πνεῦμα")?.has("Spirit, Spirit of God, Holy Spirit"));
    assert.ok(labelsByLemma.get("περί")?.has("in relation to, with regard to, concerning"));
    assert.deepEqual(
      [...(labelsByLemma.get("αὐτός") ?? [])].sort(),
      [
        "-self, -selves (for example, myself, yourself, yourselves, ourselves, himself, herself, itself, themselves)",
        "he, him, she, her, it, they, them",
        "same",
      ].sort(),
    );
    assert.ok(labelsByLemma.get("λαμβάνω")?.has("to receive, receiving, to accept"));
    assert.ok(labelsByLemma.get("λέγω")?.has("to say, to talk, to tell, to speak"));
    assert.ok(labelsByLemma.get("δέ")?.has("and, and then"));
  });
});
