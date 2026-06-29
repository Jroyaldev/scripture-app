/**
 * Type-safe wrapper for the contextBridge API exposed by preload.
 * Provides typed access to all Electron IPC calls.
 */

declare global {
  interface Window {
    api: {
      library: {
        getPath(): Promise<string>;
        init(path: string): Promise<{ ok: boolean; error?: string }>;
        rebuild(): Promise<{ ok: boolean; hash?: string; error?: string }>;
        getSummary(): Promise<LibrarySummary | null>;
        readAllNotes(): Promise<ParsedNoteData[]>;
        createNote(title: string, body: string, opts?: { type?: string; tags?: string[] }): Promise<{ ok: boolean; id?: string; path?: string; error?: string }>;
        queryVerse(book: string, chapter: number, verse: number): Promise<QueryResult>;
        queryRange(startBook: string, startCh: number, startV: number, endBook: string, endCh: number, endV: number): Promise<QueryResult>;
        createHighlight(book: string, chapter: number, verseStart: number, verseEnd: number, color: string, packageId: string): Promise<{ ok: boolean; entityId?: string; error?: string }>;
        deleteHighlight(entityId: string, baseEventId: string): Promise<{ ok: boolean; error?: string }>;
        search(query: string): Promise<NoteSearchResult[]>;
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

export interface LibrarySummary {
  notesFound: number;
  anchorsFound: number;
  highlightsFound: number;
  errors: string[];
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
    bref: string;
  }>;
}

export interface NoteSearchResult {
  id: string;
  title: string;
  body_text: string;
}

export interface AnchorRecord {
  id: number;
  entity_id: string;
  note_id: string;
  book: string;
  chapter: number;
  verse_start: number;
  verse_end: number;
}

export interface HighlightRecord {
  id: number;
  entity_id: string;
  book: string;
  chapter: number;
  verse_start: number;
  verse_end: number;
  color: string;
  package_id: string;
  deleted: number;
}

export interface NoteRecord {
  id: string;
  title: string;
  body_text: string;
  created: string;
  modified: string;
}

export interface QueryResult {
  anchors: AnchorRecord[];
  highlights: HighlightRecord[];
  notes: NoteRecord[];
}

export interface ChapterData {
  verses: Array<{ verse: number; text: string }>;
}

export interface BackboneData {
  version: string;
  books: Record<string, { chapters: number[] }>;
}

export interface BookNameData {
  [bookCode: string]: string[];
}

export interface RefParseResult {
  ok: boolean;
  bref?: string;
  display?: string;
  error?: string;
}

export interface CanonicalRefData {
  version: string;
  start: { book: string; chapter: number; verse: number };
  end: { book: string; chapter: number; verse: number };
}

export interface ImportResult {
  ok: boolean;
  imported: number;
  skipped: number;
  linksMapped: number;
  errors: string[];
}
