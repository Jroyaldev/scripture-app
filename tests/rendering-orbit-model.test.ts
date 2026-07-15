import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  flatSensePresentation,
  reverseOrbitModel,
  semanticSenseOutlineModel,
  senseOutlineModel,
  topLevelSenses,
} from "../src/renderer/components/RenderingOrbit.js";

describe("rendering orbit view models", () => {
  const h1254 = [
    { n: "1", text: "to create, shape, form" },
    { n: "1a", text: "(Qal) to shape, fashion, create" },
    { n: "1a1", text: "of heaven and earth" },
    { n: "1b", text: "(Niphal) to be created" },
    { n: "1c", text: "(Piel)" },
    { n: "2", text: "to be fat" },
    { n: "2a", text: "(Hiphil) to make yourselves fat" },
  ];

  it("uses only numeric top-level senses and suppresses grammar scaffolding", () => {
    assert.deepEqual(topLevelSenses(h1254), [h1254[0], h1254[5]]);
    const model = senseOutlineModel({ lemma: "בָּרָא", senses: h1254, strongId: "H1254" });
    assert.ok(model);
    assert.equal(model!.shape, "hierarchical");
    assert.equal(model!.total, 2);
    assert.deepEqual(model!.nodes.map((node) => node.n), ["1", "2"]);
    assert.deepEqual(model!.nodes[0]?.children.map((node) => node.n), ["1a", "1b", "1c"]);
    assert.deepEqual(model!.nodes[0]?.children[0]?.children.map((node) => node.n), ["1a1"]);
    assert.deepEqual(model!.nodes[1]?.children.map((node) => node.n), ["2a"]);
  });

  it("models Thayer numeric prose as a flat outline", () => {
    const model = senseOutlineModel({
      lemma: "λαμβάνω",
      strongId: "G2983",
      source: "Thayer",
      senses: [
        {
          n: "1",
          text: "to take with the hand, lay hold of, any person or thing in order to use it: absolutely, where the context shows what is taken, Mat_26:26",
        },
        { n: "2", text: "to take in order to carry away: without the notion of violence" },
      ],
    });
    assert.ok(model);
    assert.equal(model!.shape, "flat");
    assert.equal(model!.source, "Thayer");
    assert.deepEqual(model!.nodes.map((node) => node.n), ["1", "2"]);
  });

  it("models occurrence-tagged Greek senses with current and hidden state", () => {
    const model = semanticSenseOutlineModel({
      lemma: "Πνεύματος",
      strongId: "G4151",
      outline: {
        source: "MACULA / MARBLE",
        total: 8,
        hiddenCount: 6,
        taggedOccurrences: 300,
        totalOccurrences: 380,
        senses: [
          {
            rank: 1,
            ids: ["12.18"],
            label: "Spirit, Spirit of God, Holy Spirit",
            domain: "Supernatural Beings",
            count: 221,
            current: true,
            examples: ["LUK.4.14"],
          },
          {
            rank: 2,
            ids: ["26.9"],
            label: "spirit, spiritual nature, inner being",
            count: 42,
            current: false,
            examples: ["MRK.2.8"],
          },
        ],
      },
    });
    assert.ok(model);
    assert.equal(model!.source, "MACULA · MARBLE · CC BY 4.0");
    assert.equal(model!.total, 8);
    assert.equal(model!.hiddenCount, 6);
    assert.equal(model!.nodes[0]?.current, true);
    assert.match(model!.nodes[0]?.meta ?? "", /Used here · 221 occurrences/);
  });

  it("derives compact flat labels from source clauses without inventing text", () => {
    assert.deepEqual(
      flatSensePresentation(
        "to take in order to carry away: without the notion of violence, Mat_8:17",
      ),
      {
        summary: "Take in order to carry away",
        detail: "to take in order to carry away: without the notion of violence, Mat_8:17",
      },
    );
    assert.deepEqual(flatSensePresentation("to take what is one's own;"), {
      summary: "Take what is one's own",
      detail: "to take what is one's own;",
    });
    assert.deepEqual(
      flatSensePresentation(
        "Equivalent to ἀληθινός, 1. Joh_6:55.",
        "Equivalent to ἀληθινός",
      ),
      {
        summary: "Equivalent to ἀληθινός",
        detail: "Equivalent to ἀληθινός, 1. Joh_6:55.",
      },
    );
    assert.deepEqual(flatSensePresentation("Joh_6:55 is cited here."), {
      summary: "Joh_6:55 is cited here.",
      detail: "Joh_6:55 is cited here.",
    });
  });

  it("shows no senses pill model for one top-level sense or duplicate raw n", () => {
    assert.equal(
      senseOutlineModel({ lemma: "x", senses: h1254.slice(0, 5) }),
      null,
    );
    assert.equal(
      senseOutlineModel({
        lemma: "x",
        senses: [
          { n: "1", text: "first" },
          { n: "1", text: "duplicate" },
          { n: "2", text: "second" },
        ],
      }),
      null,
    );
  });

  it("keeps multi-digit primary senses at the root", () => {
    const model = senseOutlineModel({
      lemma: "x",
      senses: [
        { n: "1", text: "first" },
        { n: "1a", text: "first branch" },
        { n: "10", text: "tenth" },
        { n: "10a", text: "tenth branch" },
      ],
    });
    assert.ok(model);
    assert.deepEqual(model!.nodes.map((node) => node.n), ["1", "10"]);
    assert.deepEqual(model!.nodes[1]?.children.map((node) => node.n), ["10a"]);
  });

  it("keeps only the source label in the reverse hub", () => {
    const model = reverseOrbitModel({
      englishWord: "love",
      key: "love",
      total: 32,
      packageId: "bsb",
      source: "alignments",
      scopeHint: "whole Bible · BSB",
      segments: [{ label: "ἀγαπάω", count: 32, share: 1, strongs: "G25" }],
    });
    assert.equal(model.hubMeta, "BSB");
  });
});
