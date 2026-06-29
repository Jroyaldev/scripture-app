/**
 * Living Margin — deterministic resurfacing (M2).
 * Assembles notes, highlights, and public-domain cross-references for a passage.
 * Pure, platform-agnostic (INV-18). Data access injected.
 */

import type { BookCode, BookNameMap, CanonicalRef } from "../reference/types.js";
import { isValidBookCode } from "../reference/backbone.js";
import { toBref, toDisplayString } from "../reference/parser.js";
import type {
  CrossRefData,
  MarginBacklink,
  MarginCrossRef,
  MarginHighlight,
  MarginNote,
  MarginQuery,
  MarginResult,
} from "./types.js";

export type { CrossRefData, MarginItem, MarginQuery, MarginResult } from "./types.js";

export type AnchorRow = {
  id: string;
  src_kind: string;
  src_id: string;
  book: string;
  start_ch: number;
  start_v: number;
  end_ch: number;
  end_v: number;
  provenance: string;
};

export type NoteRow = {
  id: string;
  title: string;
  body_text: string;
};

export type HighlightRow = {
  id: string;
  book: string;
  chapter: number;
  verse_start: number;
  verse_end: number;
  color: string;
};

export type EdgeRow = {
  src_id: string;
  dst_id: string;
  kind: string;
};

/**
 * Injected data access interface for the margin query.
 */
export interface MarginDataAccess {
  queryAnchorsForRange(
    book: string,
    startCh: number,
    startV: number,
    endCh: number,
    endV: number,
  ): AnchorRow[];
  queryHighlightsForRange(
    book: string,
    startCh: number,
    startV: number,
    endCh: number,
    endV: number,
  ): HighlightRow[];
  queryNoteById(id: string): NoteRow | undefined;
  queryEdgesByTarget(targetId: string): EdgeRow[];
}

/**
 * Assemble the Living Margin for a given passage.
 * Deterministic only: no AI, no embeddings.
 */
export function assembleMargin(
  query: MarginQuery,
  dataAccess: MarginDataAccess,
  crossRefData: CrossRefData | null,
  bookNames: BookNameMap,
): MarginResult {
  const notes: MarginNote[] = [];
  const highlights: MarginHighlight[] = [];
  const crossRefs: MarginCrossRef[] = [];
  const backlinks: MarginBacklink[] = [];

  // 1. Notes anchored to or overlapping the range
  const anchors = dataAccess.queryAnchorsForRange(
    query.book,
    query.startChapter,
    query.startVerse,
    query.endChapter,
    query.endVerse,
  );

  const seenNoteIds = new Set<string>();
  for (const anchor of anchors) {
    if (anchor.src_kind === "note" && !seenNoteIds.has(anchor.src_id)) {
      seenNoteIds.add(anchor.src_id);
      const note = dataAccess.queryNoteById(anchor.src_id);
      if (note) {
        notes.push({
          kind: "note",
          provenance: "user",
          noteId: note.id,
          title: note.title,
          snippet: truncateSnippet(note.body_text, 120),
        });
      }
    }
  }

  // 2. Highlights on the range
  const hlRows = dataAccess.queryHighlightsForRange(
    query.book,
    query.startChapter,
    query.startVerse,
    query.endChapter,
    query.endVerse,
  );
  for (const hl of hlRows) {
    highlights.push({
      kind: "highlight",
      provenance: "user",
      highlightId: hl.id,
      color: hl.color,
      verseStart: hl.verse_start,
      verseEnd: hl.verse_end,
    });
  }

  // 3. Public-domain cross-references (TSK)
  if (crossRefData) {
    const xrefs = gatherCrossRefs(query, crossRefData, bookNames);
    crossRefs.push(...xrefs);
  }

  // 4. Backlinks (notes that link TO notes in this range)
  for (const noteId of seenNoteIds) {
    const edges = dataAccess.queryEdgesByTarget(`note:${noteId}`);
    for (const edge of edges) {
      const srcNoteId = edge.src_id.replace(/^note:/, "");
      if (!seenNoteIds.has(srcNoteId)) {
        const srcNote = dataAccess.queryNoteById(srcNoteId);
        if (srcNote) {
          backlinks.push({
            kind: "backlink",
            provenance: "user",
            noteId: srcNote.id,
            title: srcNote.title,
            snippet: truncateSnippet(srcNote.body_text, 120),
          });
        }
      }
    }
  }

  return { notes, highlights, crossRefs, backlinks };
}

/**
 * Gather cross-references from TSK data for a given passage range.
 */
function gatherCrossRefs(
  query: MarginQuery,
  crossRefData: CrossRefData,
  bookNames: BookNameMap,
): MarginCrossRef[] {
  const results: MarginCrossRef[] = [];
  const seen = new Set<string>();

  for (let ch = query.startChapter; ch <= query.endChapter; ch++) {
    const vStart = ch === query.startChapter ? query.startVerse : 1;
    const vEnd = ch === query.endChapter ? query.endVerse : 200;

    for (let v = vStart; v <= vEnd; v++) {
      const key = `${query.book}.${ch}.${v}`;
      const refs = crossRefData.refs[key];
      if (!refs) continue;

      for (const targetKey of refs) {
        if (seen.has(targetKey)) continue;
        seen.add(targetKey);

        const parsed = parseCrossRefTarget(targetKey);
        if (!parsed) continue;
        if (!isValidBookCode(parsed.book)) continue;

        const bookCode = parsed.book as BookCode;
        const ref: CanonicalRef = {
          version: "v1",
          start: { book: bookCode, chapter: parsed.chapter, verse: parsed.verse },
          end: { book: bookCode, chapter: parsed.chapter, verse: parsed.verse },
        };

        results.push({
          kind: "cross-ref",
          provenance: "source",
          sourceId: crossRefData.meta.id,
          sourceName: crossRefData.meta.name,
          targetBref: toBref(ref),
          targetDisplay: toDisplayString(ref, bookNames),
        });
      }
    }
  }

  return results;
}

function parseCrossRefTarget(key: string): { book: string; chapter: number; verse: number } | null {
  const parts = key.split(".");
  if (parts.length !== 3) return null;
  const [bookStr, chStr, vStr] = parts as [string, string, string];
  const chapter = parseInt(chStr, 10);
  const verse = parseInt(vStr, 10);
  if (isNaN(chapter) || isNaN(verse)) return null;
  return { book: bookStr, chapter, verse };
}

function truncateSnippet(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}
