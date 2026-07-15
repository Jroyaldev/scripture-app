import assert from "node:assert/strict";
import { test } from "node:test";
import {
  layoutSyntaxTree,
  simplifyTree,
  parseMaculaSentenceRef,
  findLeafTokenIdByContext,
  type SyntaxNode,
} from "../src/core/language/syntax-tree.js";
import { parseMaculaNodesXml } from "../src/host/macula-syntax-xml.js";

const SAMPLE = `<?xml version='1.0' encoding='UTF-8'?>
<Sentences>
  <Sentence ref="MAT 1:1!1-1:1!3">
    <Trees>
      <Tree>
        <Node Cat="S" nodeId="s1">
          <Node Cat="CL" nodeId="cl1">
            <Node Cat="np" nodeId="np1">
              <Node xml:id="n40001001001" Cat="noun" Unicode="Βίβλος" Gloss="book" UnicodeLemma="βίβλος" nodeId="w1">Βίβλος</Node>
            </Node>
            <Node Cat="np" nodeId="np2">
              <Node xml:id="n40001001002" Cat="noun" Unicode="γενέσεως" Gloss="genealogy" nodeId="w2">γενέσεως</Node>
            </Node>
          </Node>
        </Node>
      </Tree>
    </Trees>
  </Sentence>
</Sentences>
`;

test("parseMaculaSentenceRef handles ranges", () => {
  assert.deepEqual(parseMaculaSentenceRef("MAT 1:1!1-1:1!8"), {
    chapter: 1,
    verseStart: 1,
    verseEnd: 1,
  });
  assert.deepEqual(parseMaculaSentenceRef("MAT 5:3!1-5:4!12"), {
    chapter: 5,
    verseStart: 3,
    verseEnd: 4,
  });
  assert.deepEqual(parseMaculaSentenceRef("GEN 1:1"), {
    chapter: 1,
    verseStart: 1,
    verseEnd: 1,
  });
});

test("parseMaculaNodesXml reads Hebrew verse= and nested m gloss", () => {
  const xml = `<?xml version='1.0'?>
<Sentences>
  <Sentence verse="GEN 1:1">
    <Trees>
      <Tree>
        <Node Cat="S" nodeId="s1">
          <Node Cat="CL" nodeId="cl1">
            <Node n="o010010010021" Cat="verb" Unicode="בָּרָ֣א" nodeId="w1" StrongNumberX="1254">
              <m xml:id="o010010010021" english="created" gloss="create">בָּרָ֣א</m>
            </Node>
          </Node>
        </Node>
      </Tree>
    </Trees>
  </Sentence>
</Sentences>`;
  const sentences = parseMaculaNodesXml(xml, "GEN");
  assert.equal(sentences.length, 1);
  assert.equal(sentences[0]!.chapter, 1);
  assert.equal(sentences[0]!.verseStart, 1);
  assert.ok(sentences[0]!.tokenIds.includes("o010010010021"));
});

test("parseMaculaNodesXml keeps self-closing Hebrew morphemes from consuming siblings", () => {
  const xml = `<?xml version='1.0'?>
<Sentences>
  <Sentence verse="1CH 1:10">
    <Trees><Tree><Node Cat="S" nodeId="s1"><Node Cat="CL" nodeId="cl1">
      <Node n="o130010100091ה" Cat="art" Unicode="" nodeId="article" StrongNumberX="1886a">
        <m xml:id="o130010100091ה" english="the" gloss="the"/>
      </Node>
      <Node n="o130010100092" Cat="noun" Unicode="אָֽרֶץ" nodeId="earth" StrongNumberX="0776">
        <m xml:id="o130010100092" english="earth" gloss="earth">אָֽרֶץ</m>
      </Node>
    </Node></Node></Tree></Trees>
  </Sentence>
</Sentences>`;
  const [sentence] = parseMaculaNodesXml(xml, "1CH");
  assert.ok(sentence);
  assert.deepEqual(sentence.tokenIds, ["o130010100091ה", "o130010100092"]);
  const serialized = JSON.stringify(sentence.root);
  assert.doesNotMatch(serialized, /<\/?(?:Node|m)\b/);
  assert.match(serialized, /אָֽרֶץ/);
});

test("parseMaculaNodesXml extracts tokens and tree", () => {
  const sentences = parseMaculaNodesXml(SAMPLE, "MAT");
  assert.equal(sentences.length, 1);
  assert.ok(sentences[0]!.tokenIds.includes("n40001001001"));
  assert.ok(sentences[0]!.tokenIds.includes("n40001001002"));
  assert.equal(sentences[0]!.root.cat, "S");
});

test("layoutSyntaxTree places focus leaf", () => {
  const root: SyntaxNode = {
    id: "s",
    cat: "S",
    children: [
      {
        id: "w1",
        cat: "noun",
        tokenId: "n1",
        surface: "λόγος",
        gloss: "word",
      },
      {
        id: "w2",
        cat: "noun",
        tokenId: "n2",
        surface: "θεοῦ",
        gloss: "of God",
      },
    ],
  };
  const layout = layoutSyntaxTree(root, "n2");
  assert.ok(layout.nodes.length >= 3);
  const focus = layout.nodes.find((n) => n.tokenId === "n2");
  assert.ok(focus?.isFocus);
  assert.ok(layout.edges.length >= 2);
});

test("simplifyTree collapses unary np wrappers", () => {
  const deep: SyntaxNode = {
    id: "a",
    cat: "np",
    children: [
      {
        id: "b",
        cat: "np",
        children: [
          {
            id: "c",
            cat: "noun",
            tokenId: "n1",
            surface: "x",
          },
        ],
      },
    ],
  };
  const s = simplifyTree(deep);
  // Should not be infinitely nested np-only chain to a leaf without children arrays of length 1
  assert.ok(s);
});

test("context leaf matching uses Hebrew word position when Strong's repeats", () => {
  const root: SyntaxNode = {
    id: "sentence",
    cat: "S",
    children: [
      {
        id: "first",
        cat: "prep",
        tokenId: "o010010020061",
        surface: "עַל",
        strong: "5921",
      },
      {
        id: "second",
        cat: "prep",
        tokenId: "o010010020121",
        surface: "עַל",
        strong: "5921",
      },
    ],
  };

  assert.equal(
    findLeafTokenIdByContext(root, {
      strong: "H5921",
      surface: "עַל",
      position: 12,
    }),
    "o010010020121",
  );
});
