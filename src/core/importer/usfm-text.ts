export interface UsfmVerseText {
  verse: number;
  text: string;
}

export type UsfmHeadingKind = "section" | "major-section" | "description" | "speaker" | "acrostic";

export interface UsfmHeading {
  /** The first canonical verse governed by this noncanonical display heading. */
  beforeVerse: number;
  kind: UsfmHeadingKind;
  level: number;
  text: string;
}

export interface UsfmTextChapter {
  verses: UsfmVerseText[];
  headings: UsfmHeading[];
}

export interface UsfmTextParseResult {
  chapters: Map<number, UsfmTextChapter>;
  structuralLinesDropped: number;
}

const HEADING_MARKER = /^(s(\d*)|ms(\d*)|d|sp|qa)$/i;

// These markers carry publication structure or study metadata, not canonical
// verse prose. Paragraph/poetry/list markers are intentionally absent because
// their following text may continue the current verse.
const NONVERSE_LINE_MARKER = /^(?:id|usfm|ide|h|toc\d*|mt\d*|mte\d*|imt\d*|imte\d*|is\d*|ip|ipi|im|imi|ipq|imq|ipr|iq\d*|ib|ili\d*|iot|io\d*|iex|s\d*|ms\d*|mr|sr|r|d|sp|qa|cl|cd|rem|periph|sts|restore)$/i;

function leadingMarker(line: string): { marker: string; payload: string } | null {
  const match = /^\s*\\([a-zA-Z]+\d*)\s*([^\n]*)$/.exec(line);
  if (!match) return null;
  return { marker: match[1]!, payload: match[2] ?? "" };
}

function headingMetadata(marker: string): { kind: UsfmHeadingKind; level: number } | null {
  const match = HEADING_MARKER.exec(marker);
  if (!match) return null;
  const lower = marker.toLowerCase();
  if (lower.startsWith("ms")) {
    return { kind: "major-section", level: Number.parseInt(match[3] || "1", 10) };
  }
  if (lower.startsWith("s")) {
    return { kind: "section", level: Number.parseInt(match[2] || "1", 10) };
  }
  if (lower === "d") return { kind: "description", level: 1 };
  if (lower === "sp") return { kind: "speaker", level: 1 };
  return { kind: "acrostic", level: 1 };
}

/**
 * Reduce a USFM fragment to plain reading text. Structural line payloads must
 * be removed before this function is called; otherwise a marker such as
 * `\\s2 The First Day` would lose only `\\s2` and leak its title into a verse.
 */
export function stripUsfmInlineMarkup(raw: string): string {
  let text = raw;
  text = text.replace(/\\f\s+[\s\S]*?\\f\*/g, "");
  text = text.replace(/\\x\s+[\s\S]*?\\x\*/g, "");
  text = text.replace(/\\ref\s+[\s\S]*?\\ref\*/g, "");
  text = text.replace(/\\[a-zA-Z]+\d*\s*\*/g, "");
  text = text.replace(/\\[a-zA-Z]+\d*\s+/g, "");
  text = text.replace(/\\[a-zA-Z]+\d*/g, "");
  text = text.replace(/\\[^\s]*/g, "");
  text = text.replace(/<[^>]+>/g, "");
  return text.replace(/\s+/g, " ").trim();
}

function collectHeadings(lines: string[], chapterAtLine: number[]): Map<number, UsfmHeading[]> {
  const headings = new Map<number, UsfmHeading[]>();
  let nextVerse: { chapter: number; verse: number } | null = null;

  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index]!;
    const verse = /\\v\s+(\d+)\b/.exec(line);
    if (verse) {
      nextVerse = {
        chapter: chapterAtLine[index] ?? 0,
        verse: Number.parseInt(verse[1]!, 10),
      };
    }

    const structural = leadingMarker(line);
    if (!structural || !nextVerse) continue;
    // Some versifications number Psalm superscriptions and similar material
    // on a descriptive (`\\d`) line. An explicit `\\v` always wins: that
    // payload is canonical verse text, not a publication heading.
    if (/\\v\s+\d+\b/.test(structural.payload)) continue;
    const metadata = headingMetadata(structural.marker);
    if (!metadata) continue;
    const text = stripUsfmInlineMarkup(structural.payload);
    if (!text || nextVerse.chapter < 1) continue;
    const chapterHeadings = headings.get(nextVerse.chapter) ?? [];
    chapterHeadings.unshift({ beforeVerse: nextVerse.verse, ...metadata, text });
    headings.set(nextVerse.chapter, chapterHeadings);
  }

  return headings;
}

/**
 * Parse canonical verse text from USFM while preserving publication headings
 * as separate, explicitly noncanonical structure.
 */
export function parseUsfmText(content: string): UsfmTextParseResult {
  const normalized = content.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const chapterAtLine: number[] = [];
  let currentChapter = 0;

  for (let index = 0; index < lines.length; index++) {
    const chapter = /\\c\s+(\d+)\b/.exec(lines[index]!);
    if (chapter) currentChapter = Number.parseInt(chapter[1]!, 10);
    chapterAtLine[index] = currentChapter;
  }

  const headings = collectHeadings(lines, chapterAtLine);
  let structuralLinesDropped = 0;
  const verseOnly = lines.map((line) => {
    const structural = leadingMarker(line);
    const marker = structural?.marker;
    if (!marker || !NONVERSE_LINE_MARKER.test(marker)) return line;
    if (/\\v\s+\d+\b/.test(structural.payload)) return line;
    structuralLinesDropped += 1;
    return "";
  }).join("\n");

  const chapterVerses = new Map<number, UsfmVerseText[]>();
  const markers: Array<{ kind: "c" | "v"; number: number; start: number; end: number }> = [];
  const markerPattern = /\\c\s+(\d+)|\\v\s+(\d+)\s+/g;
  let match: RegExpExecArray | null;
  while ((match = markerPattern.exec(verseOnly))) {
    if (match[1]) {
      markers.push({ kind: "c", number: Number.parseInt(match[1], 10), start: match.index, end: markerPattern.lastIndex });
    } else if (match[2]) {
      markers.push({ kind: "v", number: Number.parseInt(match[2], 10), start: match.index, end: markerPattern.lastIndex });
    }
  }

  currentChapter = 0;
  for (let index = 0; index < markers.length; index++) {
    const marker = markers[index]!;
    if (marker.kind === "c") {
      currentChapter = marker.number;
      if (!chapterVerses.has(currentChapter)) chapterVerses.set(currentChapter, []);
      continue;
    }
    if (currentChapter < 1) continue;
    const end = index + 1 < markers.length ? markers[index + 1]!.start : verseOnly.length;
    const text = stripUsfmInlineMarkup(verseOnly.slice(marker.end, end));
    if (!text) continue;
    const verses = chapterVerses.get(currentChapter) ?? [];
    const existing = verses.find((verse) => verse.verse === marker.number);
    if (existing) existing.text = `${existing.text} ${text}`.trim();
    else verses.push({ verse: marker.number, text });
    chapterVerses.set(currentChapter, verses);
  }

  const chapters = new Map<number, UsfmTextChapter>();
  for (const [chapter, verses] of chapterVerses) {
    verses.sort((a, b) => a.verse - b.verse);
    chapters.set(chapter, { verses, headings: headings.get(chapter) ?? [] });
  }

  return { chapters, structuralLinesDropped };
}
