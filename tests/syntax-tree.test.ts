import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseMaculaNodesXml,
  layoutSyntaxTree,
  simplifyTree,
  parseMaculaSentenceRef,
  type SyntaxNode,
} from "../src/core/language/syntax-tree.js";

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
