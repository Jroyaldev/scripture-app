/**
 * Type-safe wrapper for the contextBridge API exposed by preload.
 */

declare global {
  interface Window {
    api: {
      library: {
        getPath(): Promise<string>;
        init(path: string): Promise<{ ok: boolean; error?: string }>;
        rebuild(): Promise<{ ok: boolean; hash?: string; error?: string }>;
        getSummary(): Promise<{
          notesFound: number;
          anchorsFound: number;
          highlightsFound: number;
          factsFound: number;
          unresolvedRefs: number;
          errors: string[];
        } | null>;
        readAllNotes(): Promise<ParsedNoteData[]>;
        createNote(title: string, body: string, opts?: { type?: string; tags?: string[] }): Promise<{ ok: boolean; id?: string; path?: string; error?: string }>;
        queryVerse(book: string, chapter: number, verse: number): Promise<QueryResult>;
        queryRange(startBook: string, startCh: number, startV: number, endBook: string, endCh: number, endV: number): Promise<QueryResult>;
        createHighlight(book: string, chapter: number, verseStart: number, verseEnd: number, color: string, packageId: string): Promise<{ ok: boolean; entityId?: string; error?: string }>;
        deleteHighlight(entityId: string, baseEventId: string): Promise<{ ok: boolean; error?: string }>;
        search(query: string): Promise<NoteData[]>;
        doctor(): Promise<DoctorReport | null>;
        migrate(dryRun: boolean): Promise<MigrationResult>;
        importVault(vaultPath: string): Promise<ImportResult>;
      };
      ref: {
        resolve(humanRef: string): Promise<RefParseResult>;
        parseBref(bref: string): Promise<RefParseResult>;
        toBref(ref: CanonicalRefData): Promise<string>;
        toDisplay(ref: CanonicalRefData): Promise<string>;
      };
      scripture: {
        getBackbone(): Promise<BackboneData>;
        getBookNames(): Promise<BookNameData>;
        getChapterText(packageId: string, book: string, chapter: number): Promise<ChapterData | null>;
        getCrossRefs(book: string, chapter: number, verse: number): Promise<string[]>;
      };
      dialog: {
        openDirectory(): Promise<string | null>;
      };
    };
  }
}

export interface ParsedNoteData {
  frontmatter: {
    id: string;
    title: string;
    created: string;
    modified: string;
    type?: string;
    tags?: string[];
  };
  body: string;
  scriptureRefs: Array<{
    raw: string;
    ref: CanonicalRefData;
  }>;
  noteLinks: Array<{
    targetId: string;
    label: string;
  }>;
}

export interface NoteData {
  id: string;
  title: string;
  type: string;
  path: string;
  created: string;
  modified: string;
  body_text: string;
}

export interface AnchorData {
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
}

export interface HighlightData {
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
}

export interface QueryResult {
  anchors: AnchorData[];
  highlights: HighlightData[];
  notes: NoteData[];
}

export interface CanonicalRefData {
  version: string;
  start: { book: string; chapter: number; verse: number };
  end: { book: string; chapter: number; verse: number };
  tokenNarrowing?: { layer: string; tokenStart: string; tokenEnd: string };
}

export interface RefParseResult {
  ok: boolean;
  value?: CanonicalRefData;
  error?: string;
}

export interface ChapterData {
  book: string;
  chapter: number;
  verses: Array<{ verse: number; text: string }>;
  verseCount: number;
}

export interface BackboneData {
  version: string;
  books: Record<string, { chapters: number[] }>;
}

export interface BookNameData {
  [code: string]: string[] | undefined;
}

export interface DoctorReport {
  errors: Array<{ code: string; message: string; suggestion?: string }>;
  warnings: Array<{ code: string; message: string; suggestion?: string }>;
  infos: Array<{ code: string; message: string }>;
  health: "HEALTHY" | "UNHEALTHY";
}

export interface MigrationResult {
  status: string;
  message: string;
}

export interface ImportResult {
  ok: boolean;
  imported: number;
  skipped: number;
  linksMapped: number;
  errors: string[];
}

export const api = window.api;
