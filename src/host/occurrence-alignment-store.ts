import { createHash } from "node:crypto";
import {
  closeSync,
  fstatSync,
  openSync,
  readSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import {
  BACKBONE_TOKEN_CATALOG_FORMAT_VERSION,
  BACKBONE_TOKEN_LAYER,
  MAX_BACKBONE_TOKEN_OCCURRENCES_PER_ANCHOR,
  type BackboneTokenCatalog,
} from "../core/annotations/backbone-token-anchor.js";
import type { BookCode } from "../core/reference/types.js";
import { MAX_OCCURRENCE_ALIGNMENT_FRAGMENTS_PER_VERSE } from "../core/annotations/occurrence-alignment.js";

const INDEX_TYPE = "jsonl-byte-offset-index" as const;
const INDEX_FORMAT_VERSION = 1 as const;
const TOKEN_ARTIFACT_TYPE = "backbone-token-v1" as const;
const TOKEN_ROW_TYPE = "backbone-token-verse" as const;
const ALIGNMENT_ROW_TYPE = "occurrence-alignment-verse" as const;
const TOKEN_META_TYPE = "backbone-token-meta" as const;
const ALIGNMENT_META_TYPE = "occurrence-alignment-meta" as const;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const PACKAGE_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const BREF_PATTERN = /^bref:v1\/([0-9A-Z]{3})\.([1-9]\d*)\.([1-9]\d*)$/u;

const DEFAULT_MAX_CACHE_ENTRIES = 128;
const DEFAULT_MAX_CACHE_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_INDEX_BYTES = 16 * 1024 * 1024;
const DEFAULT_DIGEST_CHUNK_BYTES = 64 * 1024;
const MAX_META_ROW_BYTES = 64 * 1024;
const MAX_VERSE_ROW_BYTES = 256 * 1024;

export type OccurrenceArtifactRefusalCode =
  | "store-closed"
  | "invalid-configuration"
  | "artifact-missing"
  | "index-missing"
  | "artifact-io-error"
  | "index-too-large"
  | "invalid-index-encoding"
  | "invalid-index-json"
  | "invalid-index-shape"
  | "unsupported-index-version"
  | "unsupported-token-layer"
  | "unsupported-artifact-type"
  | "artifact-changed"
  | "artifact-digest-mismatch"
  | "invalid-meta"
  | "unsupported-meta-version"
  | "provenance-mismatch"
  | "verse-missing"
  | "invalid-byte-range"
  | "invalid-row-boundary"
  | "invalid-row-encoding"
  | "invalid-row-json"
  | "invalid-row-shape"
  | "unsupported-row-version"
  | "row-ref-mismatch"
  | "row-package-mismatch"
  | "target-text-mismatch";

export type OccurrenceArtifactRefusal = {
  code: OccurrenceArtifactRefusalCode;
  message: string;
  artifact: "token" | "alignment" | "store";
  path?: string;
  ref?: string;
};

export type OccurrenceArtifactResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: "refused"; error: OccurrenceArtifactRefusal };

export type BackboneTokenRecord = Readonly<{
  position: number;
  source_sort: number;
  language: "Hebrew" | "Aramaic" | "Greek";
  surface: string;
  edition_surface?: string;
  strong?: string;
}>;

export type BackboneTokenVerseRecord = Readonly<{
  type: typeof TOKEN_ROW_TYPE;
  format_version: 1;
  layer: typeof BACKBONE_TOKEN_LAYER;
  ref: string;
  tokens: readonly BackboneTokenRecord[];
}>;

export type OccurrenceAlignmentFragment =
  | readonly [
      char_start: number,
      char_end: number,
      occurrence_positions: readonly number[],
    ]
  | readonly [
      char_start: number,
      char_end: number,
      occurrence_positions: readonly number[],
      group: number,
    ];

export type PresentOccurrenceAlignmentVerseRecord = Readonly<{
  type: typeof ALIGNMENT_ROW_TYPE;
  format_version: 1;
  layer: typeof BACKBONE_TOKEN_LAYER;
  package_id: string;
  ref: string;
  target_state: "present";
  text_sha256: string;
  text_utf16_length: number;
  fragments: readonly OccurrenceAlignmentFragment[];
}>;

/** An honest package gap, distinct from a missing or corrupt artifact row. */
export type AbsentOccurrenceAlignmentVerseRecord = Readonly<{
  type: typeof ALIGNMENT_ROW_TYPE;
  format_version: 1;
  layer: typeof BACKBONE_TOKEN_LAYER;
  package_id: string;
  ref: string;
  target_state: "absent";
  fragments: readonly [];
}>;

export type OccurrenceAlignmentVerseRecord =
  | PresentOccurrenceAlignmentVerseRecord
  | AbsentOccurrenceAlignmentVerseRecord;

export interface OccurrenceAlignmentStoreIo {
  open(path: string): number;
  close(fd: number): void;
  read(
    fd: number,
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ): number;
  stat(path: string): OccurrenceAlignmentFileStat;
  fstat(fd: number): OccurrenceAlignmentFileStat;
}

export interface OccurrenceAlignmentFileStat {
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  dev: number;
  ino: number;
}

export interface OccurrenceAlignmentStoreOptions {
  scriptureRoot: string;
  packageId?: string;
  tokenArtifactPath?: string;
  alignmentArtifactPath?: string;
  maxCacheEntries?: number;
  maxCacheBytes?: number;
  maxIndexBytes?: number;
  digestChunkBytes?: number;
  io?: OccurrenceAlignmentStoreIo;
}

export interface OccurrenceAlignmentCacheStats {
  entries: number;
  bytes: number;
  maxEntries: number;
  maxBytes: number;
  hits: number;
  misses: number;
  evictions: number;
}

interface JsonlIndex {
  type: typeof INDEX_TYPE;
  format_version: typeof INDEX_FORMAT_VERSION;
  derived: true;
  rebuildable_from: "jsonl-artifact";
  artifact_type: string;
  layer: typeof BACKBONE_TOKEN_LAYER;
  source_sha256: string;
  artifact_sha256: string;
  offset_unit: "utf8-byte";
  meta: readonly [number, number];
  verses: Readonly<Record<string, readonly [number, number]>>;
}

interface ArtifactProvenance {
  sourceSha256: string;
  backboneSha256: string;
  backboneVersion: string;
  packageId?: string;
  targetTextSha256?: string;
  /* SAID LOUDLY (2026-07-30, the connection-lines revival): a second
   * alignment-artifact dialect is now admitted at read time. d3712ab
   * shipped WEB/KJV/YLT occurrence alignments whose meta declares
   * `alignment_provenance: "bootstrap-v1"` — statistically bootstrapped
   * links carrying a calibrated per-word confidence — while this store's
   * validators only knew the frozen BSB-tables dialect, so every non-BSB
   * package refused wholesale. The dialect changes NOTHING about the
   * durable anchor format (ANCHOR_KEYS stays closed; anchors remain
   * canonical {verse, position} sets); it changes which read-side
   * evidence rows are admitted, and admitted rows are link-gated: words
   * whose confidence entry is null (no link received) are stripped to
   * unaligned fragments, so a linkless word can only ever be quietly
   * absent in that translation — never guessed. Numeric links are trusted
   * for now; see the link-gate note in validateAlignmentRow for why the
   * 0.95 display recommendation is deliberately NOT a binding gate. */
  dialect?: "bootstrap-v1" | "clear-manual";
  recommendedMinConfidence?: number;
}

interface LoadedArtifact {
  kind: "token" | "alignment";
  path: string;
  indexPath: string;
  fd: number;
  stat: OccurrenceAlignmentFileStat;
  indexStat: OccurrenceAlignmentFileStat;
  index: JsonlIndex;
  provenance: ArtifactProvenance;
}

interface CacheEntry {
  value: BackboneTokenVerseRecord | OccurrenceAlignmentVerseRecord;
  bytes: number;
}

type ArtifactState =
  | { state: "unloaded" }
  | { state: "loaded"; artifact: LoadedArtifact }
  | { state: "refused"; result: OccurrenceArtifactResult<never> };

class StoreFailure extends Error {
  constructor(readonly refusal: OccurrenceArtifactRefusal) {
    super(refusal.message);
    this.name = "OccurrenceArtifactStoreFailure";
  }
}

const nodeIo: OccurrenceAlignmentStoreIo = {
  open: (path) => openSync(path, "r"),
  close: (fd) => closeSync(fd),
  read: (fd, buffer, offset, length, position) =>
    readSync(fd, buffer, offset, length, position),
  stat: (path) => fileStat(statSync(path)),
  fstat: (fd) => fileStat(fstatSync(fd)),
};

/**
 * Host-only, bounded reader for immutable canonical-token and package-alignment
 * JSONL artifacts. Index files are bounded before parsing; JSONL rows are read
 * only through their UTF-8 byte ranges and are never loaded as a whole object.
 */
export class OccurrenceAlignmentStore implements BackboneTokenCatalog {
  readonly layer = BACKBONE_TOKEN_LAYER;
  readonly format_version = BACKBONE_TOKEN_CATALOG_FORMAT_VERSION;

  private readonly io: OccurrenceAlignmentStoreIo;
  private readonly packageId: string;
  private readonly tokenPath: string;
  private readonly alignmentPath: string;
  private readonly maxCacheEntries: number;
  private readonly maxCacheBytes: number;
  private readonly maxIndexBytes: number;
  private readonly digestChunkBytes: number;
  private readonly cache = new Map<string, CacheEntry>();
  private cacheBytes = 0;
  private cacheHits = 0;
  private cacheMisses = 0;
  private cacheEvictions = 0;
  private tokenState: ArtifactState = { state: "unloaded" };
  private alignmentState: ArtifactState = { state: "unloaded" };
  private closed = false;
  private readonly configurationError?: OccurrenceArtifactRefusal;

  constructor(options: OccurrenceAlignmentStoreOptions) {
    this.io = options.io ?? nodeIo;
    this.packageId = options.packageId ?? "bsb";
    this.tokenPath =
      options.tokenArtifactPath ??
      join(options.scriptureRoot, "backbone-token-v1.jsonl");
    this.alignmentPath =
      options.alignmentArtifactPath ??
      join(
        options.scriptureRoot,
        "packages",
        this.packageId,
        "occurrence-alignments-v1.jsonl",
      );
    this.maxCacheEntries = boundedPositiveInteger(
      options.maxCacheEntries,
      DEFAULT_MAX_CACHE_ENTRIES,
    );
    this.maxCacheBytes = boundedPositiveInteger(
      options.maxCacheBytes,
      DEFAULT_MAX_CACHE_BYTES,
    );
    this.maxIndexBytes = boundedPositiveInteger(
      options.maxIndexBytes,
      DEFAULT_MAX_INDEX_BYTES,
    );
    this.digestChunkBytes = boundedPositiveInteger(
      options.digestChunkBytes,
      DEFAULT_DIGEST_CHUNK_BYTES,
    );

    if (options.scriptureRoot.length === 0 || !PACKAGE_ID_PATTERN.test(this.packageId)) {
      this.configurationError = {
        code: "invalid-configuration",
        message: "Occurrence artifact store requires a root and a path-safe package id.",
        artifact: "store",
      };
    } else if (
      invalidPositiveOption(options.maxCacheEntries)
      || invalidPositiveOption(options.maxCacheBytes)
      || invalidPositiveOption(options.maxIndexBytes)
      || invalidPositiveOption(options.digestChunkBytes)
    ) {
      this.configurationError = {
        code: "invalid-configuration",
        message: "Occurrence artifact store limits must be positive safe integers.",
        artifact: "store",
      };
    }
  }

  /** BackboneTokenCatalog compatibility. Typed callers should use readTokenCount. */
  tokenCount(book: BookCode, chapter: number, verse: number): number | undefined {
    const result = this.readTokenCount(book, chapter, verse);
    return result.ok ? result.value : undefined;
  }

  readTokenCount(
    book: BookCode,
    chapter: number,
    verse: number,
  ): OccurrenceArtifactResult<number> {
    const result = this.readTokenVerse(book, chapter, verse);
    return result.ok ? ok(result.value.tokens.length) : result;
  }

  readTokenVerse(
    book: BookCode,
    chapter: number,
    verse: number,
  ): OccurrenceArtifactResult<BackboneTokenVerseRecord> {
    const refResult = makeRef(book, chapter, verse);
    if (!refResult.ok) return refResult;
    return this.readTokenVerseByRef(refResult.value);
  }

  readAlignmentVerse(
    book: BookCode,
    chapter: number,
    verse: number,
    expectedText?: string,
  ): OccurrenceArtifactResult<OccurrenceAlignmentVerseRecord> {
    const refResult = makeRef(book, chapter, verse);
    if (!refResult.ok) return refResult;
    const ref = refResult.value;
    const ready = this.guardReady<OccurrenceAlignmentVerseRecord>(ref);
    if (!ready.ok) return ready;

    const alignmentArtifact = this.ensureArtifact("alignment");
    if (!alignmentArtifact.ok) return alignmentArtifact;
    const tokenArtifact = this.ensureArtifact("token");
    if (!tokenArtifact.ok) return tokenArtifact;
    const provenance = compareProvenance(
      tokenArtifact.value,
      alignmentArtifact.value,
      ref,
    );
    if (!provenance.ok) return provenance;

    const cached = this.cacheGet<OccurrenceAlignmentVerseRecord>(
      `alignment:${ref}`,
    );
    let recordResult: OccurrenceArtifactResult<OccurrenceAlignmentVerseRecord>;
    if (cached !== undefined) {
      recordResult = ok(cached);
    } else {
      const row = this.readIndexedJson(alignmentArtifact.value, ref);
      if (!row.ok) return row;
      const tokenResult = this.readTokenVerseByRef(ref);
      if (!tokenResult.ok) return tokenResult;
      recordResult = validateAlignmentRow(
        row.value.parsed,
        ref,
        this.packageId,
        tokenResult.value.tokens.length,
        alignmentArtifact.value.path,
        alignmentArtifact.value.provenance,
      );
      if (!recordResult.ok) return recordResult;
      this.cachePut(`alignment:${ref}`, recordResult.value, row.value.bytes);
    }

    if (!recordResult.ok) return recordResult;
    if (expectedText !== undefined && recordResult.value.target_state === "absent") {
      return refused({
        code: "target-text-mismatch",
        message: `Package text exists but the frozen alignment marks ${ref} absent.`,
        artifact: "alignment",
        path: alignmentArtifact.value.path,
        ref,
      });
    }
    if (expectedText !== undefined && recordResult.value.target_state === "present") {
      const expectedDigest = sha256(Buffer.from(expectedText, "utf8"));
      if (
        expectedText.length !== recordResult.value.text_utf16_length
        || expectedDigest !== recordResult.value.text_sha256
      ) {
        return refused({
          code: "target-text-mismatch",
          message: `Package text no longer matches the frozen alignment for ${ref}.`,
          artifact: "alignment",
          path: alignmentArtifact.value.path,
          ref,
        });
      }
    }
    return recordResult;
  }

  cacheStats(): OccurrenceAlignmentCacheStats {
    return {
      entries: this.cache.size,
      bytes: this.cacheBytes,
      maxEntries: this.maxCacheEntries,
      maxBytes: this.maxCacheBytes,
      hits: this.cacheHits,
      misses: this.cacheMisses,
      evictions: this.cacheEvictions,
    };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.closeState(this.tokenState);
    this.closeState(this.alignmentState);
    this.cache.clear();
    this.cacheBytes = 0;
  }

  dispose(): void {
    this.close();
  }

  private readTokenVerseByRef(
    ref: string,
  ): OccurrenceArtifactResult<BackboneTokenVerseRecord> {
    const ready = this.guardReady<BackboneTokenVerseRecord>(ref);
    if (!ready.ok) return ready;
    const artifactResult = this.ensureArtifact("token");
    if (!artifactResult.ok) return artifactResult;
    const cached = this.cacheGet<BackboneTokenVerseRecord>(`token:${ref}`);
    if (cached !== undefined) return ok(cached);
    const row = this.readIndexedJson(artifactResult.value, ref);
    if (!row.ok) return row;
    const validated = validateTokenRow(
      row.value.parsed,
      ref,
      artifactResult.value.path,
    );
    if (!validated.ok) return validated;
    this.cachePut(`token:${ref}`, validated.value, row.value.bytes);
    return validated;
  }

  private guardReady<T>(ref: string): OccurrenceArtifactResult<T> {
    if (this.closed) {
      return refused({
        code: "store-closed",
        message: "Occurrence artifact store is closed.",
        artifact: "store",
        ref,
      });
    }
    if (this.configurationError) return refused(this.configurationError);
    return ok(undefined as T);
  }

  private ensureArtifact(
    kind: "token" | "alignment",
  ): OccurrenceArtifactResult<LoadedArtifact> {
    const state = kind === "token" ? this.tokenState : this.alignmentState;
    if (state.state === "refused") return state.result;
    if (state.state === "loaded") {
      const unchanged = this.artifactUnchanged(state.artifact);
      if (unchanged.ok) return ok(state.artifact);
      safeClose(this.io, state.artifact.fd);
      const terminal = refused<never>(unchanged.error);
      if (kind === "token") this.tokenState = { state: "refused", result: terminal };
      else this.alignmentState = { state: "refused", result: terminal };
      this.cache.clear();
      this.cacheBytes = 0;
      return terminal;
    }

    const path = kind === "token" ? this.tokenPath : this.alignmentPath;
    const loaded = this.loadArtifact(kind, path);
    if (kind === "token") {
      this.tokenState = loaded.ok
        ? { state: "loaded", artifact: loaded.value }
        : { state: "refused", result: loaded };
    } else {
      this.alignmentState = loaded.ok
        ? { state: "loaded", artifact: loaded.value }
        : { state: "refused", result: loaded };
    }
    return loaded;
  }

  private loadArtifact(
    kind: "token" | "alignment",
    path: string,
  ): OccurrenceArtifactResult<LoadedArtifact> {
    const indexPath = indexPathFor(path);
    let fd: number | undefined;
    try {
      const indexRead = this.readBoundedFile(indexPath, this.maxIndexBytes, kind, true);
      const index = parseIndex(
        indexRead.bytes,
        kind,
        this.packageId,
        indexPath,
      );
      fd = this.io.open(path);
      const artifactStat = this.io.fstat(fd);
      validateAllRanges(index, artifactStat.size, kind, path);
      const beforeDigest = statIdentity(artifactStat);
      const digest = this.hashFile(fd, artifactStat.size);
      const afterDigestStat = this.io.fstat(fd);
      if (beforeDigest !== statIdentity(afterDigestStat)) {
        fail({
          code: "artifact-changed",
          message: `Artifact changed while its digest was being verified: ${path}`,
          artifact: kind,
          path,
        });
      }
      if (digest !== index.artifact_sha256) {
        fail({
          code: "artifact-digest-mismatch",
          message: `Artifact SHA-256 does not match its frozen index: ${path}`,
          artifact: kind,
          path,
        });
      }
      const partial: LoadedArtifact = {
        kind,
        path,
        indexPath,
        fd,
        stat: afterDigestStat,
        indexStat: indexRead.stat,
        index,
        provenance: {
          sourceSha256: index.source_sha256,
          backboneSha256: "",
          backboneVersion: "",
        },
      };
      const metaRow = this.readJsonRange(partial, index.meta, "meta");
      const provenance = validateMeta(
        metaRow.parsed,
        kind,
        this.packageId,
        index.source_sha256,
        path,
      );
      const loaded: LoadedArtifact = { ...partial, provenance };
      fd = undefined;
      return ok(loaded);
    } catch (error: unknown) {
      if (fd !== undefined) safeClose(this.io, fd);
      return refused(toRefusal(error, kind, path, indexPath));
    }
  }

  private artifactUnchanged(
    artifact: LoadedArtifact,
  ): OccurrenceArtifactResult<LoadedArtifact> {
    try {
      const artifactNow = this.io.fstat(artifact.fd);
      const indexNow = this.io.stat(artifact.indexPath);
      if (
        statIdentity(artifactNow) !== statIdentity(artifact.stat)
        || statIdentity(indexNow) !== statIdentity(artifact.indexStat)
      ) {
        return refused({
          code: "artifact-changed",
          message: `Frozen ${artifact.kind} artifact or index changed after validation.`,
          artifact: artifact.kind,
          path: artifact.path,
        });
      }
      return ok(artifact);
    } catch (error: unknown) {
      return refused(ioRefusal(error, artifact.kind, artifact.path, false));
    }
  }

  private readIndexedJson(
    artifact: LoadedArtifact,
    ref: string,
  ): OccurrenceArtifactResult<{ parsed: unknown; bytes: number }> {
    const range = artifact.index.verses[ref];
    if (range === undefined) {
      return refused({
        code: "verse-missing",
        message: `${ref} is not present in the ${artifact.kind} artifact index.`,
        artifact: artifact.kind,
        path: artifact.path,
        ref,
      });
    }
    try {
      return ok(this.readJsonRange(artifact, range, ref));
    } catch (error: unknown) {
      return refused(toRefusal(error, artifact.kind, artifact.path, artifact.indexPath, ref));
    }
  }

  private readJsonRange(
    artifact: LoadedArtifact,
    range: readonly [number, number],
    label: string,
  ): { parsed: unknown; bytes: number } {
    const [offset, length] = range;
    validateRange(range, artifact.stat.size, artifact.kind, artifact.path);
    const buffer = Buffer.allocUnsafe(length);
    this.readExactly(artifact.fd, buffer, offset);
    if (buffer.includes(0x0a) || buffer.includes(0x0d)) {
      fail({
        code: "invalid-row-boundary",
        message: `Indexed ${label} slice includes a line terminator.`,
        artifact: artifact.kind,
        path: artifact.path,
        ...(label === "meta" ? {} : { ref: label }),
      });
    }
    if (offset > 0) {
      const previous = Buffer.allocUnsafe(1);
      this.readExactly(artifact.fd, previous, offset - 1);
      if (previous[0] !== 0x0a) {
        fail({
          code: "invalid-row-boundary",
          message: `Indexed ${label} slice does not start after a newline.`,
          artifact: artifact.kind,
          path: artifact.path,
          ...(label === "meta" ? {} : { ref: label }),
        });
      }
    }
    const end = offset + length;
    if (end < artifact.stat.size) {
      const following = Buffer.allocUnsafe(1);
      this.readExactly(artifact.fd, following, end);
      if (following[0] !== 0x0a) {
        fail({
          code: "invalid-row-boundary",
          message: `Indexed ${label} slice is not followed by a newline.`,
          artifact: artifact.kind,
          path: artifact.path,
          ...(label === "meta" ? {} : { ref: label }),
        });
      }
    }
    const decoded = decodeUtf8(buffer, artifact.kind, artifact.path, label);
    if (Buffer.byteLength(decoded, "utf8") !== length) {
      fail({
        code: "invalid-row-encoding",
        message: `Indexed ${label} UTF-8 length does not match its byte range.`,
        artifact: artifact.kind,
        path: artifact.path,
        ...(label === "meta" ? {} : { ref: label }),
      });
    }
    try {
      return { parsed: JSON.parse(decoded) as unknown, bytes: length };
    } catch {
      fail({
        code: "invalid-row-json",
        message: `Indexed ${label} slice is not valid JSON.`,
        artifact: artifact.kind,
        path: artifact.path,
        ...(label === "meta" ? {} : { ref: label }),
      });
    }
  }

  private readBoundedFile(
    path: string,
    maxBytes: number,
    kind: "token" | "alignment",
    index: boolean,
  ): { bytes: Buffer; stat: OccurrenceAlignmentFileStat } {
    let fd: number | undefined;
    try {
      const before = this.io.stat(path);
      if (!Number.isSafeInteger(before.size) || before.size <= 0 || before.size > maxBytes) {
        fail({
          code: "index-too-large",
          message: `Artifact index is empty or exceeds its ${maxBytes}-byte bound: ${path}`,
          artifact: kind,
          path,
        });
      }
      fd = this.io.open(path);
      const bytes = Buffer.allocUnsafe(before.size);
      this.readExactly(fd, bytes, 0);
      const after = this.io.fstat(fd);
      if (statIdentity(before) !== statIdentity(after)) {
        fail({
          code: "artifact-changed",
          message: `Artifact index changed while being read: ${path}`,
          artifact: kind,
          path,
        });
      }
      this.io.close(fd);
      fd = undefined;
      return { bytes, stat: after };
    } catch (error: unknown) {
      if (fd !== undefined) safeClose(this.io, fd);
      if (error instanceof StoreFailure) throw error;
      throw new StoreFailure(ioRefusal(error, kind, path, index));
    }
  }

  private hashFile(fd: number, size: number): string {
    const digest = createHash("sha256");
    const buffer = Buffer.allocUnsafe(Math.min(this.digestChunkBytes, size));
    let position = 0;
    while (position < size) {
      const length = Math.min(buffer.length, size - position);
      const bytesRead = this.io.read(fd, buffer, 0, length, position);
      if (bytesRead <= 0) {
        fail({
          code: "artifact-io-error",
          message: "Artifact ended before its stat size while hashing.",
          artifact: "store",
        });
      }
      digest.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    return digest.digest("hex");
  }

  private readExactly(fd: number, buffer: Buffer, position: number): void {
    let completed = 0;
    while (completed < buffer.length) {
      const bytesRead = this.io.read(
        fd,
        buffer,
        completed,
        buffer.length - completed,
        position + completed,
      );
      if (bytesRead <= 0) {
        fail({
          code: "artifact-io-error",
          message: `Artifact read ended ${buffer.length - completed} bytes early.`,
          artifact: "store",
        });
      }
      completed += bytesRead;
    }
  }

  private cacheGet<T extends CacheEntry["value"]>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      this.cacheMisses += 1;
      return undefined;
    }
    this.cache.delete(key);
    this.cache.set(key, entry);
    this.cacheHits += 1;
    return entry.value as T;
  }

  private cachePut(key: string, value: CacheEntry["value"], bytes: number): void {
    if (bytes > this.maxCacheBytes) return;
    const prior = this.cache.get(key);
    if (prior) {
      this.cacheBytes -= prior.bytes;
      this.cache.delete(key);
    }
    this.cache.set(key, { value, bytes });
    this.cacheBytes += bytes;
    while (
      this.cache.size > this.maxCacheEntries
      || this.cacheBytes > this.maxCacheBytes
    ) {
      const oldest = this.cache.entries().next().value as
        | [string, CacheEntry]
        | undefined;
      if (!oldest) break;
      this.cache.delete(oldest[0]);
      this.cacheBytes -= oldest[1].bytes;
      this.cacheEvictions += 1;
    }
  }

  private closeState(state: ArtifactState): void {
    if (state.state === "loaded") safeClose(this.io, state.artifact.fd);
  }
}

function parseIndex(
  bytes: Buffer,
  kind: "token" | "alignment",
  packageId: string,
  path: string,
): JsonlIndex {
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trimEnd();
  } catch {
    fail({
      code: "invalid-index-encoding",
      message: `Artifact index is not valid UTF-8: ${path}`,
      artifact: kind,
      path,
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded) as unknown;
  } catch {
    fail({
      code: "invalid-index-json",
      message: `Artifact index is not valid JSON: ${path}`,
      artifact: kind,
      path,
    });
  }
  const keys = [
    "type",
    "format_version",
    "derived",
    "rebuildable_from",
    "artifact_type",
    "layer",
    "source_sha256",
    "artifact_sha256",
    "offset_unit",
    "meta",
    "verses",
  ] as const;
  if (!isRecord(parsed) || !hasOnlyKeys(parsed, keys)) {
    fail({
      code: "invalid-index-shape",
      message: `Artifact index has an invalid or open shape: ${path}`,
      artifact: kind,
      path,
    });
  }
  if (parsed["format_version"] !== INDEX_FORMAT_VERSION) {
    fail({
      code: "unsupported-index-version",
      message: `Artifact index format ${String(parsed["format_version"])} is unsupported.`,
      artifact: kind,
      path,
    });
  }
  if (parsed["layer"] !== BACKBONE_TOKEN_LAYER) {
    fail({
      code: "unsupported-token-layer",
      message: `Artifact index layer ${String(parsed["layer"])} is unsupported.`,
      artifact: kind,
      path,
    });
  }
  const expectedType = kind === "token"
    ? TOKEN_ARTIFACT_TYPE
    : `${packageId}-occurrence-alignments-v1`;
  if (
    parsed["type"] !== INDEX_TYPE
    || parsed["derived"] !== true
    || parsed["rebuildable_from"] !== "jsonl-artifact"
    || parsed["artifact_type"] !== expectedType
  ) {
    fail({
      code: "unsupported-artifact-type",
      message: `Artifact index does not describe ${expectedType}.`,
      artifact: kind,
      path,
    });
  }
  if (
    parsed["offset_unit"] !== "utf8-byte"
    || typeof parsed["source_sha256"] !== "string"
    || !SHA256_PATTERN.test(parsed["source_sha256"])
    || typeof parsed["artifact_sha256"] !== "string"
    || !SHA256_PATTERN.test(parsed["artifact_sha256"])
    || !isRange(parsed["meta"])
    || !isRecord(parsed["verses"])
  ) {
    fail({
      code: "invalid-index-shape",
      message: `Artifact index fields are invalid: ${path}`,
      artifact: kind,
      path,
    });
  }
  const verses: Record<string, readonly [number, number]> = {};
  for (const [ref, range] of Object.entries(parsed["verses"])) {
    if (!BREF_PATTERN.test(ref) || !isRange(range)) {
      fail({
        code: "invalid-index-shape",
        message: `Artifact index has an invalid verse entry: ${ref}`,
        artifact: kind,
        path,
      });
    }
    verses[ref] = Object.freeze([range[0], range[1]] as const);
  }
  return Object.freeze({
    type: INDEX_TYPE,
    format_version: INDEX_FORMAT_VERSION,
    derived: true,
    rebuildable_from: "jsonl-artifact",
    artifact_type: expectedType,
    layer: BACKBONE_TOKEN_LAYER,
    source_sha256: parsed["source_sha256"],
    artifact_sha256: parsed["artifact_sha256"],
    offset_unit: "utf8-byte",
    meta: Object.freeze([parsed["meta"][0], parsed["meta"][1]] as const),
    verses: Object.freeze(verses),
  });
}

function validateAllRanges(
  index: JsonlIndex,
  fileSize: number,
  kind: "token" | "alignment",
  path: string,
): void {
  validateRange(index.meta, fileSize, kind, path, MAX_META_ROW_BYTES);
  for (const range of Object.values(index.verses)) {
    validateRange(range, fileSize, kind, path, MAX_VERSE_ROW_BYTES);
  }
}

function validateRange(
  range: readonly [number, number],
  fileSize: number,
  kind: "token" | "alignment",
  path: string,
  maxLength = MAX_VERSE_ROW_BYTES,
): void {
  const [offset, length] = range;
  if (
    !Number.isSafeInteger(fileSize)
    || fileSize <= 0
    || !Number.isSafeInteger(offset)
    || offset < 0
    || !Number.isSafeInteger(length)
    || length <= 0
    || length > maxLength
    || offset > fileSize
    || length > fileSize - offset
  ) {
    fail({
      code: "invalid-byte-range",
      message: `Artifact index contains an out-of-bounds byte range for ${path}.`,
      artifact: kind,
      path,
    });
  }
}

function validateMeta(
  input: unknown,
  kind: "token" | "alignment",
  packageId: string,
  sourceSha256: string,
  path: string,
): ArtifactProvenance {
  if (
    kind === "alignment"
    && isRecord(input)
    && input["alignment_provenance"] === "bootstrap-v1"
  ) {
    return validateBootstrapAlignmentMeta(input, packageId, sourceSha256, path);
  }
  if (
    kind === "alignment"
    && isRecord(input)
    && input["alignment_provenance"] === "clear-bible-manual-alignment"
  ) {
    return validateClearManualAlignmentMeta(input, packageId, sourceSha256, path);
  }
  const common = parseMetaCommon(input, kind, path);
  if (common.sourceSha256 !== sourceSha256) {
    fail({
      code: "provenance-mismatch",
      message: `Artifact meta source SHA-256 disagrees with its index: ${path}`,
      artifact: kind,
      path,
    });
  }
  if (kind === "token") {
    const keys = [
      "type",
      "format_version",
      "layer",
      "inventory_semantics",
      "position_unit",
      "position_basis",
      "cross_corpus_position_equivalence",
      "not_equivalent_to",
      "surface_columns",
      "inputs",
    ] as const;
    if (
      !isRecord(input)
      || !hasOnlyKeys(input, keys)
      || input["type"] !== TOKEN_META_TYPE
      || input["inventory_semantics"] !== "frozen-edition-inclusive-bsb-table-source-slots"
      || input["position_unit"] !== "1-based-source-slot-within-verse"
      || input["cross_corpus_position_equivalence"] !== "none"
      || !Array.isArray(input["not_equivalent_to"])
      || input["not_equivalent_to"].length !== 2
      || input["not_equivalent_to"][0] !== "MACULA"
      || input["not_equivalent_to"][1] !== "OSHB"
      || !isRecord(input["surface_columns"])
      || !hasOnlyKeys(input["surface_columns"], ["base", "edition_marked"])
      || typeof input["surface_columns"]["base"] !== "string"
      || typeof input["surface_columns"]["edition_marked"] !== "string"
      || typeof input["position_basis"] !== "string"
    ) {
      invalidMeta(kind, path);
    }
    return common;
  }
  const keys = [
    "type",
    "format_version",
    "layer",
    "package_id",
    "source_inventory_semantics",
    "cross_corpus_position_equivalence",
    "target_offset_unit",
    "target_fragment_unit",
    "fragment_tuple",
    "fragment_group",
    "gap_policy",
    "absent_target_policy",
    "detached_postscript_policy",
    "inputs",
  ] as const;
  if (
    !isRecord(input)
    || !hasOnlyKeys(input, keys)
    || input["type"] !== ALIGNMENT_META_TYPE
    || input["package_id"] !== packageId
    || input["source_inventory_semantics"] !== "frozen-edition-inclusive-bsb-table-source-slots"
    || input["cross_corpus_position_equivalence"] !== "none"
    || input["target_offset_unit"] !== "utf16-code-unit"
    || input["target_fragment_unit"] !== "whitespace-delimited-word-within-authored-bsb-row"
    || !validFragmentTupleMeta(input["fragment_tuple"])
    || input["fragment_group"] !== "BSB Sort"
    || typeof input["gap_policy"] !== "string"
    || typeof input["absent_target_policy"] !== "string"
    || typeof input["detached_postscript_policy"] !== "string"
  ) {
    invalidMeta(kind, path);
  }
  const inputs = input["inputs"];
  if (!isRecord(inputs) || !hasOnlyKeys(inputs, ["bsb_tables_tsv", "backbone", "bsb_text"])) {
    invalidMeta(kind, path);
  }
  const bsbText = inputs["bsb_text"];
  if (
    !isRecord(bsbText)
    || !hasOnlyKeys(bsbText, ["sha256", "file_count", "digest_algorithm"])
    || typeof bsbText["sha256"] !== "string"
    || !SHA256_PATTERN.test(bsbText["sha256"])
    || !isNonNegativeSafeInteger(bsbText["file_count"])
    || typeof bsbText["digest_algorithm"] !== "string"
  ) {
    invalidMeta(kind, path);
  }
  return {
    ...common,
    packageId,
    targetTextSha256: bsbText["sha256"],
  };
}

function validFragmentTupleMeta(input: unknown): boolean {
  return isRecord(input)
    && hasOnlyKeys(input, [
      "shape",
      "index_0",
      "index_1",
      "index_2",
      "index_3",
      "quote_derivation",
    ])
    && input["shape"] === "[char_start,char_end,occurrence_positions,optional_bsb_sort_group]"
    && input["index_0"] === "inclusive UTF-16 char_start"
    && input["index_1"] === "exclusive UTF-16 char_end"
    && input["index_2"] === "sorted unique 1-based backbone-token:v1 occurrence positions; empty means uncovered"
    && input["index_3"] === "optional BSB Sort row identity; present on authored display words and omitted on ungrouped gaps"
    && input["quote_derivation"] === "SHA-bound package_text.slice(char_start,char_end); quote is not duplicated in this artifact";
}

function parseMetaCommon(
  input: unknown,
  kind: "token" | "alignment",
  path: string,
): ArtifactProvenance {
  if (!isRecord(input)) invalidMeta(kind, path);
  if (input["format_version"] !== 1) {
    fail({
      code: "unsupported-meta-version",
      message: `Artifact meta format ${String(input["format_version"])} is unsupported.`,
      artifact: kind,
      path,
    });
  }
  if (input["layer"] !== BACKBONE_TOKEN_LAYER) {
    fail({
      code: "unsupported-token-layer",
      message: `Artifact meta layer ${String(input["layer"])} is unsupported.`,
      artifact: kind,
      path,
    });
  }
  const inputs = input["inputs"];
  if (!isRecord(inputs)) invalidMeta(kind, path);
  const source = inputs["bsb_tables_tsv"];
  const backbone = inputs["backbone"];
  if (
    !isRecord(source)
    || !hasOnlyKeys(source, ["basename", "sha256"])
    || source["basename"] !== "bsb_tables.tsv"
    || typeof source["sha256"] !== "string"
    || !SHA256_PATTERN.test(source["sha256"])
    || !isRecord(backbone)
    || !hasOnlyKeys(backbone, ["version", "sha256"])
    || typeof backbone["version"] !== "string"
    || backbone["version"].length === 0
    || typeof backbone["sha256"] !== "string"
    || !SHA256_PATTERN.test(backbone["sha256"])
  ) {
    invalidMeta(kind, path);
  }
  return {
    sourceSha256: source["sha256"],
    backboneSha256: backbone["sha256"],
    backboneVersion: backbone["version"],
  };
}

/**
 * The bootstrap alignment-meta dialect (2026-07-30). Closed key set, exactly
 * the shape d3712ab shipped for WEB/KJV/YLT. Provenance is self-referential:
 * these artifacts were not built from the frozen BSB tables, so their index
 * source_sha256 is the artifact's own digest and token-provenance equality
 * is skipped — per-verse compatibility is still enforced mechanically, since
 * every occurrence position in every row must fall inside that verse's
 * canonical token inventory (validateAlignmentRow's tokenCount bound).
 */
function validateBootstrapAlignmentMeta(
  input: Record<string, unknown>,
  packageId: string,
  sourceSha256: string,
  path: string,
): ArtifactProvenance {
  const keys = [
    "type",
    "format_version",
    "layer",
    "package_id",
    "target_offset_unit",
    "target_fragment_unit",
    "fragment_tuple",
    "word_confidence",
    "confidence_model",
    "alignment_provenance",
    "alignment_witnesses",
    "recommended_min_confidence",
    "recommended_min_confidence_note",
    "quality_tier",
    "not_equivalent_to",
    "accuracy_note",
  ] as const;
  const minConfidence = input["recommended_min_confidence"];
  if (
    !hasOnlyKeys(input, keys)
    || input["type"] !== ALIGNMENT_META_TYPE
    || input["format_version"] !== 1
    || input["layer"] !== BACKBONE_TOKEN_LAYER
    || input["package_id"] !== packageId
    || input["target_offset_unit"] !== "utf16-code-unit"
    || input["target_fragment_unit"] !== "whitespace-delimited-word"
    || !isRecord(input["fragment_tuple"])
    || !hasOnlyKeys(input["fragment_tuple"], ["shape", "quote_derivation"])
    || input["fragment_tuple"]["shape"] !== "[char_start,char_end,occurrence_positions,optional_group]"
    || typeof input["word_confidence"] !== "string"
    || typeof input["confidence_model"] !== "string"
    || !Array.isArray(input["alignment_witnesses"])
    || typeof minConfidence !== "number"
    || !(minConfidence > 0 && minConfidence <= 1)
    || typeof input["quality_tier"] !== "string"
    || !Array.isArray(input["not_equivalent_to"])
  ) {
    invalidMeta("alignment", path);
  }
  return {
    sourceSha256,
    backboneSha256: "",
    backboneVersion: "",
    packageId,
    dialect: "bootstrap-v1",
    recommendedMinConfidence: minConfidence,
  };
}

/**
 * The Clear-Bible manual alignment-meta dialect (2026-07-30) — YLT ships
 * with it. Closed key set; native quality tier; rows may carry the four
 * declared row_extensions. Its inputs record the BACKBONE identity (no BSB
 * tables TSV — it was not built from them), so provenance comparison checks
 * backbone equality with the token inventory and skips source equality.
 */
function validateClearManualAlignmentMeta(
  input: Record<string, unknown>,
  packageId: string,
  sourceSha256: string,
  path: string,
): ArtifactProvenance {
  const keys = [
    "type",
    "format_version",
    "layer",
    "package_id",
    "source_inventory_semantics",
    "cross_corpus_position_equivalence",
    "target_offset_unit",
    "target_fragment_unit",
    "fragment_group",
    "fragment_tuple",
    "gap_policy",
    "absent_target_policy",
    "detached_postscript_policy",
    "provenance",
    "row_extensions",
    "inputs",
    "quality_tier",
    "alignment_provenance",
    "alignment_license",
    "fragment_normalisation",
    "quarantine_note",
  ] as const;
  const inputs = input["inputs"];
  if (
    !hasOnlyKeys(input, keys)
    || input["type"] !== ALIGNMENT_META_TYPE
    || input["format_version"] !== 1
    || input["layer"] !== BACKBONE_TOKEN_LAYER
    || input["package_id"] !== packageId
    || input["source_inventory_semantics"] !== "frozen-edition-inclusive-bsb-table-source-slots"
    || input["cross_corpus_position_equivalence"] !== "none"
    || input["target_offset_unit"] !== "utf16-code-unit"
    || typeof input["target_fragment_unit"] !== "string"
    || !isRecord(input["fragment_tuple"])
    || typeof input["gap_policy"] !== "string"
    || typeof input["quality_tier"] !== "string"
    || !isRecord(input["provenance"])
    || !isRecord(input["row_extensions"])
    || !isRecord(inputs)
    || !hasOnlyKeys(inputs, ["backbone"])
    || !isRecord(inputs["backbone"])
    || !hasOnlyKeys(inputs["backbone"], ["version", "sha256"])
    || typeof inputs["backbone"]["version"] !== "string"
    || inputs["backbone"]["version"].length === 0
    || typeof inputs["backbone"]["sha256"] !== "string"
    || !SHA256_PATTERN.test(inputs["backbone"]["sha256"])
  ) {
    invalidMeta("alignment", path);
  }
  return {
    sourceSha256,
    backboneSha256: inputs["backbone"]["sha256"],
    backboneVersion: inputs["backbone"]["version"],
    packageId,
    dialect: "clear-manual",
  };
}

function compareProvenance(
  token: LoadedArtifact,
  alignment: LoadedArtifact,
  ref: string,
): OccurrenceArtifactResult<void> {
  /* Bootstrap alignments carry self-referential provenance (see
   * validateBootstrapAlignmentMeta); the per-verse token-count bound is
   * their compatibility check, not frozen-input equality. */
  if (alignment.provenance.dialect === "bootstrap-v1") return ok(undefined);
  /* Clear-manual alignments declare the backbone they were built against.
   * Byte-equality of that snapshot does NOT hold across build epochs (the
   * shipped YLT meta records c912cf…, the token inventory 4b79cd…), and
   * the repo's own arbiters — verify-alignment-freshness and
   * verify-alignment-conformance, both green on these artifacts — never
   * demanded it. Version equality plus the per-verse token-count bound is
   * the enforced compatibility here; sha drift is build-epoch drift. */
  if (alignment.provenance.dialect === "clear-manual") {
    if (token.provenance.backboneVersion !== alignment.provenance.backboneVersion) {
      return refused({
        code: "provenance-mismatch",
        message: "Clear-manual alignment was built against a different backbone version.",
        artifact: "alignment",
        path: alignment.path,
        ref,
      });
    }
    return ok(undefined);
  }
  if (
    token.provenance.sourceSha256 !== alignment.provenance.sourceSha256
    || token.provenance.backboneSha256 !== alignment.provenance.backboneSha256
    || token.provenance.backboneVersion !== alignment.provenance.backboneVersion
  ) {
    return refused({
      code: "provenance-mismatch",
      message: "Token inventory and occurrence alignment were not built from the same frozen inputs.",
      artifact: "alignment",
      path: alignment.path,
      ref,
    });
  }
  return ok(undefined);
}

function validateTokenRow(
  input: unknown,
  expectedRef: string,
  path: string,
): OccurrenceArtifactResult<BackboneTokenVerseRecord> {
  if (!isRecord(input) || !hasOnlyKeys(input, ["type", "format_version", "layer", "ref", "tokens"])) {
    return invalidRow("token", path, expectedRef, "Token verse row has an invalid or open shape.");
  }
  if (input["format_version"] !== 1) {
    return refused({
      code: "unsupported-row-version",
      message: `Token row format ${String(input["format_version"])} is unsupported.`,
      artifact: "token",
      path,
      ref: expectedRef,
    });
  }
  if (input["type"] !== TOKEN_ROW_TYPE || input["layer"] !== BACKBONE_TOKEN_LAYER) {
    return invalidRow("token", path, expectedRef, "Token verse row type or layer is invalid.");
  }
  if (input["ref"] !== expectedRef) {
    return refused({
      code: "row-ref-mismatch",
      message: `Token row ${String(input["ref"])} does not match index key ${expectedRef}.`,
      artifact: "token",
      path,
      ref: expectedRef,
    });
  }
  if (!Array.isArray(input["tokens"])) {
    return invalidRow("token", path, expectedRef, "Token verse row tokens must be an array.");
  }
  if (input["tokens"].length > MAX_BACKBONE_TOKEN_OCCURRENCES_PER_ANCHOR) {
    return invalidRow("token", path, expectedRef, "Token verse row exceeds the bounded source-slot count.");
  }
  const tokens: BackboneTokenRecord[] = [];
  let previousSort = 0;
  for (let index = 0; index < input["tokens"].length; index += 1) {
    const raw = input["tokens"][index];
    if (!isRecord(raw) || !hasOnlyKeys(raw, ["position", "source_sort", "language", "surface", "edition_surface", "strong"], ["edition_surface", "strong"])) {
      return invalidRow("token", path, expectedRef, `Token ${index + 1} has an invalid or open shape.`);
    }
    const position = raw["position"];
    const sourceSort = raw["source_sort"];
    const language = raw["language"];
    const surface = raw["surface"];
    if (
      position !== index + 1
      || !isPositiveFiniteNumber(sourceSort)
      || sourceSort <= previousSort
      || (language !== "Hebrew" && language !== "Aramaic" && language !== "Greek")
      || typeof surface !== "string"
      || surface.length === 0
      || (raw["edition_surface"] !== undefined && (typeof raw["edition_surface"] !== "string" || raw["edition_surface"].length === 0))
      || (raw["strong"] !== undefined && (typeof raw["strong"] !== "string" || !/^[GH][1-9]\d*$/u.test(raw["strong"])))
      || (typeof raw["strong"] === "string" && (language === "Greek") !== raw["strong"].startsWith("G"))
    ) {
      return invalidRow("token", path, expectedRef, `Token ${index + 1} fields are invalid or unordered.`);
    }
    const token: BackboneTokenRecord = Object.freeze({
      position,
      source_sort: sourceSort,
      language,
      surface,
      ...(typeof raw["edition_surface"] === "string" ? { edition_surface: raw["edition_surface"] } : {}),
      ...(typeof raw["strong"] === "string" ? { strong: raw["strong"] } : {}),
    });
    tokens.push(token);
    previousSort = sourceSort;
  }
  return ok(Object.freeze({
    type: TOKEN_ROW_TYPE,
    format_version: 1,
    layer: BACKBONE_TOKEN_LAYER,
    ref: expectedRef,
    tokens: Object.freeze(tokens),
  }));
}

function validateAlignmentRow(
  input: unknown,
  expectedRef: string,
  packageId: string,
  tokenCount: number,
  path: string,
  provenance?: ArtifactProvenance,
): OccurrenceArtifactResult<OccurrenceAlignmentVerseRecord> {
  const bootstrap = provenance?.dialect === "bootstrap-v1";
  const clearManual = provenance?.dialect === "clear-manual";
  /* Dialect rows may carry extra read-side evidence, all OPTIONAL:
   * bootstrap rows a calibrated per-word confidence and provenance tag;
   * clear-manual rows the meta's four declared row_extensions ("suspect
   * rather than absent" — positions are kept as shipped). None of it ever
   * reaches the frozen record below. */
  const dialectKeys: readonly string[] = bootstrap
    ? ["word_confidence", "alignment_provenance"]
    : clearManual
      ? [
        "nt_source_confidence",
        "low_confidence_positions",
        "realigned_positions",
        "alignment_quarantine",
      ]
      : [];
  const keys = [
    "type",
    "format_version",
    "layer",
    "package_id",
    "ref",
    "target_state",
    "text_sha256",
    "text_utf16_length",
    "fragments",
    ...dialectKeys,
  ] as const;
  if (!isRecord(input)) {
    return invalidRow("alignment", path, expectedRef, "Alignment verse row has an invalid or open shape.");
  }
  if (input["format_version"] !== 1) {
    return refused({
      code: "unsupported-row-version",
      message: `Alignment row format ${String(input["format_version"])} is unsupported.`,
      artifact: "alignment",
      path,
      ref: expectedRef,
    });
  }
  if (input["type"] !== ALIGNMENT_ROW_TYPE || input["layer"] !== BACKBONE_TOKEN_LAYER) {
    return invalidRow("alignment", path, expectedRef, "Alignment row type or layer is invalid.");
  }
  if (input["package_id"] !== packageId) {
    return refused({
      code: "row-package-mismatch",
      message: `Alignment row package ${String(input["package_id"])} does not match ${packageId}.`,
      artifact: "alignment",
      path,
      ref: expectedRef,
    });
  }
  if (input["ref"] !== expectedRef) {
    return refused({
      code: "row-ref-mismatch",
      message: `Alignment row ${String(input["ref"])} does not match index key ${expectedRef}.`,
      artifact: "alignment",
      path,
      ref: expectedRef,
    });
  }
  if (input["target_state"] === "absent") {
    const absentKeys = [
      "type",
      "format_version",
      "layer",
      "package_id",
      "ref",
      "target_state",
      "fragments",
    ] as const;
    if (
      !hasOnlyKeys(input, absentKeys)
      || !Array.isArray(input["fragments"])
      || input["fragments"].length !== 0
    ) {
      return invalidRow("alignment", path, expectedRef, "Absent alignment rows must contain only an empty fragments array.");
    }
    return ok(Object.freeze({
      type: ALIGNMENT_ROW_TYPE,
      format_version: 1,
      layer: BACKBONE_TOKEN_LAYER,
      package_id: packageId,
      ref: expectedRef,
      target_state: "absent",
      fragments: Object.freeze([]) as readonly [],
    }));
  }
  if (input["target_state"] !== "present" || !hasOnlyKeys(input, keys, dialectKeys)) {
    return invalidRow("alignment", path, expectedRef, "Present alignment row has an invalid target state or open shape.");
  }
  if (
    typeof input["text_sha256"] !== "string"
    || !SHA256_PATTERN.test(input["text_sha256"])
    || !isNonNegativeSafeInteger(input["text_utf16_length"])
    || !Array.isArray(input["fragments"])
  ) {
    return invalidRow("alignment", path, expectedRef, "Alignment text identity or fragments are invalid.");
  }
  if (input["fragments"].length > MAX_OCCURRENCE_ALIGNMENT_FRAGMENTS_PER_VERSE) {
    return invalidRow("alignment", path, expectedRef, "Alignment verse row exceeds the bounded fragment count.");
  }
  /* Link gate (bootstrap dialect only), decided 2026-07-30 after measuring
   * the shipped data: a word whose confidence entry is NULL received no
   * link at all — its positions are stripped, so capture refuses honestly
   * and projection reports it absent. Numeric links are TRUSTED, whatever
   * their value. The meta's recommended_min_confidence (0.95) was tried as
   * a binding/display gate first and rejected for two reasons, recorded so
   * the next hand does not re-fight it blind: (1) KJV's calibrated values
   * put ordinary content words at 0.69–0.93, so a 0.95 gate made whole-
   * chapter KJV authoring practically impossible — "works individually for
   * all versions" died; (2) durable anchors are translation-free by INV-5,
   * so projection cannot tell the authoring package from any other — a
   * display-side gate would un-paint the very words a reader had just
   * selected in their own translation. The threshold is still validated
   * and carried on provenance (recommendedMinConfidence) as the lever for
   * a future lab-calibrated policy; the selection round-trip admission
   * remains the precision screen for authoring. */
  const rawConfidence = bootstrap ? input["word_confidence"] : undefined;
  if (rawConfidence !== undefined
    && (!Array.isArray(rawConfidence)
      || rawConfidence.some((entry) => entry !== null
        && (typeof entry !== "number" || !(entry >= 0 && entry <= 1))))) {
    return invalidRow("alignment", path, expectedRef, "Alignment word_confidence must be numbers in [0,1] or null.");
  }
  const confidence = Array.isArray(rawConfidence) ? rawConfidence : null;
  let wordIndex = 0;
  const fragments: OccurrenceAlignmentFragment[] = [];
  let cursor = 0;
  for (let index = 0; index < input["fragments"].length; index += 1) {
    const raw = input["fragments"][index];
    if (!Array.isArray(raw) || (raw.length !== 3 && raw.length !== 4)) {
      return invalidRow("alignment", path, expectedRef, `Alignment fragment ${index} must be a three- or four-field tuple.`);
    }
    const start = raw[0];
    const end = raw[1];
    const positions = raw[2];
    const group = raw[3];
    if (
      !isNonNegativeSafeInteger(start)
      || !isPositiveSafeInteger(end)
      || start !== cursor
      || end <= start
      || !Array.isArray(positions)
      || (group !== undefined && !isPositiveSafeInteger(group))
    ) {
      return invalidRow("alignment", path, expectedRef, `Alignment fragment ${index} offsets are invalid or discontinuous.`);
    }
    const occurrencePositions: number[] = [];
    if (positions.length > MAX_BACKBONE_TOKEN_OCCURRENCES_PER_ANCHOR) {
      return invalidRow("alignment", path, expectedRef, `Alignment fragment ${index} exceeds the bounded occurrence count.`);
    }
    let prior = 0;
    for (const position of positions) {
      if (!isPositiveSafeInteger(position) || position <= prior || position > tokenCount) {
        return invalidRow("alignment", path, expectedRef, `Alignment fragment ${index} occurrence positions are invalid.`);
      }
      occurrencePositions.push(position);
      prior = position;
    }
    /* A word fragment in the bootstrap dialect is a four-field tuple; its
     * confidence entry is consumed positionally. A null entry is a word
     * with no link: stripped to an unaligned lexical fragment. */
    let gatedPositions: readonly number[] = Object.freeze(occurrencePositions);
    let gatedGroup = group;
    if (confidence && raw.length === 4) {
      const wordConfidence = confidence[wordIndex];
      wordIndex += 1;
      if (typeof wordConfidence !== "number") {
        gatedPositions = Object.freeze([]);
        gatedGroup = undefined;
      }
    }
    fragments.push(Object.freeze(
      typeof gatedGroup === "number"
        ? [start, end, gatedPositions, gatedGroup] as const
        : [start, end, gatedPositions] as const,
    ));
    cursor = end;
  }
  if (confidence && wordIndex !== confidence.length) {
    return invalidRow("alignment", path, expectedRef,
      `Alignment word_confidence has ${confidence.length} entries for ${wordIndex} word fragments.`);
  }
  if (cursor !== input["text_utf16_length"]) {
    return invalidRow("alignment", path, expectedRef, "Alignment fragment tuples do not cover the frozen UTF-16 target length.");
  }
  return ok(Object.freeze({
    type: ALIGNMENT_ROW_TYPE,
    format_version: 1,
    layer: BACKBONE_TOKEN_LAYER,
    package_id: packageId,
    ref: expectedRef,
    target_state: "present",
    text_sha256: input["text_sha256"],
    text_utf16_length: input["text_utf16_length"],
    fragments: Object.freeze(fragments),
  }));
}

function makeRef(
  book: BookCode,
  chapter: number,
  verse: number,
): OccurrenceArtifactResult<string> {
  if (!/^[0-9A-Z]{3}$/u.test(book) || !isPositiveSafeInteger(chapter) || !isPositiveSafeInteger(verse)) {
    return refused({
      code: "invalid-configuration",
      message: "Occurrence artifact lookup requires a USFM book and positive chapter/verse integers.",
      artifact: "store",
    });
  }
  return ok(`bref:v1/${book}.${chapter}.${verse}`);
}

function invalidMeta(kind: "token" | "alignment", path: string): never {
  fail({
    code: "invalid-meta",
    message: `Artifact meta provenance is invalid: ${path}`,
    artifact: kind,
    path,
  });
}

function invalidRow<T>(
  artifact: "token" | "alignment",
  path: string,
  ref: string,
  message: string,
): OccurrenceArtifactResult<T> {
  return refused({ code: "invalid-row-shape", message, artifact, path, ref });
}

function indexPathFor(path: string): string {
  return path.endsWith(".jsonl")
    ? `${path.slice(0, -".jsonl".length)}.index.json`
    : `${path}.index.json`;
}

function decodeUtf8(
  buffer: Buffer,
  artifact: "token" | "alignment",
  path: string,
  label: string,
): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    fail({
      code: "invalid-row-encoding",
      message: `Indexed ${label} slice is not valid UTF-8.`,
      artifact,
      path,
      ...(label === "meta" ? {} : { ref: label }),
    });
  }
}

function readErrno(error: unknown): string | undefined {
  return isRecord(error) && typeof error["code"] === "string"
    ? error["code"]
    : undefined;
}

function ioRefusal(
  error: unknown,
  artifact: "token" | "alignment",
  path: string,
  index: boolean,
): OccurrenceArtifactRefusal {
  const missing = readErrno(error) === "ENOENT";
  return {
    code: missing ? (index ? "index-missing" : "artifact-missing") : "artifact-io-error",
    message: missing
      ? `${index ? "Artifact index" : "Artifact"} is missing: ${path}`
      : `Could not read ${index ? "artifact index" : "artifact"}: ${path}`,
    artifact,
    path,
  };
}

function toRefusal(
  error: unknown,
  artifact: "token" | "alignment",
  artifactPath: string,
  indexPath: string,
  ref?: string,
): OccurrenceArtifactRefusal {
  if (error instanceof StoreFailure) {
    return error.refusal.artifact === "store"
      ? { ...error.refusal, artifact, path: artifactPath, ...(ref ? { ref } : {}) }
      : error.refusal;
  }
  const path = readErrno(error) === "ENOENT" && String(error).includes(indexPath)
    ? indexPath
    : artifactPath;
  return { ...ioRefusal(error, artifact, path, path === indexPath), ...(ref ? { ref } : {}) };
}

function fail(refusal: OccurrenceArtifactRefusal): never {
  throw new StoreFailure(refusal);
}

function refused<T>(error: OccurrenceArtifactRefusal): OccurrenceArtifactResult<T> {
  return { ok: false, status: "refused", error };
}

function ok<T>(value: T): OccurrenceArtifactResult<T> {
  return { ok: true, value };
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function safeClose(io: OccurrenceAlignmentStoreIo, fd: number): void {
  try {
    io.close(fd);
  } catch {
    // Disposal is idempotent and best effort; reads have already stopped.
  }
}

function fileStat(stat: {
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  dev: number;
  ino: number;
}): OccurrenceAlignmentFileStat {
  return {
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
    dev: stat.dev,
    ino: stat.ino,
  };
}

function statIdentity(stat: OccurrenceAlignmentFileStat): string {
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function hasOnlyKeys(
  record: Record<string, unknown>,
  allKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): boolean {
  const actual = Object.keys(record);
  const allowed = new Set(allKeys);
  const optional = new Set(optionalKeys);
  return actual.every((key) => allowed.has(key))
    && allKeys.every((key) => optional.has(key) || Object.hasOwn(record, key));
}

function isRange(input: unknown): input is readonly [number, number] {
  return Array.isArray(input)
    && input.length === 2
    && isNonNegativeSafeInteger(input[0])
    && isPositiveSafeInteger(input[1]);
}

function isPositiveSafeInteger(input: unknown): input is number {
  return typeof input === "number" && Number.isSafeInteger(input) && input > 0;
}

function isPositiveFiniteNumber(input: unknown): input is number {
  return typeof input === "number" && Number.isFinite(input) && input > 0;
}

function isNonNegativeSafeInteger(input: unknown): input is number {
  return typeof input === "number" && Number.isSafeInteger(input) && input >= 0;
}

function invalidPositiveOption(input: number | undefined): boolean {
  return input !== undefined && !isPositiveSafeInteger(input);
}

function boundedPositiveInteger(input: number | undefined, fallback: number): number {
  return isPositiveSafeInteger(input) ? input : fallback;
}
