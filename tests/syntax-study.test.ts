import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSyntaxStudyModel,
  syntaxStudyGroupsInSourceOrder,
  syntaxStudyPhraseStops,
  syntaxRoleForClauseChild,
  type SyntaxNode,
} from "../src/core/language/index.js";

function leaf(id: string, cat: string, surface: string, gloss: string): SyntaxNode {
  return { id, cat, tokenId: id, surface, gloss };
}

test("clause child S is a subject, not a sentence wrapper", () => {
  assert.equal(syntaxRoleForClauseChild({ id: "s", cat: "S" }), "subject");
});

test("study model collapses Conj-CL and groups phrase words by function", () => {
  const root: SyntaxNode = {
    id: "sentence",
    cat: "S",
    children: [
      {
        id: "wrapper",
        cat: "CL",
        rule: "Conj-CL",
        children: [
          leaf("and", "conj", "Καὶ", "And"),
          {
            id: "content",
            cat: "CL",
            rule: "V-S-ADV",
            children: [
              { id: "v", cat: "V", children: [leaf("returned", "verb", "ὑπέστρεψεν", "returned")] },
              {
                id: "subject",
                cat: "S",
                children: [
                  { id: "subject-np", cat: "np", children: [
                    leaf("article", "det", "ὁ", "-"),
                    leaf("jesus", "noun", "Ἰησοῦς", "Jesus"),
                  ] },
                ],
              },
              {
                id: "setting",
                cat: "ADV",
                children: [
                  leaf("in", "prep", "ἐν", "in"),
                  leaf("spirit", "noun", "Πνεύματος", "Spirit"),
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  const model = buildSyntaxStudyModel(root, "spirit");
  assert.equal(model.clauses.length, 1);
  assert.deepEqual(model.clauses[0]!.groups.map((group) => group.role), [
    "connector",
    "action",
    "subject",
    "context",
  ]);
  assert.equal(model.clauses[0]!.groups[2]!.gloss, "Jesus");
  assert.equal(model.clauses[0]!.groups[3]!.gloss, "in Spirit");
  assert.deepEqual(
    syntaxStudyGroupsInSourceOrder(model.clauses[0]!.groups).map((group) => group.role),
    ["connector", "action", "subject", "context"],
  );
  assert.equal(model.focusClauseId, "content");
  assert.equal(model.wordCount, 6);
});

test("study model keeps Hebrew object markers in the original but not the English summary", () => {
  const root: SyntaxNode = {
    id: "sentence",
    cat: "S",
    children: [
      {
        id: "clause",
        cat: "CL",
        rule: "PP-V-S-O",
        children: [
          { id: "when", cat: "PP", children: [leaf("beginning", "noun", "בְּרֵאשִׁית", "in beginning")] },
          { id: "action", cat: "V", children: [leaf("create", "verb", "בָּרָא", "created")] },
          { id: "subject", cat: "S", children: [leaf("god", "noun", "אֱלֹהִים", "God")] },
          {
            id: "object",
            cat: "O",
            children: [
              leaf("marker", "om", "אֵת", "(et)"),
              leaf("heavens", "noun", "הַשָּׁמַיִם", "the heavens"),
              leaf("and", "cj", "וְ", "and"),
              leaf("marker2", "om", "אֵת", "(et)"),
              leaf("earth", "noun", "הָאָרֶץ", "the earth"),
            ],
          },
        ],
      },
    ],
  };

  const model = buildSyntaxStudyModel(root, "create");
  const object = model.clauses[0]!.groups.find((group) => group.role === "object");
  assert.match(object!.surface, /אֵת/);
  assert.equal(object!.gloss, "the heavens and the earth");
  assert.equal(object!.words[0]!.gloss, "obj. marker");
  assert.equal(model.clauses[0]!.gloss, "In beginning created God the heavens and the earth");
  assert.equal(model.clauses[0]!.groups[2]!.role, "subject");
});

test("study model renders a Hebrew construct phrase from its NPofNP rule", () => {
  const root: SyntaxNode = {
    id: "sentence",
    cat: "S",
    children: [
      {
        id: "clause",
        cat: "CL",
        children: [
          {
            id: "subject",
            cat: "S",
            children: [
              {
                id: "construct",
                cat: "np",
                rule: "NPofNP",
                children: [
                  leaf("spirit", "noun", "רוּחַ", "Spirit"),
                  leaf("god", "noun", "אֱלֹהִים", "God"),
                ],
              },
            ],
          },
          { id: "action", cat: "V", children: [leaf("hover", "verb", "מְרַחֶפֶת", "hovered")] },
        ],
      },
    ],
  };

  const model = buildSyntaxStudyModel(root, "spirit");
  const subject = model.clauses[0]!.groups[0]!;
  assert.equal(subject.gloss, "Spirit of God");
  assert.equal(subject.phrase?.label, "Noun phrase");
  assert.equal(subject.phrase?.relation, "Head + dependent");
  assert.deepEqual(subject.phrase?.children.map((child) => child.label), ["Noun", "Noun"]);
  assert.equal(subject.phrase?.children[0]?.isFocus, true);
});

test("phrase detail preserves a real prepositional hierarchy and collapses unary wrappers", () => {
  const root: SyntaxNode = {
    id: "sentence",
    cat: "S",
    children: [
      {
        id: "clause",
        cat: "CL",
        children: [
          {
            id: "modifier",
            cat: "ADV",
            rule: "pp2ADV",
            children: [
              {
                id: "pp",
                cat: "pp",
                rule: "PrepNp",
                children: [
                  leaf("in", "prep", "ἐν", "in"),
                  {
                    id: "determined",
                    cat: "np",
                    rule: "DetNP",
                    children: [
                      leaf("the", "det", "τῇ", "the"),
                      {
                        id: "power-spirit",
                        cat: "np",
                        rule: "NPofNP",
                        children: [
                          {
                            id: "power-wrapper",
                            cat: "np",
                            rule: "N2NP",
                            children: [leaf("power", "noun", "δυνάμει", "power")],
                          },
                          {
                            id: "spirit-wrapper",
                            cat: "np",
                            rule: "N2NP",
                            children: [leaf("spirit", "noun", "Πνεύματος", "Spirit")],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  const phrase = buildSyntaxStudyModel(root, "spirit").clauses[0]!.groups[0]!.phrase;
  assert.equal(phrase?.label, "Prepositional phrase");
  assert.equal(phrase?.relation, "Preposition + noun phrase");
  assert.equal(phrase?.wordCount, 4);
  assert.equal(phrase?.children[0]?.label, "Preposition");
  assert.equal(phrase?.children[0]?.edgeKind, "source-child");
  assert.equal(phrase?.children[1]?.label, "Noun phrase");
  assert.equal(phrase?.children[1]?.children[1]?.relation, "Head + dependent");
  assert.equal(phrase?.children[1]?.children[1]?.children[0]?.edgeKind, "compressed-member");
  assert.equal(phrase?.children[1]?.children[1]?.children[1]?.isFocus, true);
});

test("single-word groups do not claim to have phrase detail", () => {
  const model = buildSyntaxStudyModel({
    id: "clause",
    cat: "CL",
    children: [
      {
        id: "verb-role",
        cat: "V",
        rule: "Vp2V",
        children: [
          {
            id: "verb-phrase",
            cat: "vp",
            rule: "V2VP",
            children: [leaf("receive", "verb", "ἐλάβομεν", "we have received")],
          },
        ],
      },
    ],
  }, "receive");

  assert.equal(model.clauses[0]!.groups[0]!.phrase, null);
});

test("phrase stops form one source-order journey across clause boundaries", () => {
  const model = buildSyntaxStudyModel({
    id: "sentence",
    cat: "S",
    children: [
      {
        id: "first-clause",
        cat: "CL",
        children: [
          {
            id: "first-subject",
            cat: "S",
            children: [
              leaf("the-first", "det", "ὁ", "the"),
              leaf("first-person", "noun", "ἄνθρωπος", "person"),
            ],
          },
          { id: "first-verb", cat: "V", children: [leaf("sees", "verb", "βλέπει", "sees")] },
        ],
      },
      {
        id: "second-clause",
        cat: "CL",
        children: [
          {
            id: "second-modifier",
            cat: "ADV",
            children: [
              leaf("in", "prep", "ἐν", "in"),
              leaf("light", "noun", "φωτί", "light"),
            ],
          },
        ],
      },
    ],
  }, "first-person");

  assert.deepEqual(syntaxStudyPhraseStops(model), [
    { clauseId: "first-clause", groupId: "first-subject:subject:0" },
    { clauseId: "second-clause", groupId: "second-modifier:context:0" },
  ]);
  assert.equal(model.clauses[0]!.groups[1]!.phrase, null);
});

test("phrase stops follow word order when an embedded clause interrupts its parent", () => {
  const model = buildSyntaxStudyModel({
    id: "sentence",
    cat: "S",
    children: [
      {
        id: "main",
        cat: "CL",
        children: [
          {
            id: "before",
            cat: "ADV",
            children: [
              leaf("before-one", "prep", "πρὸ", "before"),
              leaf("before-two", "noun", "ἡμέρας", "day"),
            ],
          },
          {
            id: "embedded-holder",
            cat: "np",
            children: [
              {
                id: "embedded",
                cat: "CL",
                children: [
                  {
                    id: "inside",
                    cat: "S",
                    children: [
                      leaf("inside-one", "det", "ὁ", "the"),
                      leaf("inside-two", "noun", "λόγος", "word"),
                    ],
                  },
                ],
              },
            ],
          },
          {
            id: "after",
            cat: "O",
            children: [
              leaf("after-one", "det", "τὸ", "the"),
              leaf("after-two", "noun", "φῶς", "light"),
            ],
          },
        ],
      },
    ],
  }, "inside-two");

  assert.deepEqual(syntaxStudyPhraseStops(model), [
    { clauseId: "main", groupId: "before:context:0" },
    { clauseId: "embedded", groupId: "inside:subject:0" },
    { clauseId: "main", groupId: "after:object:2" },
  ]);
});

test("repeated dependent-noun branches flatten into one readable chain", () => {
  const dependent = (id: string, name: string, child?: SyntaxNode): SyntaxNode => ({
    id,
    cat: "np",
    rule: "NPofNP",
    children: [leaf(`${id}-word`, "noun", name, name), ...(child ? [child] : [])],
  });
  const chain = dependent(
    "joseph",
    "Joseph",
    dependent("heli", "Heli", dependent("matthat", "Matthat", leaf("levi", "noun", "Levi", "Levi"))),
  );
  const model = buildSyntaxStudyModel({
    id: "clause",
    cat: "CL",
    children: [{ id: "predicate", cat: "P", children: [chain] }],
  }, "matthat-word");

  const phrase = model.clauses[0]!.groups[0]!.phrase;
  assert.equal(phrase?.relation, "Head + dependent chain");
  assert.deepEqual(phrase?.children.map((child) => child.surface), [
    "Joseph",
    "Heli",
    "Matthat",
    "Levi",
  ]);
  assert.equal(phrase?.children[2]?.isFocus, true);
});

test("alternating dependent-noun and apposition wrappers do not form a deep staircase", () => {
  const apposition = (id: string, name: string, tail: SyntaxNode): SyntaxNode => ({
    id: `${id}-apposition`,
    cat: "np",
    rule: "Np-Appos",
    children: [leaf(id, "noun", name, name), tail],
  });
  const dependent = (id: string, name: string, tail: SyntaxNode): SyntaxNode => ({
    id: `${id}-dependent`,
    cat: "np",
    rule: "NPofNP",
    children: [leaf(`${id}-det`, "det", "τοῦ", "the"), apposition(id, name, tail)],
  });
  const chain = {
    id: "genealogy",
    cat: "np",
    rule: "NPofNP",
    children: [
      leaf("son", "noun", "υἱός", "son"),
      apposition(
        "joseph",
        "Ἰωσήφ",
        dependent(
          "heli",
          "Ἠλεί",
          dependent(
            "matthat",
            "Ματθάτ",
            dependent("levi", "Λευεί", leaf("melchi", "noun", "Μελχεί", "Melchi")),
          ),
        ),
      ),
    ],
  } satisfies SyntaxNode;

  const phrase = buildSyntaxStudyModel({
    id: "clause",
    cat: "CL",
    children: [{ id: "predicate", cat: "P", children: [chain] }],
  }, "matthat").clauses[0]!.groups[0]!.phrase;

  assert.equal(phrase?.relation, "Linked noun chain");
  assert.ok((phrase?.children.length ?? 0) > 5);
  assert.ok(phrase?.children.some((child) => child.isFocus));
  assert.ok(phrase?.children.every((child) => child.children.length <= 1));
  assert.ok(phrase?.children.every((child) => child.edgeKind === "compressed-member"));
});

test("common source rules receive grammatical relationship labels", () => {
  const model = buildSyntaxStudyModel({
    id: "clause",
    cat: "CL",
    children: [
      {
        id: "subject",
        cat: "S",
        children: [
          {
            id: "described",
            cat: "np",
            rule: "NpPp",
            children: [
              leaf("wisdom", "noun", "σοφίαν", "wisdom"),
              {
                id: "setting",
                cat: "pp",
                rule: "PrepNp",
                children: [
                  leaf("in", "prep", "ἐν", "in"),
                  leaf("mystery", "noun", "μυστηρίῳ", "mystery"),
                ],
              },
            ],
          },
        ],
      },
    ],
  }, "wisdom");

  assert.equal(
    model.clauses[0]!.groups[0]!.phrase?.relation,
    "Noun phrase + prepositional phrase",
  );
});

test("a missing focus token never marks the first clause as selected", () => {
  const model = buildSyntaxStudyModel({
    id: "clause",
    cat: "CL",
    children: [{ id: "verb", cat: "V", children: [leaf("word", "verb", "γράφει", "writes")] }],
  }, "not-in-this-tree");

  assert.equal(model.focusWord, null);
  assert.equal(model.focusClauseId, null);
  assert.equal(model.clauses[0]!.isFocus, false);
});

test("study model carries sentence-level conjunctions into the following clause", () => {
  const root: SyntaxNode = {
    id: "sentence",
    cat: "S",
    children: [
      leaf("now", "cjp", "וְ", "now"),
      {
        id: "first",
        cat: "CL",
        children: [
          { id: "first-v", cat: "V", children: [leaf("was", "verb", "הָיְתָה", "was")] },
        ],
      },
      leaf("and", "cjp", "וְ", "and"),
      {
        id: "second",
        cat: "CL",
        children: [
          { id: "second-s", cat: "S", children: [leaf("spirit", "noun", "רוּחַ", "Spirit")] },
        ],
      },
    ],
  };

  const model = buildSyntaxStudyModel(root, "spirit");
  assert.deepEqual(model.clauses.map((clause) => clause.groups[0]!.gloss), ["now", "and"]);
  assert.equal(model.clauses[1]!.groups[0]!.role, "connector");
});

test("outline clauses preserve real hierarchy and exclude embedded words from the parent summary", () => {
  const root: SyntaxNode = {
    id: "sentence",
    cat: "S",
    children: [
      {
        id: "main",
        cat: "CL",
        rule: "S-V",
        children: [
          { id: "subject", cat: "S", children: [leaf("paul", "noun", "Παῦλος", "Paul")] },
          { id: "action", cat: "V", children: [leaf("writes", "verb", "γράφει", "writes")] },
          {
            id: "embedded-holder",
            cat: "np",
            children: [
              {
                id: "dependent",
                cat: "CL",
                rule: "sub-CL",
                children: [
                  { id: "dep-v", cat: "V", children: [leaf("say", "verb", "λέγων", "saying")] },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  const model = buildSyntaxStudyModel(root, "say");
  assert.equal(model.clauses.length, 2);
  assert.equal(model.clauses[1]!.parentId, "main");
  assert.equal(model.clauses[1]!.depth, 1);
  assert.equal(model.clauses[1]!.label, "Embedded clause");
  assert.equal(model.clauses[0]!.gloss, "Paul writes");
  assert.equal(model.clauses[1]!.gloss, "Saying");
});

test("a parent phrase gloss stops before its embedded clause", () => {
  const root: SyntaxNode = {
    id: "sentence",
    cat: "S",
    children: [
      {
        id: "main",
        cat: "CL",
        children: [
          {
            id: "subject",
            cat: "S",
            children: [
              leaf("paul", "noun", "Παῦλος", "Paul"),
              {
                id: "holder",
                cat: "np",
                children: [
                  leaf("apostle", "noun", "ἀπόστολος", "apostle"),
                  {
                    id: "embedded",
                    cat: "CL",
                    children: [
                      { id: "called", cat: "V", children: [leaf("called-word", "verb", "κλητός", "called")] },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  const model = buildSyntaxStudyModel(root, "called-word");
  assert.equal(model.clauses[0]!.groups[0]!.gloss, "Paul apostle");
  assert.equal(model.clauses[0]!.gloss, "Paul apostle");
  assert.equal(model.clauses[1]!.gloss, "Called");
  const phrase = model.clauses[0]!.groups[0]!.phrase;
  assert.ok(phrase);
  const flattened = JSON.stringify(phrase);
  assert.doesNotMatch(flattened, /κλητός|called-word/);
  assert.match(flattened, /Embedded clause/);
  assert.match(flattened, /"targetClauseId":"embedded"/);
});

test("empty embedded-clause scaffolding is not exposed as dead-end navigation", () => {
  const model = buildSyntaxStudyModel({
    id: "main",
    cat: "CL",
    children: [
      {
        id: "subject",
        cat: "S",
        children: [
          leaf("first", "noun", "בְּנֵי", "sons"),
          leaf("second", "noun", "הַנְּבִיאִים", "prophets"),
          {
            id: "empty-wrapper",
            cat: "CL",
            rule: "P2CL",
            children: [{ id: "empty-predicate", cat: "P", children: [{ id: "empty-noun", cat: "noun" }] }],
          },
        ],
      },
    ],
  }, "first");

  const phrase = model.clauses[0]!.groups[0]!.phrase;
  assert.ok(phrase);
  assert.doesNotMatch(JSON.stringify(phrase), /empty-wrapper|Embedded clause/);
});

test("study-facing roles use grammatical labels", () => {
  assert.equal(buildSyntaxStudyModel({
    id: "clause",
    cat: "CL",
    children: [
      { id: "subject", cat: "S", children: [leaf("earth", "noun", "אֶרֶץ", "earth")] },
      { id: "verb", cat: "V", children: [leaf("was", "verb", "הָיְתָה", "was")] },
    ],
  }, "earth").clauses[0]!.groups.map((group) => group.label).join(", "), "Subject, Verb");
});

test("a copular source O uses predicate while ordinary O remains object", () => {
  const model = buildSyntaxStudyModel({
    id: "clause",
    cat: "CL",
    rule: "S-V-O",
    children: [
      { id: "subject", cat: "S", children: [leaf("earth", "noun", "הָאָרֶץ", "the earth")] },
      {
        id: "verb",
        cat: "V",
        children: [{ ...leaf("was", "verb", "הָיְתָה", "was"), lemma: "הָיָה" }],
      },
      { id: "object", cat: "O", children: [leaf("empty", "adj", "תֹהוּ", "formless")] },
    ],
  }, "empty");

  assert.equal(model.clauses[0]!.groups[2]!.label, "Predicate");

  const ordinary = buildSyntaxStudyModel({
    id: "ordinary",
    cat: "CL",
    rule: "V-O",
    children: [
      { id: "received", cat: "V", children: [leaf("receive", "verb", "ἐλάβομεν", "received")] },
      { id: "gift", cat: "O", children: [leaf("grace", "noun", "χάριν", "grace")] },
    ],
  }, "grace");
  assert.equal(ordinary.clauses[0]!.groups[1]!.label, "Object");
});

test("second-object and object-complement source functions stay distinct", () => {
  const model = buildSyntaxStudyModel({
    id: "clause",
    cat: "CL",
    children: [
      { id: "second", cat: "O2", children: [leaf("milk", "noun", "γάλα", "milk")] },
      { id: "object-complement", cat: "OC", children: [leaf("liar", "noun", "ψεύστην", "a liar")] },
    ],
  }, "liar");

  assert.deepEqual(model.clauses[0]!.groups.map((group) => group.label), [
    "Second object",
    "Object complement",
  ]);
});

test("NPofNP does not inject of into non-nominal attached-form structures", () => {
  const model = buildSyntaxStudyModel({
    id: "clause",
    cat: "CL",
    children: [
      {
        id: "verb-role",
        cat: "V",
        children: [
          {
            id: "attached",
            cat: "np",
            rule: "NPofNP",
            children: [
              leaf("registered", "verb", "הִתְיַחְשׂ", "registered"),
              leaf("them", "pron", "ָם", "them"),
            ],
          },
        ],
      },
    ],
  }, "them");

  assert.equal(model.clauses[0]!.groups[0]!.gloss, "registered them");
});
