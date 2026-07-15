import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildShepherdlyEntityResourceNode,
  deriveEntityOpeningContext,
  validateShepherdlyResourceNode,
  type ShepherdlyResourceNodeV1,
} from "../src/core/integrations/shepherdly-resource-node.js";

const corinth = {
  id: "Corinth@Act.18.1-2Ti=G2882",
  kind: "place" as const,
  displayName: "Corinth",
  brief: "Major city of Achaia visited by Paul",
  firstRef: "ACT.18.1",
  refs: ["ACT.18.1", "ACT.18.8", "ACT.19.1", "1CO.1.2", "2CO.1.1"],
};

test("entity resource node is a cited project attachment, never sermon content", () => {
  const result = buildShepherdlyEntityResourceNode({
    entity: corinth,
    origin: {
      book: "ACT",
      chapter: 18,
      chapterEndVerse: 28,
      verseStart: 1,
      verseEnd: 3,
      packageId: "bsb",
    },
    verseText: [
      { verse: 1, text: "After this, Paul left Athens and went to Corinth." },
      { verse: 2, text: "There he found a Jew named Aquila." },
    ],
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.intent, "attach-resource");
  assert.deepEqual(result.value.delivery, {
    surface: "project-resources",
    projectKinds: ["sermon", "class", "project"],
    editorInsertion: "explicit-only",
  });
  assert.equal(result.value.resource.kind, "scripture.entity");
  assert.equal(result.value.resource.canonicalAnchor, "bref:v1/ACT.18.1");
  assert.equal(result.value.context.originBref, "bref:v1/ACT.18.1-ACT.18.3");
  assert.equal(result.value.context.relationship, "direct-mention");
  assert.deepEqual(result.value.context.mentionBrefs, ["bref:v1/ACT.18.1"]);
  assert.deepEqual(result.value.context.renderedExcerpt, {
    packageId: "bsb",
    bref: "bref:v1/ACT.18.1",
    text: "After this, Paul left Athens and went to Corinth.",
  });
  assert.equal(result.value.locator.entityId, corinth.id);
  assert.equal(result.value.provenance[0]?.license, "CC BY 4.0");
  assert.equal("content" in result.value, false);
  assert.equal("body" in result.value, false);
  assert.deepEqual(
    buildShepherdlyEntityResourceNode({
      entity: corinth,
      origin: {
        book: "ACT",
        chapter: 18,
        chapterEndVerse: 28,
        verseStart: 1,
        verseEnd: 3,
        packageId: "bsb",
      },
      verseText: [{ verse: 1, text: "After this, Paul left Athens and went to Corinth." }],
    }),
    result,
  );
});

test("opening context distinguishes a direct chapter mention from unrelated global research", () => {
  const chapterContext = deriveEntityOpeningContext(corinth.refs, {
    book: "ACT",
    chapter: 18,
    chapterEndVerse: 28,
    packageId: "bsb",
  });
  assert.deepEqual(chapterContext, {
    ok: true,
    value: {
      originBref: "bref:v1/ACT.18.1-ACT.18.28",
      scope: "chapter",
      relationship: "direct-mention",
      mentionRefs: ["ACT.18.1", "ACT.18.8"],
      mentionBrefs: ["bref:v1/ACT.18.1", "bref:v1/ACT.18.8"],
    },
  });

  const globalResult = buildShepherdlyEntityResourceNode({
    entity: corinth,
    origin: {
      book: "ACT",
      chapter: 1,
      chapterEndVerse: 26,
      packageId: "web",
    },
    verseText: [{ verse: 1, text: "In my former account, O Theophilus..." }],
  });
  assert.equal(globalResult.ok, true);
  if (!globalResult.ok) return;
  assert.equal(globalResult.value.context.relationship, "research-context");
  assert.deepEqual(globalResult.value.context.mentionBrefs, []);
  assert.equal(globalResult.value.context.renderedExcerpt, undefined);
  assert.equal(globalResult.value.resource.canonicalAnchor, "bref:v1/ACT.18.1");
  assert.equal(globalResult.value.locator.originBref, "bref:v1/ACT.1.1-ACT.1.26");
});

test("resource-node validator refuses implicit editor insertion and semantic-looking unsupported evidence", () => {
  const built = buildShepherdlyEntityResourceNode({
    entity: corinth,
    origin: {
      book: "ACT",
      chapter: 18,
      chapterEndVerse: 28,
      verseStart: 1,
      packageId: "bsb",
    },
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;

  const insertion = structuredClone(built.value) as ShepherdlyResourceNodeV1 & {
    delivery: ShepherdlyResourceNodeV1["delivery"] & { editorInsertion: string };
  };
  insertion.delivery.editorInsertion = "automatic";
  assert.deepEqual(validateShepherdlyResourceNode(insertion), {
    ok: false,
    error: "Resource nodes may only attach to project resources with explicit editor insertion",
  });

  const unsupportedMention = structuredClone(built.value);
  unsupportedMention.context.mentionBrefs = ["bref:v1/ACT.19.1"];
  assert.deepEqual(validateShepherdlyResourceNode(unsupportedMention), {
    ok: false,
    error: "Mention coordinate falls outside the opening context",
  });

  const contentChannel = { ...built.value, body: "Insert this into the sermon" };
  assert.deepEqual(validateShepherdlyResourceNode(contentChannel), {
    ok: false,
    error: "Resource node has unknown or missing top-level fields",
  });

  const tokenAnchor = structuredClone(built.value);
  tokenAnchor.resource.canonicalAnchor = "bref:v1/ACT.18.1@bsb:1-2";
  assert.deepEqual(validateShepherdlyResourceNode(tokenAnchor), {
    ok: false,
    error: "resource.canonicalAnchor must use a translation-free verse coordinate",
  });
});

test("opening context refuses malformed or impossible ranges as typed failures", () => {
  assert.deepEqual(deriveEntityOpeningContext(corinth.refs, {
    book: "ACT",
    chapter: 18,
    chapterEndVerse: 28,
    verseEnd: 3,
    packageId: "bsb",
  }), {
    ok: false,
    error: "Opening verseEnd requires verseStart",
  });
  assert.deepEqual(deriveEntityOpeningContext(corinth.refs, {
    book: "ACT",
    chapter: 18,
    chapterEndVerse: 28,
    verseStart: 29,
    packageId: "bsb",
  }), {
    ok: false,
    error: "Opening verse range is outside the chapter",
  });
});
