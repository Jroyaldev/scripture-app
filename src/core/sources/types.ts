/**
 * Source ingestion types — platform-agnostic (INV-18).
 * Host adapters perform file/PDF I/O; core-facing records stay serializable.
 */

import type { PdfLocator, SourceChunkRecord, SourceRecord } from "../indexer/types.js";

export type SourceRights = {
  userProvided: boolean;
  licenseName?: string;
  canQuoteInNotes?: boolean;
  canExportQuotes?: boolean;
};

export type SourceSyncPolicy = {
  syncOriginal: boolean;
  syncDerivedChunks: boolean;
  syncEmbeddings: boolean;
};

export type SourceMetadata = {
  schemaVersion: 1;
  id: string;
  title: string;
  kind: "pdf" | "epub" | "doc";
  imported: string;
  originalFilename: string;
  originalSha256: string;
  rights: SourceRights;
  syncPolicy: SourceSyncPolicy;
};

export type ImportedSource = {
  source: SourceRecord;
  chunks: SourceChunk[];
};

export type SourceChunk = Omit<SourceChunkRecord, "locator_json"> & {
  locator: PdfLocator;
};
