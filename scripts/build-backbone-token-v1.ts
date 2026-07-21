/**
 * Build the immutable, occurrence-grounded source-slot layer used by exact
 * phrase anchors, plus the BSB package's exact UTF-16 display alignments.
 *
 * Usage:
 *   node --import tsx scripts/build-backbone-token-v1.ts \
 *     --input /path/to/bsb_tables.tsv
 *
 * The source inventory is deliberately its own frozen, edition-inclusive
 * `backbone-token:v1` layer. Positions do not claim equivalence with MACULA,
 * OSHB, or any other token corpus.
 */
import { createHash } from "node:crypto";
import {
  closeSync,
  createReadStream,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";

export const BSB_TABLE_COLUMNS = {
  hebSort: "Heb Sort",
  greekSort: "Greek Sort",
  bsbSort: "BSB Sort",
  language: "Language",
  sourceSurface: "WLC / Nestle Base TR RP WH NE NA SBL",
  editionSurface:
    "WLC / Nestle Base {TR} ⧼RP⧽ (WH) 〈NE〉 [NA] ‹SBL› [[ECM]]",
  strongHebrew: "Str Heb",
  strongGreek: "Str Grk",
  verseId: "VerseId",
  heading: "Hdg",
  bsbDisplay: "BSB version",
} as const;

const LAYER = "backbone-token:v1" as const;
const TOKEN_ARTIFACT_TYPE = "backbone-token-v1" as const;
const ALIGNMENT_ARTIFACT_TYPE = "bsb-occurrence-alignments-v1" as const;
const MAX_DIAGNOSTICS = 100;

export type BuildDiagnosticCode =
  | "input-not-found"
  | "backbone-not-found"
  | "bsb-text-root-not-found"
  | "empty-input"
  | "missing-column"
  | "duplicate-required-column"
  | "invalid-verse-id"
  | "invalid-backbone"
  | "invalid-reference"
  | "duplicate-reference"
  | "out-of-order-reference"
  | "row-without-reference"
  | "unknown-source-language"
  | "invalid-source-sort"
  | "duplicate-source-sort"
  | "invalid-bsb-sort"
  | "duplicate-bsb-sort"
  | "missing-bsb-text"
  | "invalid-bsb-text"
  | "target-text-not-found";

export interface BuildDiagnostic {
  code: BuildDiagnosticCode;
  message: string;
  line?: number;
  ref?: string;
}

export interface BuildBackboneTokenOptions {
  inputPath: string;
  backbonePath: string;
  bsbTextRoot: string;
  tokenOutputPath: string;
  alignmentOutputPath: string;
}

export interface ArtifactStats {
  path: string;
  indexPath: string;
  bytes: number;
  sha256: string;
}

export interface BuildStats {
  dataRows: number;
  verses: number;
  sourceSlots: number;
  alignedWords: number;
  uncoveredFragments: number;
  sourceTsvSha256: string;
  backboneSha256: string;
  bsbTextSha256: string;
  tokenArtifact: ArtifactStats;
  alignmentArtifact: ArtifactStats;
}

export type BuildBackboneTokenResult =
  | { ok: true; stats: BuildStats }
  | { ok: false; diagnostics: BuildDiagnostic[] };

interface BackboneBook {
  chapters: number[];
}

interface Backbone {
  version: string;
  books: Record<string, BackboneBook>;
}

interface ColumnIndexes {
  hebSort: number;
  greekSort: number;
  bsbSort: number;
  language: number;
  sourceSurface: number;
  editionSurface: number;
  strongHebrew: number;
  strongGreek: number;
  verseId: number;
  heading: number;
  bsbDisplay: number;
}

interface ParsedRef {
  book: string;
  chapter: number;
  verse: number;
  bref: string;
}

type SourceLanguage = "Hebrew" | "Aramaic" | "Greek";

interface TableRow {
  line: number;
  languageRaw: string;
  hebSortRaw: string;
  greekSortRaw: string;
  bsbSortRaw: string;
  sourceSurface: string;
  editionSurface: string;
  strongHebrewRaw: string;
  strongGreekRaw: string;
  headingRaw: string;
  displayRaw: string;
}

interface VerseGroup {
  ref: ParsedRef;
  rows: TableRow[];
}

interface SourceSlot {
  position: number;
  source_sort: number;
  language: SourceLanguage;
  surface: string;
  edition_surface?: string;
  strong?: string;
}

interface DisplayGroup {
  bsbSort: number;
  target: string;
  occurrencePositions: number[];
  line: number;
}

type BsbVerseText =
  | { state: "present"; text: string }
  | { state: "absent" };

type AlignmentFragment = [
  charStart: number,
  charEnd: number,
  occurrencePositions: number[],
  group?: number,
];

interface JsonlIndex {
  type: "jsonl-byte-offset-index";
  format_version: 1;
  derived: true;
  rebuildable_from: "jsonl-artifact";
  artifact_type: typeof TOKEN_ARTIFACT_TYPE | typeof ALIGNMENT_ARTIFACT_TYPE;
  layer: typeof LAYER;
  source_sha256: string;
  artifact_sha256: string;
  offset_unit: "utf8-byte";
  meta: readonly [number, number];
  verses: Record<string, readonly [number, number]>;
}

interface FinalizedJsonl {
  bytes: number;
  sha256: string;
  index: JsonlIndex;
}

interface VerseOutput {
  tokenRecord: Record<string, unknown>;
  alignmentRecord: Record<string, unknown>;
  sourceSlots: number;
  alignedWords: number;
  uncoveredFragments: number;
}

const BOOK_NAME_TO_USFM: Readonly<Record<string, string>> = {
  Genesis: "GEN",
  Exodus: "EXO",
  Leviticus: "LEV",
  Numbers: "NUM",
  Deuteronomy: "DEU",
  Joshua: "JOS",
  Judges: "JDG",
  Ruth: "RUT",
  "1 Samuel": "1SA",
  "2 Samuel": "2SA",
  "1 Kings": "1KI",
  "2 Kings": "2KI",
  "1 Chronicles": "1CH",
  "2 Chronicles": "2CH",
  Ezra: "EZR",
  Nehemiah: "NEH",
  Esther: "EST",
  Job: "JOB",
  Psalm: "PSA",
  Psalms: "PSA",
  Proverbs: "PRO",
  Ecclesiastes: "ECC",
  "Song of Solomon": "SNG",
  "Song of Songs": "SNG",
  Song: "SNG",
  Isaiah: "ISA",
  Jeremiah: "JER",
  Lamentations: "LAM",
  Ezekiel: "EZK",
  Daniel: "DAN",
  Hosea: "HOS",
  Joel: "JOL",
  Amos: "AMO",
  Obadiah: "OBA",
  Jonah: "JON",
  Micah: "MIC",
  Nahum: "NAH",
  Habakkuk: "HAB",
  Zephaniah: "ZEP",
  Haggai: "HAG",
  Zechariah: "ZEC",
  Malachi: "MAL",
  Matthew: "MAT",
  Mark: "MRK",
  Luke: "LUK",
  John: "JHN",
  Acts: "ACT",
  Romans: "ROM",
  "1 Corinthians": "1CO",
  "2 Corinthians": "2CO",
  Galatians: "GAL",
  Ephesians: "EPH",
  Philippians: "PHP",
  Colossians: "COL",
  "1 Thessalonians": "1TH",
  "2 Thessalonians": "2TH",
  "1 Timothy": "1TI",
  "2 Timothy": "2TI",
  Titus: "TIT",
  Philemon: "PHM",
  Hebrews: "HEB",
  James: "JAS",
  "1 Peter": "1PE",
  "2 Peter": "2PE",
  "1 John": "1JN",
  "2 John": "2JN",
  "3 John": "3JN",
  Jude: "JUD",
  Revelation: "REV",
};

class DiagnosticCollector {
  readonly items: BuildDiagnostic[] = [];
  private omitted = 0;

  add(diagnostic: BuildDiagnostic): void {
    if (this.items.length < MAX_DIAGNOSTICS) {
      this.items.push(diagnostic);
    } else {
      this.omitted += 1;
    }
  }

  finish(): BuildDiagnostic[] {
    if (this.omitted > 0 && this.items.length > 0) {
      const last = this.items[this.items.length - 1];
      if (last) {
        last.message = `${last.message} (${this.omitted} additional diagnostics omitted)`;
      }
    }
    return this.items;
  }
}

class JsonlArtifactWriter {
  private readonly fd: number;
  private readonly digest = createHash("sha256");
  private readonly verses: Record<string, readonly [number, number]> = {};
  private offset = 0;
  private metaRange: readonly [number, number] = [0, 0];
  private closed = false;

  constructor(
    readonly tempPath: string,
    private readonly artifactType: typeof TOKEN_ARTIFACT_TYPE | typeof ALIGNMENT_ARTIFACT_TYPE,
    private readonly sourceSha256: string,
  ) {
    mkdirSync(dirname(tempPath), { recursive: true });
    rmSync(tempPath, { force: true });
    this.fd = openSync(tempPath, "wx");
  }

  writeMeta(record: Record<string, unknown>): void {
    this.metaRange = this.writeRecord(record);
  }

  writeVerse(ref: string, record: Record<string, unknown>): void {
    this.verses[ref] = this.writeRecord(record);
  }

  finalize(): FinalizedJsonl {
    if (!this.closed) {
      fsyncSync(this.fd);
      closeSync(this.fd);
      this.closed = true;
    }
    const sha256 = this.digest.digest("hex");
    return {
      bytes: this.offset,
      sha256,
      index: {
        type: "jsonl-byte-offset-index",
        format_version: 1,
        derived: true,
        rebuildable_from: "jsonl-artifact",
        artifact_type: this.artifactType,
        layer: LAYER,
        source_sha256: this.sourceSha256,
        artifact_sha256: sha256,
        offset_unit: "utf8-byte",
        meta: this.metaRange,
        verses: this.verses,
      },
    };
  }

  abort(): void {
    if (!this.closed) {
      closeSync(this.fd);
      this.closed = true;
    }
    rmSync(this.tempPath, { force: true });
  }

  private writeRecord(record: Record<string, unknown>): readonly [number, number] {
    const line = Buffer.from(JSON.stringify(record), "utf8");
    const start = this.offset;
    writeAllSync(this.fd, line);
    writeAllSync(this.fd, Buffer.from("\n", "utf8"));
    this.digest.update(line);
    this.digest.update("\n", "utf8");
    this.offset += line.byteLength + 1;
    return [start, line.byteLength];
  }
}

class BsbTextReader {
  private cachedBook = "";
  private cachedChapter = -1;
  private cachedVerses = new Map<number, string>();

  constructor(private readonly root: string) {}

  get(ref: ParsedRef, diagnostics: DiagnosticCollector): BsbVerseText | null {
    if (this.cachedBook !== ref.book || this.cachedChapter !== ref.chapter) {
      const path = join(this.root, ref.book, `${ref.chapter}.json`);
      if (!existsSync(path)) {
        diagnostics.add({
          code: "missing-bsb-text",
          ref: ref.bref,
          message: `Missing BSB chapter artifact ${ref.book}/${ref.chapter}.json`,
        });
        return null;
      }
      const parsed = parseBsbChapter(readFileSync(path, "utf8"));
      if (parsed === null) {
        diagnostics.add({
          code: "invalid-bsb-text",
          ref: ref.bref,
          message: `Invalid BSB chapter artifact ${ref.book}/${ref.chapter}.json`,
        });
        return null;
      }
      this.cachedBook = ref.book;
      this.cachedChapter = ref.chapter;
      this.cachedVerses = parsed;
    }

    const text = this.cachedVerses.get(ref.verse);
    if (text === undefined) {
      return { state: "absent" };
    }
    return { state: "present", text };
  }
}

export function defaultBuildOptions(inputPath: string): BuildBackboneTokenOptions {
  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = resolve(scriptDirectory, "..");
  return {
    inputPath: resolve(inputPath),
    backbonePath: join(repositoryRoot, "data/scripture/backbone.json"),
    bsbTextRoot: join(repositoryRoot, "data/scripture/text/bsb"),
    tokenOutputPath: join(repositoryRoot, "data/scripture/backbone-token-v1.jsonl"),
    alignmentOutputPath: join(
      repositoryRoot,
      "data/scripture/packages/bsb/occurrence-alignments-v1.jsonl",
    ),
  };
}

export function indexPathFor(jsonlPath: string): string {
  return jsonlPath.endsWith(".jsonl")
    ? `${jsonlPath.slice(0, -".jsonl".length)}.index.json`
    : `${jsonlPath}.index.json`;
}

export async function buildBackboneTokenV1(
  options: BuildBackboneTokenOptions,
): Promise<BuildBackboneTokenResult> {
  const diagnostics = new DiagnosticCollector();
  if (!existsSync(options.inputPath)) {
    return {
      ok: false,
      diagnostics: [
        {
          code: "input-not-found",
          message: `Input TSV not found: ${options.inputPath}`,
        },
      ],
    };
  }
  if (!existsSync(options.backbonePath)) {
    return {
      ok: false,
      diagnostics: [
        {
          code: "backbone-not-found",
          message: `Backbone artifact not found: ${options.backbonePath}`,
        },
      ],
    };
  }
  if (!existsSync(options.bsbTextRoot)) {
    return {
      ok: false,
      diagnostics: [
        {
          code: "bsb-text-root-not-found",
          message: `BSB text root not found: ${options.bsbTextRoot}`,
        },
      ],
    };
  }

  const backboneText = readFileSync(options.backbonePath, "utf8");
  const backbone = parseBackbone(backboneText);
  if (backbone === null) {
    return {
      ok: false,
      diagnostics: [
        {
          code: "invalid-backbone",
          message: `Invalid backbone artifact: ${options.backbonePath}`,
        },
      ],
    };
  }

  const [sourceTsvSha256, bsbTextDigest] = await Promise.all([
    sha256File(options.inputPath),
    sha256JsonDirectory(options.bsbTextRoot),
  ]);
  const backboneSha256 = sha256Buffer(Buffer.from(backboneText, "utf8"));

  const tempSuffix = `.tmp-${process.pid}`;
  const tokenTempPath = `${options.tokenOutputPath}${tempSuffix}`;
  const alignmentTempPath = `${options.alignmentOutputPath}${tempSuffix}`;
  const tokenIndexPath = indexPathFor(options.tokenOutputPath);
  const alignmentIndexPath = indexPathFor(options.alignmentOutputPath);
  const tokenIndexTempPath = `${tokenIndexPath}${tempSuffix}`;
  const alignmentIndexTempPath = `${alignmentIndexPath}${tempSuffix}`;

  let tokenWriter: JsonlArtifactWriter | null = null;
  let alignmentWriter: JsonlArtifactWriter | null = null;
  const cleanupTemps = (): void => {
    tokenWriter?.abort();
    alignmentWriter?.abort();
    rmSync(tokenTempPath, { force: true });
    rmSync(alignmentTempPath, { force: true });
    rmSync(tokenIndexTempPath, { force: true });
    rmSync(alignmentIndexTempPath, { force: true });
  };

  try {
    const headerResult = await readColumnIndexes(options.inputPath, diagnostics);
    if (headerResult === null) {
      cleanupTemps();
      return { ok: false, diagnostics: diagnostics.finish() };
    }

    tokenWriter = new JsonlArtifactWriter(
      tokenTempPath,
      TOKEN_ARTIFACT_TYPE,
      sourceTsvSha256,
    );
    alignmentWriter = new JsonlArtifactWriter(
      alignmentTempPath,
      ALIGNMENT_ARTIFACT_TYPE,
      sourceTsvSha256,
    );

    tokenWriter.writeMeta(
      makeTokenMeta(sourceTsvSha256, backboneSha256, backbone.version),
    );
    alignmentWriter.writeMeta(
      makeAlignmentMeta(
        sourceTsvSha256,
        backboneSha256,
        backbone.version,
        bsbTextDigest,
      ),
    );

    const bookOrder = new Map(
      Object.keys(backbone.books).map((book, position) => [book, position]),
    );
    const textReader = new BsbTextReader(options.bsbTextRoot);
    let currentGroup: VerseGroup | null = null;
    let lastReferenceOrder = -1;
    const seenReferences = new Set<string>();
    let dataRows = 0;
    let verses = 0;
    let sourceSlots = 0;
    let alignedWords = 0;
    let uncoveredFragments = 0;

    const flush = (): void => {
      if (currentGroup === null) return;
      const before = diagnostics.items.length;
      const output = processVerse(
        currentGroup,
        textReader,
        diagnostics,
      );
      if (output !== null && diagnostics.items.length === before) {
        tokenWriter?.writeVerse(currentGroup.ref.bref, output.tokenRecord);
        alignmentWriter?.writeVerse(currentGroup.ref.bref, output.alignmentRecord);
        verses += 1;
        sourceSlots += output.sourceSlots;
        alignedWords += output.alignedWords;
        uncoveredFragments += output.uncoveredFragments;
      }
      currentGroup = null;
    };

    const input = createReadStream(options.inputPath, { encoding: "utf8" });
    const lines = createInterface({ input, crlfDelay: Infinity });
    let lineNumber = 0;
    for await (const line of lines) {
      lineNumber += 1;
      if (lineNumber === 1 || line.length === 0) continue;
      dataRows += 1;
      const cells = line.split("\t");
      const verseId = cell(cells, headerResult.verseId).trim();
      if (verseId.length > 0) {
        flush();
        const parsedRef = parseVerseId(verseId);
        if (parsedRef === null) {
          diagnostics.add({
            code: "invalid-verse-id",
            line: lineNumber,
            message: `Cannot parse VerseId ${JSON.stringify(verseId)}`,
          });
          currentGroup = null;
        } else if (!backboneContains(backbone, parsedRef)) {
          diagnostics.add({
            code: "invalid-reference",
            line: lineNumber,
            ref: parsedRef.bref,
            message: `${parsedRef.bref} is outside backbone ${backbone.version}`,
          });
          currentGroup = null;
        } else {
          const order = referenceOrder(parsedRef, backbone, bookOrder);
          if (seenReferences.has(parsedRef.bref)) {
            diagnostics.add({
              code: "duplicate-reference",
              line: lineNumber,
              ref: parsedRef.bref,
              message: `Reference ${parsedRef.bref} appears more than once`,
            });
          }
          if (order <= lastReferenceOrder) {
            diagnostics.add({
              code: "out-of-order-reference",
              line: lineNumber,
              ref: parsedRef.bref,
              message: `${parsedRef.bref} is not in strictly increasing backbone order`,
            });
          }
          seenReferences.add(parsedRef.bref);
          lastReferenceOrder = order;
          currentGroup = { ref: parsedRef, rows: [] };
        }
      }

      const row = tableRow(cells, headerResult, lineNumber);
      if (currentGroup === null) {
        if (rowHasPayload(row)) {
          diagnostics.add({
            code: "row-without-reference",
            line: lineNumber,
            message: "Row payload has no valid current VerseId",
          });
        }
      } else {
        currentGroup.rows.push(row);
      }
    }
    flush();

    if (diagnostics.items.length > 0) {
      cleanupTemps();
      return { ok: false, diagnostics: diagnostics.finish() };
    }

    const tokenFinal = tokenWriter.finalize();
    const alignmentFinal = alignmentWriter.finalize();
    tokenWriter = null;
    alignmentWriter = null;

    writeIndexTemp(tokenIndexTempPath, tokenFinal.index);
    writeIndexTemp(alignmentIndexTempPath, alignmentFinal.index);

    mkdirSync(dirname(options.tokenOutputPath), { recursive: true });
    mkdirSync(dirname(options.alignmentOutputPath), { recursive: true });
    renameSync(tokenTempPath, options.tokenOutputPath);
    renameSync(alignmentTempPath, options.alignmentOutputPath);
    renameSync(tokenIndexTempPath, tokenIndexPath);
    renameSync(alignmentIndexTempPath, alignmentIndexPath);

    return {
      ok: true,
      stats: {
        dataRows,
        verses,
        sourceSlots,
        alignedWords,
        uncoveredFragments,
        sourceTsvSha256,
        backboneSha256,
        bsbTextSha256: bsbTextDigest.sha256,
        tokenArtifact: {
          path: options.tokenOutputPath,
          indexPath: tokenIndexPath,
          bytes: tokenFinal.bytes,
          sha256: tokenFinal.sha256,
        },
        alignmentArtifact: {
          path: options.alignmentOutputPath,
          indexPath: alignmentIndexPath,
          bytes: alignmentFinal.bytes,
          sha256: alignmentFinal.sha256,
        },
      },
    };
  } catch (error: unknown) {
    cleanupTemps();
    throw error;
  }
}

function processVerse(
  group: VerseGroup,
  textReader: BsbTextReader,
  diagnostics: DiagnosticCollector,
): VerseOutput | null {
  const localStart = diagnostics.items.length;
  const sourceRows: Array<{
    row: TableRow;
    language: SourceLanguage;
    sourceSort: number;
  }> = [];
  const sourceSortLines = new Map<number, number>();

  for (const row of group.rows) {
    if (row.sourceSurface.length === 0) continue;
    const language = sourceLanguage(row.languageRaw);
    if (language === null) {
      diagnostics.add({
        code: "unknown-source-language",
        line: row.line,
        ref: group.ref.bref,
        message: `Unknown language ${JSON.stringify(row.languageRaw)} on source row`,
      });
      continue;
    }
    const rawSort = language === "Greek" ? row.greekSortRaw : row.hebSortRaw;
    const sourceSort = parseSort(rawSort);
    if (sourceSort === null) {
      diagnostics.add({
        code: "invalid-source-sort",
        line: row.line,
        ref: group.ref.bref,
        message: `Invalid ${language === "Greek" ? "Greek Sort" : "Heb Sort"} ${JSON.stringify(rawSort)}`,
      });
      continue;
    }
    const priorLine = sourceSortLines.get(sourceSort);
    if (priorLine !== undefined) {
      diagnostics.add({
        code: "duplicate-source-sort",
        line: row.line,
        ref: group.ref.bref,
        message: `Source sort ${sourceSort} repeats lines ${priorLine} and ${row.line}`,
      });
      continue;
    }
    sourceSortLines.set(sourceSort, row.line);
    sourceRows.push({ row, language, sourceSort });
  }

  sourceRows.sort((left, right) => left.sourceSort - right.sourceSort);
  const positionsByLine = new Map<number, number>();
  const tokens: SourceSlot[] = sourceRows.map((entry, index) => {
    const position = index + 1;
    positionsByLine.set(entry.row.line, position);
    const strong = strongFor(entry.row, entry.language);
    const editionSurface = entry.row.editionSurface.trim();
    return {
      position,
      source_sort: entry.sourceSort,
      language: entry.language,
      surface: entry.row.sourceSurface,
      ...(editionSurface.length > 0 && editionSurface !== entry.row.sourceSurface
        ? { edition_surface: editionSurface }
        : {}),
      ...(strong === null ? {} : { strong }),
    };
  });

  const displayGroups: DisplayGroup[] = [];
  const bsbSortLines = new Map<number, number>();
  let detachedPostscript = false;
  for (const row of group.rows) {
    if (isDetachedPostscriptStart(row.headingRaw)) {
      detachedPostscript = true;
    }
    // The one detached postscript in the table (Habakkuk 3:19) is original-
    // language source content, so it remains in the source-slot inventory.
    // The BSB package text intentionally omits its display heading; therefore
    // it has no target fragment rather than a fabricated offset.
    if (detachedPostscript) continue;
    const target = normalizeDisplay(row.displayRaw);
    if (target.length === 0) continue;
    const bsbSort = parseSort(row.bsbSortRaw);
    if (bsbSort === null) {
      diagnostics.add({
        code: "invalid-bsb-sort",
        line: row.line,
        ref: group.ref.bref,
        message: `Invalid BSB Sort ${JSON.stringify(row.bsbSortRaw)}`,
      });
      continue;
    }
    const priorLine = bsbSortLines.get(bsbSort);
    if (priorLine !== undefined) {
      diagnostics.add({
        code: "duplicate-bsb-sort",
        line: row.line,
        ref: group.ref.bref,
        message: `BSB sort ${bsbSort} repeats lines ${priorLine} and ${row.line}`,
      });
      continue;
    }
    bsbSortLines.set(bsbSort, row.line);
    const position = positionsByLine.get(row.line);
    displayGroups.push({
      bsbSort,
      target,
      occurrencePositions: position === undefined ? [] : [position],
      line: row.line,
    });
  }
  displayGroups.sort((left, right) => left.bsbSort - right.bsbSort);

  const targetText = textReader.get(group.ref, diagnostics);
  if (targetText === null || diagnostics.items.length > localStart) return null;

  if (targetText.state === "absent") {
    if (tokens.length > 0 || displayGroups.length > 0) {
      diagnostics.add({
        code: "missing-bsb-text",
        ref: group.ref.bref,
        message: `${group.ref.bref} has source/display payload but no verse in the BSB package text`,
      });
      return null;
    }
    return {
      tokenRecord: {
        type: "backbone-token-verse",
        format_version: 1,
        layer: LAYER,
        ref: group.ref.bref,
        tokens,
      },
      alignmentRecord: {
        type: "occurrence-alignment-verse",
        format_version: 1,
        layer: LAYER,
        package_id: "bsb",
        ref: group.ref.bref,
        target_state: "absent",
        fragments: [],
      },
      sourceSlots: 0,
      alignedWords: 0,
      uncoveredFragments: 0,
    };
  }

  const text = targetText.text;

  const fragments = alignDisplayGroups(
    text,
    displayGroups,
    group.ref.bref,
    diagnostics,
  );
  if (fragments === null || diagnostics.items.length > localStart) return null;

  return {
    tokenRecord: {
      type: "backbone-token-verse",
      format_version: 1,
      layer: LAYER,
      ref: group.ref.bref,
      tokens,
    },
    alignmentRecord: {
      type: "occurrence-alignment-verse",
      format_version: 1,
      layer: LAYER,
      package_id: "bsb",
      ref: group.ref.bref,
      target_state: "present",
      text_sha256: sha256Buffer(Buffer.from(text, "utf8")),
      text_utf16_length: text.length,
      fragments,
    },
    sourceSlots: tokens.length,
    alignedWords: fragments.filter(
      (fragment) => fragment[2].length > 0,
    ).length,
    uncoveredFragments: fragments.filter(
      (fragment) => fragment[2].length === 0,
    ).length,
  };
}

function alignDisplayGroups(
  text: string,
  groups: DisplayGroup[],
  ref: string,
  diagnostics: DiagnosticCollector,
): AlignmentFragment[] | null {
  const fragments: AlignmentFragment[] = [];
  let cursor = 0;

  const addGap = (start: number, end: number): void => {
    if (end <= start) return;
    fragments.push([start, end, []]);
  };

  for (const group of groups) {
    const start = text.indexOf(group.target, cursor);
    if (start === -1) {
      diagnostics.add({
        code: "target-text-not-found",
        line: group.line,
        ref,
        message: `BSB row ${group.bsbSort} target ${JSON.stringify(group.target)} was not found at or after UTF-16 offset ${cursor}`,
      });
      return null;
    }
    addGap(cursor, start);

    const end = start + group.target.length;
    const wordPattern = /\S+/gu;
    let wordMatch: RegExpExecArray | null;
    let localCursor = 0;
    while ((wordMatch = wordPattern.exec(group.target)) !== null) {
      const word = wordMatch[0];
      const localStart = wordMatch.index;
      const wordStart = start + localStart;
      addGap(start + localCursor, wordStart);
      const wordEnd = wordStart + word.length;
      fragments.push([
        wordStart,
        wordEnd,
        [...group.occurrencePositions].sort(
          (left, right) => left - right,
        ),
        group.bsbSort,
      ]);
      localCursor = localStart + word.length;
    }
    addGap(start + localCursor, end);
    cursor = end;
  }

  addGap(cursor, text.length);
  return coalesceUngroupedGaps(fragments);
}

function coalesceUngroupedGaps(
  fragments: AlignmentFragment[],
): AlignmentFragment[] {
  const output: AlignmentFragment[] = [];
  for (const fragment of fragments) {
    const previous = output[output.length - 1];
    if (
      previous !== undefined &&
      previous[3] === undefined &&
      fragment[3] === undefined &&
      previous[2].length === 0 &&
      fragment[2].length === 0 &&
      previous[1] === fragment[0]
    ) {
      previous[1] = fragment[1];
    } else {
      output.push(fragment);
    }
  }
  return output;
}

function makeTokenMeta(
  sourceTsvSha256: string,
  backboneSha256: string,
  backboneVersion: string,
): Record<string, unknown> {
  return {
    type: "backbone-token-meta",
    format_version: 1,
    layer: LAYER,
    inventory_semantics: "frozen-edition-inclusive-bsb-table-source-slots",
    position_unit: "1-based-source-slot-within-verse",
    position_basis:
      "non-empty original-language rows sorted by Heb Sort for Hebrew/Aramaic or Greek Sort for Greek",
    cross_corpus_position_equivalence: "none",
    not_equivalent_to: ["MACULA", "OSHB"],
    surface_columns: {
      base: BSB_TABLE_COLUMNS.sourceSurface,
      edition_marked: BSB_TABLE_COLUMNS.editionSurface,
    },
    inputs: {
      bsb_tables_tsv: {
        basename: "bsb_tables.tsv",
        sha256: sourceTsvSha256,
      },
      backbone: {
        version: backboneVersion,
        sha256: backboneSha256,
      },
    },
  };
}

function makeAlignmentMeta(
  sourceTsvSha256: string,
  backboneSha256: string,
  backboneVersion: string,
  bsbTextDigest: { sha256: string; fileCount: number },
): Record<string, unknown> {
  return {
    type: "occurrence-alignment-meta",
    format_version: 1,
    layer: LAYER,
    package_id: "bsb",
    source_inventory_semantics:
      "frozen-edition-inclusive-bsb-table-source-slots",
    cross_corpus_position_equivalence: "none",
    target_offset_unit: "utf16-code-unit",
    target_fragment_unit: "whitespace-delimited-word-within-authored-bsb-row",
    fragment_group: "BSB Sort",
    fragment_tuple: {
      shape:
        "[char_start,char_end,occurrence_positions,optional_bsb_sort_group]",
      index_0: "inclusive UTF-16 char_start",
      index_1: "exclusive UTF-16 char_end",
      index_2:
        "sorted unique 1-based backbone-token:v1 occurrence positions; empty means uncovered",
      index_3:
        "optional BSB Sort row identity; present on authored display words and omitted on ungrouped gaps",
      quote_derivation:
        "SHA-bound package_text.slice(char_start,char_end); quote is not duplicated in this artifact",
    },
    gap_policy:
      "whitespace, punctuation, and display-only or otherwise uncovered text is retained with an empty occurrence list",
    absent_target_policy:
      "backbone verses absent from the BSB package emit target_state=absent with no text digest or fragments",
    detached_postscript_policy:
      "source slots remain canonical; table display beginning at an Hdg pshdg-only row absent from package text emits no target fragment",
    inputs: {
      bsb_tables_tsv: {
        basename: "bsb_tables.tsv",
        sha256: sourceTsvSha256,
      },
      backbone: {
        version: backboneVersion,
        sha256: backboneSha256,
      },
      bsb_text: {
        sha256: bsbTextDigest.sha256,
        file_count: bsbTextDigest.fileCount,
        digest_algorithm:
          "sha256(sorted relative-json-path + NUL + file-sha256 + LF)",
      },
    },
  };
}

async function readColumnIndexes(
  inputPath: string,
  diagnostics: DiagnosticCollector,
): Promise<ColumnIndexes | null> {
  const input = createReadStream(inputPath, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  let header: string | null = null;
  for await (const line of lines) {
    header = line;
    lines.close();
    input.destroy();
    break;
  }
  if (header === null) {
    diagnostics.add({ code: "empty-input", message: "Input TSV is empty" });
    return null;
  }

  const names = header.split("\t").map((name, index) =>
    normalizeHeader(index === 0 ? name.replace(/^\uFEFF/u, "") : name),
  );
  const locations = new Map<string, number[]>();
  names.forEach((name, index) => {
    const found = locations.get(name) ?? [];
    found.push(index);
    locations.set(name, found);
  });

  const resolved: Partial<ColumnIndexes> = {};
  for (const [key, expected] of Object.entries(BSB_TABLE_COLUMNS) as Array<
    [keyof ColumnIndexes, string]
  >) {
    const found = locations.get(normalizeHeader(expected)) ?? [];
    if (found.length === 0) {
      diagnostics.add({
        code: "missing-column",
        message: `Required TSV column ${JSON.stringify(expected)} is missing`,
      });
    } else if (found.length > 1) {
      diagnostics.add({
        code: "duplicate-required-column",
        message: `Required TSV column ${JSON.stringify(expected)} appears ${found.length} times`,
      });
    } else {
      resolved[key] = found[0];
    }
  }

  if (diagnostics.items.length > 0) return null;
  return resolved as ColumnIndexes;
}

function tableRow(
  cells: string[],
  columns: ColumnIndexes,
  line: number,
): TableRow {
  return {
    line,
    languageRaw: cell(cells, columns.language).trim(),
    hebSortRaw: cell(cells, columns.hebSort).trim(),
    greekSortRaw: cell(cells, columns.greekSort).trim(),
    bsbSortRaw: cell(cells, columns.bsbSort).trim(),
    sourceSurface: cell(cells, columns.sourceSurface).trim(),
    editionSurface: cell(cells, columns.editionSurface).trim(),
    strongHebrewRaw: cell(cells, columns.strongHebrew).trim(),
    strongGreekRaw: cell(cells, columns.strongGreek).trim(),
    headingRaw: cell(cells, columns.heading).trim(),
    displayRaw: cell(cells, columns.bsbDisplay),
  };
}

function rowHasPayload(row: TableRow): boolean {
  return (
    row.sourceSurface.length > 0 || normalizeDisplay(row.displayRaw).length > 0
  );
}

function cell(cells: string[], index: number): string {
  return cells[index] ?? "";
}

function normalizeHeader(name: string): string {
  return name.trim().replace(/\s+/gu, " ");
}

function normalizeDisplay(raw: string): string {
  const withoutTags = raw.replace(/<[^>]*>/gu, " ");
  // BSB tables use [] in the NT and {} in the OT for supplied display words.
  // The words are present in the package text; only the editorial delimiters
  // are absent. Keeping the words on their authored row is not an inferred
  // source correspondence.
  const withoutEditorialBrackets = withoutTags.replace(/[\[\]{}]/gu, "");
  const decoded = decodeHtmlEntities(withoutEditorialBrackets);
  const normalized = decoded.replace(/\s+/gu, " ").trim();
  const placeholderProbe = normalized.replace(/[()]/gu, "").trim();
  return /^(?:[-–—]+|(?:\.\s*){2,}|v{3})$/iu.test(placeholderProbe)
    ? ""
    : normalized;
}

function isDetachedPostscriptStart(rawHeading: string): boolean {
  return /^<p\s+class=\|pshdg\|>$/iu.test(rawHeading.trim());
}

function decodeHtmlEntities(value: string): string {
  return value.replace(
    /&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/giu,
    (entity, decimal: string | undefined, hexadecimal: string | undefined, named: string | undefined) => {
      if (decimal !== undefined) {
        const point = Number.parseInt(decimal, 10);
        return Number.isSafeInteger(point) ? String.fromCodePoint(point) : entity;
      }
      if (hexadecimal !== undefined) {
        const point = Number.parseInt(hexadecimal, 16);
        return Number.isSafeInteger(point) ? String.fromCodePoint(point) : entity;
      }
      const names: Readonly<Record<string, string>> = {
        amp: "&",
        apos: "'",
        gt: ">",
        lt: "<",
        nbsp: " ",
        quot: '"',
      };
      return named === undefined ? entity : (names[named.toLowerCase()] ?? entity);
    },
  );
}

function parseSort(raw: string): number | null {
  if (!/^\d+(?:\.\d+)?$/u.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 && parsed !== 999999
    ? parsed
    : null;
}

function writeAllSync(fd: number, buffer: Buffer): void {
  let offset = 0;
  while (offset < buffer.byteLength) {
    offset += writeSync(fd, buffer, offset, buffer.byteLength - offset);
  }
}

function sourceLanguage(raw: string): SourceLanguage | null {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "hebrew") return "Hebrew";
  if (normalized === "aramaic") return "Aramaic";
  if (normalized === "greek") return "Greek";
  return null;
}

function strongFor(row: TableRow, language: SourceLanguage): string | null {
  const raw = language === "Greek" ? row.strongGreekRaw : row.strongHebrewRaw;
  if (!/^\d+$/u.test(raw)) return null;
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value <= 0) return null;
  return `${language === "Greek" ? "G" : "H"}${value}`;
}

function parseVerseId(value: string): ParsedRef | null {
  const match = value.trim().match(/^(.+?)\s+(\d+):(\d+)$/u);
  if (match === null) return null;
  const book = BOOK_NAME_TO_USFM[match[1]?.trim() ?? ""];
  const chapter = Number.parseInt(match[2] ?? "", 10);
  const verse = Number.parseInt(match[3] ?? "", 10);
  if (
    book === undefined ||
    !Number.isSafeInteger(chapter) ||
    chapter <= 0 ||
    !Number.isSafeInteger(verse) ||
    verse <= 0
  ) {
    return null;
  }
  return { book, chapter, verse, bref: `bref:v1/${book}.${chapter}.${verse}` };
}

function backboneContains(backbone: Backbone, ref: ParsedRef): boolean {
  const book = backbone.books[ref.book];
  const verseCount = book?.chapters[ref.chapter - 1];
  return verseCount !== undefined && ref.verse <= verseCount;
}

function referenceOrder(
  ref: ParsedRef,
  backbone: Backbone,
  bookOrder: ReadonlyMap<string, number>,
): number {
  let order = (bookOrder.get(ref.book) ?? 0) * 1_000_000;
  const chapters = backbone.books[ref.book]?.chapters ?? [];
  for (let chapter = 0; chapter < ref.chapter - 1; chapter += 1) {
    order += chapters[chapter] ?? 0;
  }
  return order + ref.verse;
}

function parseBackbone(text: string): Backbone | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(raw) || typeof raw.version !== "string" || !isRecord(raw.books)) {
    return null;
  }
  const books: Record<string, BackboneBook> = {};
  for (const [book, value] of Object.entries(raw.books)) {
    if (!isRecord(value) || !Array.isArray(value.chapters)) return null;
    const chapters: number[] = [];
    for (const count of value.chapters) {
      if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
        return null;
      }
      chapters.push(count);
    }
    books[book] = { chapters };
  }
  return { version: raw.version, books };
}

function parseBsbChapter(text: string): Map<number, string> | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(raw) || !Array.isArray(raw.verses)) return null;
  const verses = new Map<number, string>();
  for (const entry of raw.verses) {
    if (
      !isRecord(entry) ||
      typeof entry.verse !== "number" ||
      !Number.isInteger(entry.verse) ||
      typeof entry.text !== "string" ||
      verses.has(entry.verse)
    ) {
      return null;
    }
    verses.set(entry.verse, entry.text);
  }
  return verses;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(path);
  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

function sha256Buffer(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function sha256JsonDirectory(
  root: string,
): Promise<{ sha256: string; fileCount: number }> {
  const paths = listJsonFiles(root).sort((left, right) =>
    left.localeCompare(right, "en"),
  );
  const digest = createHash("sha256");
  for (const path of paths) {
    const relativePath = relative(root, path).split(sep).join("/");
    const fileSha256 = await sha256File(path);
    digest.update(relativePath, "utf8");
    digest.update("\0", "utf8");
    digest.update(fileSha256, "utf8");
    digest.update("\n", "utf8");
  }
  return { sha256: digest.digest("hex"), fileCount: paths.length };
}

function listJsonFiles(root: string): string[] {
  const output: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      output.push(...listJsonFiles(path));
    } else if (stat.isFile() && path.endsWith(".json")) {
      output.push(path);
    }
  }
  return output;
}

function writeIndexTemp(path: string, index: JsonlIndex): void {
  mkdirSync(dirname(path), { recursive: true });
  rmSync(path, { force: true });
  writeFileSync(path, `${JSON.stringify(index)}\n`, { encoding: "utf8", flag: "wx" });
}

function parseCliInput(argv: string[]): string | null {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    return null;
  }
  if (argv.length !== 2 || argv[0] !== "--input" || argv[1]?.length === 0) {
    return null;
  }
  return argv[1] ?? null;
}

async function main(): Promise<void> {
  const input = parseCliInput(process.argv.slice(2));
  if (input === null) {
    console.error(
      `Usage: node --import tsx ${basename(fileURLToPath(import.meta.url))} --input <bsb_tables.tsv>`,
    );
    process.exitCode = 2;
    return;
  }

  const result = await buildBackboneTokenV1(defaultBuildOptions(input));
  if (!result.ok) {
    for (const diagnostic of result.diagnostics) {
      const location = [diagnostic.ref, diagnostic.line === undefined ? null : `line ${diagnostic.line}`]
        .filter((part): part is string => part !== null)
        .join(" ");
      console.error(
        `${diagnostic.code}${location.length > 0 ? ` (${location})` : ""}: ${diagnostic.message}`,
      );
    }
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify(result.stats, null, 2));
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
if (invokedPath === import.meta.url) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
