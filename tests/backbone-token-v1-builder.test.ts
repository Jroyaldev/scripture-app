import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  BSB_TABLE_COLUMNS,
  buildBackboneTokenV1,
  indexPathFor,
  type BuildBackboneTokenOptions,
} from "../scripts/build-backbone-token-v1.ts";

const HEADERS = [
  BSB_TABLE_COLUMNS.greekSort,
  BSB_TABLE_COLUMNS.verseId,
  BSB_TABLE_COLUMNS.language,
  BSB_TABLE_COLUMNS.bsbDisplay,
  "Parsing",
  BSB_TABLE_COLUMNS.hebSort,
  BSB_TABLE_COLUMNS.sourceSurface,
  "Parsing",
  BSB_TABLE_COLUMNS.editionSurface,
  BSB_TABLE_COLUMNS.strongHebrew,
  BSB_TABLE_COLUMNS.strongGreek,
  BSB_TABLE_COLUMNS.heading,
  BSB_TABLE_COLUMNS.bsbSort,
] as const;

interface FixtureRow {
  verseId?: string;
  language?: string;
  hebSort?: number | string;
  greekSort?: number | string;
  bsbSort?: number | string;
  source?: string;
  edition?: string;
  strongHebrew?: number | string;
  strongGreek?: number | string;
  heading?: string;
  display?: string;
}

interface Fixture {
  root: string;
  options: BuildBackboneTokenOptions;
  inputText: string;
  backboneText: string;
}

type AlignmentTuple = [
  charStart: number,
  charEnd: number,
  occurrencePositions: number[],
  group?: number,
];

function tupleQuote(text: string, fragment: AlignmentTuple): string {
  return text.slice(fragment[0], fragment[1]);
}

function fixtureRow(row: FixtureRow): string {
  const values: Record<string, string> = {
    [BSB_TABLE_COLUMNS.greekSort]: String(row.greekSort ?? 0),
    [BSB_TABLE_COLUMNS.verseId]: row.verseId ?? "",
    [BSB_TABLE_COLUMNS.language]: row.language ?? "Greek",
    [BSB_TABLE_COLUMNS.bsbDisplay]: row.display ?? "",
    [BSB_TABLE_COLUMNS.hebSort]: String(row.hebSort ?? 999999),
    [BSB_TABLE_COLUMNS.sourceSurface]: row.source ?? "",
    [BSB_TABLE_COLUMNS.editionSurface]: row.edition ?? row.source ?? "",
    [BSB_TABLE_COLUMNS.strongHebrew]: String(row.strongHebrew ?? ""),
    [BSB_TABLE_COLUMNS.strongGreek]: String(row.strongGreek ?? ""),
    [BSB_TABLE_COLUMNS.heading]: row.heading ?? "",
    [BSB_TABLE_COLUMNS.bsbSort]: String(row.bsbSort ?? 0),
  };
  let parsingSeen = 0;
  return HEADERS.map((header) => {
    if (header === "Parsing") {
      parsingSeen += 1;
      return parsingSeen === 1 ? "machine-code" : "human-readable";
    }
    return values[header] ?? "";
  }).join("\t");
}

function actsRows(): FixtureRow[] {
  return [
    {
      verseId: "Acts 19:7",
      greekSort: 121462,
      bsbSort: 658407,
      source: "δὲ",
      strongGreek: 1161,
      display: " - ",
    },
    {
      greekSort: 121461,
      bsbSort: 658408,
      source: "ἦσαν",
      strongGreek: 1510,
      display: " There were ",
    },
    {
      greekSort: 121466,
      bsbSort: 658409,
      source: "ὡσεὶ",
      strongGreek: 5616,
      display: " about ",
    },
    {
      greekSort: 121467,
      bsbSort: 658410,
      source: "δώδεκα",
      strongGreek: 1427,
      display: " twelve ",
    },
    {
      greekSort: 121463,
      bsbSort: 658411,
      source: "οἱ",
      strongGreek: 3588,
      display: " - ",
    },
    {
      greekSort: 121465,
      bsbSort: 658412,
      source: "ἄνδρες",
      strongGreek: 435,
      display: " men ",
    },
    {
      greekSort: 121464,
      bsbSort: 658413,
      source: "πάντες",
      strongGreek: 3956,
      display: " in all ",
    },
    {
      verseId: "Acts 19:8",
      greekSort: 121479,
      bsbSort: 658424,
      source: "δὲ",
      strongGreek: 1161,
      display: " Then ",
    },
    {
      greekSort: 121478,
      bsbSort: 658425,
      source: "Εἰσελθὼν",
      strongGreek: 1525,
      display: " [Paul] went ",
    },
    {
      greekSort: 121480,
      bsbSort: 658426,
      source: "εἰς",
      strongGreek: 1519,
      display: " into ",
    },
    {
      greekSort: 121481,
      bsbSort: 658427,
      source: "τὴν",
      strongGreek: 3588,
      display: " the ",
    },
    {
      greekSort: 121482,
      bsbSort: 658428,
      source: "συναγωγὴν",
      strongGreek: 4864,
      display: " synagogue ",
    },
    {
      greekSort: 121483,
      bsbSort: 658429,
      source: "ἐπαρρησιάζετο",
      strongGreek: 3955,
      display: " [and] spoke boldly [there] ",
    },
    {
      greekSort: 121484,
      bsbSort: 658430,
      source: "ἐπὶ",
      strongGreek: 1909,
      display: " for ",
    },
    {
      greekSort: 121486,
      bsbSort: 658431,
      source: "τρεῖς",
      strongGreek: 5140,
      display: " three ",
    },
    {
      greekSort: 121485,
      bsbSort: 658432,
      source: "μῆνας",
      strongGreek: 3376,
      display: " months ",
    },
    {
      greekSort: 121487,
      bsbSort: 658433,
      source: "διαλεγόμενος",
      strongGreek: 1256,
      display: " arguing ",
    },
    {
      greekSort: 121488,
      bsbSort: 658434,
      source: "καὶ",
      strongGreek: 2532,
      display: " - ",
    },
    {
      greekSort: 121489,
      bsbSort: 658435,
      source: "πείθων",
      strongGreek: 3982,
      display: " persuasively ",
    },
    {
      greekSort: 121490,
      bsbSort: 658436,
      source: "τὰ",
      edition: "[τὰ]",
      strongGreek: 3588,
      display: " - ",
    },
    {
      greekSort: 121491,
      bsbSort: 658437,
      source: "περὶ",
      strongGreek: 4012,
      display: " about ",
    },
    {
      greekSort: 121492,
      bsbSort: 658438,
      source: "τῆς",
      strongGreek: 3588,
      display: " the ",
    },
    {
      greekSort: 121493,
      bsbSort: 658439,
      source: "βασιλείας",
      strongGreek: 932,
      display: " kingdom ",
    },
    {
      greekSort: 121494,
      bsbSort: 658440,
      source: "τοῦ",
      strongGreek: 3588,
      display: " - ",
    },
    {
      greekSort: 121495,
      bsbSort: 658441,
      source: "Θεοῦ",
      strongGreek: 2316,
      display: " of God ",
    },
  ];
}

function makeFixture(rows: FixtureRow[], chapterVerses?: Array<{ verse: number; text: string }>): Fixture {
  const root = mkdtempSync(join(tmpdir(), "backbone-token-v1-"));
  const inputPath = join(root, "bsb_tables.tsv");
  const backbonePath = join(root, "backbone.json");
  const bsbTextRoot = join(root, "text", "bsb");
  const tokenOutputPath = join(root, "out", "backbone-token-v1.jsonl");
  const alignmentOutputPath = join(
    root,
    "out",
    "bsb",
    "occurrence-alignments-v1.jsonl",
  );
  const inputText = `${HEADERS.join("\t")}\n${rows.map(fixtureRow).join("\n")}\n`;
  const chapters = Array.from({ length: 19 }, () => 0);
  chapters[18] = 28;
  const backboneText = `${JSON.stringify({ version: "v1", books: { ACT: { chapters } } })}\n`;
  const verses =
    chapterVerses ??
    [
      { verse: 7, text: "There were about twelve men in all." },
      {
        verse: 8,
        text: "Then Paul went into the synagogue and spoke boldly there for three months, arguing persuasively about the kingdom of God.",
      },
    ];

  mkdirSync(join(bsbTextRoot, "ACT"), { recursive: true });
  writeFileSync(inputPath, inputText, "utf8");
  writeFileSync(backbonePath, backboneText, "utf8");
  writeFileSync(
    join(bsbTextRoot, "ACT", "19.json"),
    `${JSON.stringify({ verses })}\n`,
    "utf8",
  );
  return {
    root,
    options: {
      inputPath,
      backbonePath,
      bsbTextRoot,
      tokenOutputPath,
      alignmentOutputPath,
    },
    inputText,
    backboneText,
  };
}

function readJsonl(path: string): Array<Record<string, unknown>> {
  return readFileSync(path, "utf8")
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function directReadIndexedRow(
  jsonlPath: string,
  ref: string,
): Record<string, unknown> {
  const index = JSON.parse(readFileSync(indexPathFor(jsonlPath), "utf8")) as {
    verses: Record<string, [number, number]>;
  };
  const range = index.verses[ref];
  assert.ok(range, `index contains ${ref}`);
  const buffer = Buffer.alloc(range[1]);
  const fd = openSync(jsonlPath, "r");
  const bytesRead = readSync(fd, buffer, 0, buffer.length, range[0]);
  closeSync(fd);
  assert.equal(bytesRead, range[1]);
  return JSON.parse(buffer.toString("utf8")) as Record<string, unknown>;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

test("builds deterministic Acts 19 occurrence rows in canonical source order and exact BSB display order", async () => {
  const first = makeFixture(actsRows());
  const second = makeFixture(actsRows());
  try {
    const firstResult = await buildBackboneTokenV1(first.options);
    const secondResult = await buildBackboneTokenV1(second.options);
    assert.equal(firstResult.ok, true);
    assert.equal(secondResult.ok, true);
    if (!firstResult.ok || !secondResult.ok) return;

    assert.equal(
      readFileSync(first.options.tokenOutputPath, "utf8"),
      readFileSync(second.options.tokenOutputPath, "utf8"),
    );
    assert.equal(
      readFileSync(first.options.alignmentOutputPath, "utf8"),
      readFileSync(second.options.alignmentOutputPath, "utf8"),
    );
    assert.equal(
      readFileSync(indexPathFor(first.options.tokenOutputPath), "utf8"),
      readFileSync(indexPathFor(second.options.tokenOutputPath), "utf8"),
    );
    assert.equal(
      readFileSync(indexPathFor(first.options.alignmentOutputPath), "utf8"),
      readFileSync(indexPathFor(second.options.alignmentOutputPath), "utf8"),
    );

    const tokenRows = readJsonl(first.options.tokenOutputPath);
    const tokenMeta = tokenRows[0];
    assert.equal(tokenMeta?.layer, "backbone-token:v1");
    assert.equal(
      tokenMeta?.inventory_semantics,
      "frozen-edition-inclusive-bsb-table-source-slots",
    );
    assert.equal(tokenMeta?.cross_corpus_position_equivalence, "none");
    assert.deepEqual(tokenMeta?.not_equivalent_to, ["MACULA", "OSHB"]);
    assert.equal(
      (tokenMeta?.inputs as { bsb_tables_tsv: { sha256: string } }).bsb_tables_tsv
        .sha256,
      sha256(first.inputText),
    );
    assert.equal(
      (tokenMeta?.inputs as { backbone: { sha256: string } }).backbone.sha256,
      sha256(first.backboneText),
    );

    const actsSeven = tokenRows[1] as {
      ref: string;
      tokens: Array<{
        position: number;
        source_sort: number;
        surface: string;
        strong?: string;
      }>;
    };
    assert.equal(actsSeven.ref, "bref:v1/ACT.19.7");
    assert.deepEqual(
      actsSeven.tokens.map((token) => [token.position, token.source_sort, token.surface]),
      [
        [1, 121461, "ἦσαν"],
        [2, 121462, "δὲ"],
        [3, 121463, "οἱ"],
        [4, 121464, "πάντες"],
        [5, 121465, "ἄνδρες"],
        [6, 121466, "ὡσεὶ"],
        [7, 121467, "δώδεκα"],
      ],
    );

    const actsEight = tokenRows[2] as {
      tokens: Array<{
        position: number;
        source_sort: number;
        edition_surface?: string;
      }>;
    };
    const editionVariant = actsEight.tokens.find(
      (token) => token.source_sort === 121490,
    );
    assert.deepEqual(editionVariant, {
      position: 13,
      source_sort: 121490,
      language: "Greek",
      surface: "τὰ",
      edition_surface: "[τὰ]",
      strong: "G3588",
    });

    const alignmentRows = readJsonl(first.options.alignmentOutputPath);
    const alignmentMeta = alignmentRows[0];
    assert.equal(alignmentMeta?.target_offset_unit, "utf16-code-unit");
    assert.equal(
      alignmentMeta?.target_fragment_unit,
      "whitespace-delimited-word-within-authored-bsb-row",
    );
    assert.equal(
      (
        alignmentMeta?.fragment_tuple as {
          shape: string;
          quote_derivation: string;
        }
      ).shape,
      "[char_start,char_end,occurrence_positions,optional_bsb_sort_group]",
    );
    assert.match(
      (
        alignmentMeta?.fragment_tuple as {
          shape: string;
          quote_derivation: string;
        }
      ).quote_derivation,
      /quote is not duplicated/u,
    );

    const sevenAlignment = alignmentRows[1] as {
      ref: string;
      text_sha256: string;
      text_utf16_length: number;
      fragments: AlignmentTuple[];
    };
    const sevenText = "There were about twelve men in all.";
    assert.equal(sevenAlignment.text_sha256, sha256(sevenText));
    assert.equal(sevenAlignment.text_utf16_length, sevenText.length);
    for (const fragment of sevenAlignment.fragments) {
      assert.ok(fragment[0] >= 0);
      assert.ok(fragment[1] > fragment[0]);
      assert.equal(tupleQuote(sevenText, fragment).length, fragment[1] - fragment[0]);
    }
    assert.equal(
      sevenAlignment.fragments
        .map((fragment) => tupleQuote(sevenText, fragment))
        .join(""),
      sevenText,
    );
    const meaningfulSeven = sevenAlignment.fragments
      .map((fragment) => ({ fragment, quote: tupleQuote(sevenText, fragment) }))
      .filter(({ quote }) => /\S/u.test(quote) && quote !== ".");
    assert.deepEqual(
      meaningfulSeven.map(({ fragment, quote }) => [quote, fragment[2]]),
      [
        ["There", [1]],
        ["were", [1]],
        ["about", [6]],
        ["twelve", [7]],
        ["men", [5]],
        ["in", [4]],
        ["all", [4]],
      ],
    );
    const punctuation = sevenAlignment.fragments.find(
      (fragment) => tupleQuote(sevenText, fragment) === ".",
    );
    assert.deepEqual(punctuation?.[2], []);

    const eightAlignment = alignmentRows[2] as {
      fragments: AlignmentTuple[];
    };
    const eightText =
      "Then Paul went into the synagogue and spoke boldly there for three months, arguing persuasively about the kingdom of God.";
    assert.deepEqual(
      eightAlignment.fragments
        .map((fragment) => ({ fragment, quote: tupleQuote(eightText, fragment) }))
        .filter(({ quote }) => ["Then", "Paul", "went", "of", "God"].includes(quote))
        .map(({ fragment, quote }) => [quote, fragment[2], fragment[3]]),
      [
        ["Then", [2], 658424],
        ["Paul", [1], 658425],
        ["went", [1], 658425],
        ["of", [18], 658441],
        ["God", [18], 658441],
      ],
    );

    assert.equal(
      directReadIndexedRow(
        first.options.tokenOutputPath,
        "bref:v1/ACT.19.7",
      ).ref,
      "bref:v1/ACT.19.7",
    );
    assert.equal(
      directReadIndexedRow(
        first.options.alignmentOutputPath,
        "bref:v1/ACT.19.8",
      ).ref,
      "bref:v1/ACT.19.8",
    );
    const tokenIndex = JSON.parse(
      readFileSync(indexPathFor(first.options.tokenOutputPath), "utf8"),
    ) as Record<string, unknown>;
    assert.equal(tokenIndex.offset_unit, "utf8-byte");
    assert.equal(tokenIndex.derived, true);
    assert.equal(tokenIndex.rebuildable_from, "jsonl-artifact");
    assert.equal(tokenIndex.source_sha256, sha256(first.inputText));
    assert.equal(tokenIndex.artifact_sha256, firstResult.stats.tokenArtifact.sha256);
  } finally {
    rmSync(first.root, { recursive: true, force: true });
    rmSync(second.root, { recursive: true, force: true });
  }
});

test("keeps display-only Unicode words and all punctuation/whitespace as empty occurrence fragments", async () => {
  const fixture = makeFixture(
    [
      {
        verseId: "Acts 19:7",
        language: "Greek",
        greekSort: 0,
        bsbSort: 700001,
        source: "",
        display: " [🌿 supplied] ",
      },
    ],
    [{ verse: 7, text: "🌿 supplied!" }],
  );
  try {
    const result = await buildBackboneTokenV1(fixture.options);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const token = directReadIndexedRow(
      fixture.options.tokenOutputPath,
      "bref:v1/ACT.19.7",
    ) as { tokens: unknown[] };
    assert.deepEqual(token.tokens, []);

    const alignment = directReadIndexedRow(
      fixture.options.alignmentOutputPath,
      "bref:v1/ACT.19.7",
    ) as {
      text_utf16_length: number;
      fragments: AlignmentTuple[];
    };
    const text = "🌿 supplied!";
    assert.equal(alignment.text_utf16_length, text.length);
    assert.deepEqual(alignment.fragments, [
      [0, 2, [], 700001],
      [2, 3, []],
      [3, 11, [], 700001],
      [11, 12, []],
    ]);
    assert.deepEqual(
      alignment.fragments.map((fragment) => tupleQuote(text, fragment)),
      ["🌿", " ", "supplied", "!"],
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("ranks decimal source slots, keeps supplied words, drops placeholders, and marks absent BSB verses honestly", async () => {
  const fixture = makeFixture(
    [
      {
        verseId: "Acts 19:7",
        greekSort: "100.5",
        bsbSort: 700001,
        source: "β",
        display: " {will} ",
      },
      {
        greekSort: "100.1",
        bsbSort: 700002,
        source: "α",
        display: " . . . ",
      },
      {
        greekSort: "100.9",
        bsbSort: 700003,
        source: "γ",
        heading: "<p class=|pshdg|>",
        display: " detached postscript ",
      },
      {
        verseId: "Acts 19:8",
        greekSort: 0,
        bsbSort: 700004,
        source: "",
        display: "",
      },
    ],
    [{ verse: 7, text: "will" }],
  );
  try {
    const result = await buildBackboneTokenV1(fixture.options);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const sevenToken = directReadIndexedRow(
      fixture.options.tokenOutputPath,
      "bref:v1/ACT.19.7",
    ) as { tokens: Array<{ position: number; source_sort: number; surface: string }> };
    assert.deepEqual(
      sevenToken.tokens.map((token) => [
        token.position,
        token.source_sort,
        token.surface,
      ]),
      [
        [1, 100.1, "α"],
        [2, 100.5, "β"],
        [3, 100.9, "γ"],
      ],
    );
    const sevenAlignment = directReadIndexedRow(
      fixture.options.alignmentOutputPath,
      "bref:v1/ACT.19.7",
    ) as {
      fragments: AlignmentTuple[];
    };
    assert.deepEqual(sevenAlignment.fragments, [[0, 4, [2], 700001]]);

    const absentAlignment = directReadIndexedRow(
      fixture.options.alignmentOutputPath,
      "bref:v1/ACT.19.8",
    );
    assert.equal(absentAlignment.target_state, "absent");
    assert.equal("text_sha256" in absentAlignment, false);
    assert.deepEqual(absentAlignment.fragments, []);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("refuses duplicate source and display sorts with diagnostics and publishes no artifacts", async () => {
  const fixture = makeFixture(
    [
      {
        verseId: "Acts 19:7",
        greekSort: 100,
        bsbSort: 200,
        source: "α",
        display: "There",
      },
      {
        greekSort: 100,
        bsbSort: 200,
        source: "β",
        display: "were",
      },
    ],
    [{ verse: 7, text: "There were" }],
  );
  try {
    const result = await buildBackboneTokenV1(fixture.options);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.deepEqual(
      result.diagnostics.map((diagnostic) => diagnostic.code),
      ["duplicate-source-sort", "duplicate-bsb-sort"],
    );
    assert.equal(existsSync(fixture.options.tokenOutputPath), false);
    assert.equal(existsSync(fixture.options.alignmentOutputPath), false);
    assert.equal(existsSync(indexPathFor(fixture.options.tokenOutputPath)), false);
    assert.equal(existsSync(indexPathFor(fixture.options.alignmentOutputPath)), false);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("refuses a display chunk that cannot be matched exactly instead of inferring by Strong number", async () => {
  const fixture = makeFixture(
    [
      {
        verseId: "Acts 19:7",
        greekSort: 100,
        bsbSort: 200,
        source: "α",
        strongGreek: 1,
        display: "light",
      },
      {
        greekSort: 101,
        bsbSort: 201,
        source: "β",
        strongGreek: 1,
        display: "light",
      },
    ],
    [{ verse: 7, text: "light darkness" }],
  );
  try {
    const result = await buildBackboneTokenV1(fixture.options);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.deepEqual(
      result.diagnostics.map((diagnostic) => diagnostic.code),
      ["target-text-not-found"],
    );
    assert.match(result.diagnostics[0]?.message ?? "", /row 201/u);
    assert.equal(existsSync(fixture.options.tokenOutputPath), false);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
