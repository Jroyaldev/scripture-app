import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildPhraseDiagramProjection,
  layoutPhraseDiagram,
  phraseDiagramPolicy,
  type PhraseDiagramNode,
  type SyntaxStudyPhraseNode,
} from "../src/core/language/index.js";

function word(id: string, isFocus = false): SyntaxStudyPhraseNode {
  return {
    id,
    kind: "word",
    edgeKind: "source-child",
    sourceNodeIds: [id],
    label: "Noun",
    surface: id,
    gloss: `gloss ${id}`,
    isFocus,
    containsFocus: isFocus,
    wordCount: 1,
    children: [],
  };
}

function phrase(
  id: string,
  children: SyntaxStudyPhraseNode[],
  relation = "Coordination",
): SyntaxStudyPhraseNode {
  return {
    id,
    kind: "phrase",
    sourceNodeIds: [id],
    label: "Noun phrase",
    relation,
    surface: children.map((child) => child.surface).join(" "),
    gloss: "",
    isFocus: false,
    containsFocus: children.some((child) => child.containsFocus),
    wordCount: children.reduce((sum, child) => sum + child.wordCount, 0),
    children,
  };
}

function allNodes(root: PhraseDiagramNode): PhraseDiagramNode[] {
  return [root, ...root.children.flatMap(allNodes)];
}

test("compact source phrase remains a complete spatial diagram", () => {
  const root = phrase("root", [word("spirit", true), word("God")], "Head + dependent");
  const policy = phraseDiagramPolicy(root);
  const projection = buildPhraseDiagramProjection(root);

  assert.equal(policy.defaultView, "diagram");
  assert.equal(projection.strategy, "full");
  assert.equal(projection.hiddenNodeCount, 0);
  assert.equal(projection.visibleSourceNodeCount, 3);
  assert.deepEqual(projection.root.children.map((child) => child.id), ["spirit", "God"]);
});

test("wide diagram centers focus with honest source-order summary endpoints", () => {
  const children = Array.from({ length: 12 }, (_, index) => word(`w${index + 1}`, index === 6));
  const root = phrase("wide", children, "Coordinated noun phrases");
  const policy = phraseDiagramPolicy(root);
  const projection = buildPhraseDiagramProjection(root, { maxChildren: 4 });

  assert.equal(policy.defaultView, "outline");
  assert.equal(policy.reason, "wide");
  assert.equal(projection.strategy, "focus-window");
  assert.deepEqual(
    projection.root.children.map((child) => child.label),
    ["6 earlier items", "Noun", "5 later items"],
  );
  assert.equal(projection.root.children[1]!.id, "w7");
  assert.equal(projection.hiddenNodeCount, 11);
});

test("compressed genealogy recommends outline but retains an explicit lineage diagram", () => {
  const root = {
    ...phrase("chain", [word("son"), word("Joseph", true), word("Heli")], "Linked noun chain"),
    compression: "recursive-spine" as const,
    children: [
      { ...word("son"), edgeKind: "compressed-member" as const },
      { ...word("Joseph", true), edgeKind: "compressed-member" as const },
      { ...word("Heli"), edgeKind: "compressed-member" as const },
    ],
  };
  const policy = phraseDiagramPolicy(root);
  const projection = buildPhraseDiagramProjection(root);

  assert.equal(policy.defaultView, "outline");
  assert.equal(policy.reason, "linked-chain");
  assert.equal(projection.strategy, "lineage");
  assert.equal(projection.hasCompressedEdges, true);
});

test("deep projection never drops the selected path", () => {
  let current = word("selected", true);
  for (let level = 9; level >= 1; level -= 1) {
    current = phrase(`p${level}`, [word(`sibling${level}`), current], "Attachment");
  }
  const projection = buildPhraseDiagramProjection(current, { maxDepth: 5 });
  const visible = allNodes(projection.root);
  assert.ok(visible.some((node) => node.id === "selected"));
  assert.ok(visible.some((node) => node.kind === "summary"));
});

test("focused projection summarizes off-path subtrees without hiding the selected leaf", () => {
  const earlier = phrase(
    "earlier",
    Array.from({ length: 30 }, (_, index) => word(`earlier-${index}`)),
  );
  const focusBranch = phrase("focus-branch", [word("nearby"), word("selected", true)]);
  const root = phrase("root", [earlier, focusBranch, word("after")]);
  const projection = buildPhraseDiagramProjection(root);
  const visible = allNodes(projection.root);

  assert.equal(phraseDiagramPolicy(root).defaultView, "outline");
  assert.deepEqual(
    projection.root.children.map((child) => child.label),
    ["1 earlier branch", "Noun phrase", "1 later branch"],
  );
  assert.ok(visible.some((node) => node.id === "selected"));
  assert.ok(!visible.some((node) => node.id === "earlier-0"));
});

test("measured layout is deterministic, ordered, non-overlapping, and mirrors RTL", () => {
  const projection = buildPhraseDiagramProjection(
    phrase("root", [word("one"), word("two", true), word("three")]),
  );
  const sizes = allNodes(projection.root).map((node, index) => ({
    id: node.id,
    width: 130 + index * 5,
    height: 58,
  }));
  const ltr = layoutPhraseDiagram(projection.root, sizes, { direction: "ltr" });
  const repeated = layoutPhraseDiagram(projection.root, sizes, { direction: "ltr" });
  const rtl = layoutPhraseDiagram(projection.root, sizes, { direction: "rtl" });

  assert.deepEqual(ltr, repeated);
  assert.equal(ltr.edges.length, ltr.nodes.length - 1);
  const leaves = ["one", "two", "three"].map((id) => ltr.nodes.find((node) => node.id === id)!);
  assert.ok(leaves[0]!.x < leaves[1]!.x && leaves[1]!.x < leaves[2]!.x);

  for (const [index, node] of ltr.nodes.entries()) {
    for (const other of ltr.nodes.slice(index + 1)) {
      const separated =
        node.x + node.width <= other.x ||
        other.x + other.width <= node.x ||
        node.y + node.height <= other.y ||
        other.y + other.height <= node.y;
      assert.ok(separated, `${node.id} overlaps ${other.id}`);
    }
    const mirrored = rtl.nodes.find((candidate) => candidate.id === node.id)!;
    assert.equal(mirrored.x, rtl.width - node.x - node.width);
  }
});

test("nested layouts align all terminal words on one readable baseline", () => {
  const projection = buildPhraseDiagramProjection(
    phrase("root", [word("shallow"), phrase("nested", [word("deep", true), word("peer")])]),
  );
  const sizes = allNodes(projection.root).map((node) => ({
    id: node.id,
    width: 150,
    height: 56,
  }));
  const layout = layoutPhraseDiagram(projection.root, sizes);
  const terminalY = ["shallow", "deep", "peer"].map(
    (id) => layout.nodes.find((node) => node.id === id)!.y,
  );
  assert.equal(new Set(terminalY).size, 1);
});
