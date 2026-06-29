/**
 * Importer types — platform-agnostic (INV-18).
 */

export type ImportedNote = {
  id: string;
  title: string;
  body: string;
  tags: string[];
  created: string;
  modified: string;
  originalPath: string;
};

export type WikiLink = {
  target: string;
  alias: string | null;
  raw: string;
};

export type ImportResult = {
  notes: ImportedNote[];
  unresolvedLinks: Array<{ noteId: string; link: WikiLink }>;
  resolvedLinks: Array<{ fromId: string; toId: string; label: string }>;
  stats: {
    totalFiles: number;
    imported: number;
    skipped: number;
    linksResolved: number;
    linksUnresolved: number;
  };
};
