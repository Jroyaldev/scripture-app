/**
 * Indexer types — interfaces for I/O injection (INV-18).
 * The SQLite materializer depends on these, not on concrete implementations.
 */

export type NoteRecord = {
  id: string;
  title: string;
  type: string;
  path: string;
  created: string;
  modified: string;
  body_text: string;
};

export type NoteTagRecord = {
  note_id: string;
  tag: string;
};

export type AnchorRecord = {
  id: string;
  src_kind: string;
  src_id: string;
  corpus: string;
  book: string;
  start_ch: number;
  start_v: number;
  end_ch: number;
  end_v: number;
  provenance: string;
};

export type EdgeRecord = {
  src_id: string;
  dst_id: string;
  kind: string;
  provenance: string;
};

export type HighlightRecord = {
  id: string;
  book: string;
  chapter: number;
  verse_start: number;
  verse_end: number;
  package: string;
  char_start: number | null;
  char_end: number | null;
  color: string;
  kind: string;
  note_id: string | null;
  deleted: number;
};

export type FactRecord = {
  id: string;
  assertion: string;
  from_claim: string | null;
  user_note: string | null;
  deleted: number;
};

export type SourceRecord = {
  id: string;
  title: string;
  kind: string;
  imported: string;
};

export type PdfLocator = {
  kind: "pdf";
  page: number;
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  textStart: number;
  textEnd: number;
};

export type SourceChunkRecord = {
  id: string;
  source_id: string;
  ordinal: number;
  text: string;
  locator_json: string;
};
