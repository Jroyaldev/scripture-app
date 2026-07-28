/**
 * Machine transcripts: the shape, and what makes one usable.
 *
 * Pure by design. The renderer needs these types and the host needs the same
 * validation, and a renderer that reaches into a host module drags node's
 * types across a boundary they do not belong on. Reading the file stays in
 * `src/host/transcript-loader.ts`; deciding whether what was read is a
 * transcript happens here.
 *
 * Deliberately NOT part of the trusted-resource manifest. That manifest is a
 * link-only catalogue whose guardrail — no publisher bodies — is enforced on
 * the shape of the data rather than on anyone's intent, and a verbatim
 * transcript is a body under any reading. Keeping transcripts in their own
 * store leaves that guardrail literally true while where they belong is still
 * an open question (tasks/D11).
 */

export interface TranscriptLine {
  /** The line's text. */
  t: string;
  /** Seconds from the start of the audio. */
  s: number;
  e: number;
}

export interface TranscriptWord {
  w: string;
  s: number;
  e: number;
}

export interface Transcript {
  schema: "transcript/v1";
  /**
   * Always true. A transcript that does not declare itself machine-made is
   * refused rather than shown, because the one thing this must never do is let
   * generated text pass for something a person wrote.
   */
  generated: true;
  model: string;
  id: string;
  words: TranscriptWord[];
  segments: TranscriptLine[];
  audioSeconds: number | null;
}

/**
 * Publishers who have granted transcripts, and only those.
 *
 * BibleProject granted on 2026-07-28, conditioned on the transcriptions not
 * being mischaracterized — which is what `generated` and `model` below are for.
 * Requests to other publishers are outstanding; until one is answered, adding
 * its id here would be assuming an answer rather than recording one.
 *
 * Kept as data rather than as a check somewhere in the loader so the refusal
 * cannot be forgotten: a source absent from this list has no path to being
 * displayed, and `docs/trusted-resource-permissions.md` must name every id in
 * it — a test holds the two together.
 */
export const TRANSCRIPT_APPROVED_SOURCES: readonly string[] = ["bibleproject"];

/** Record ids are `${sourceId}:${kind}:${slug}`; the grant is per publisher. */
export function isTranscriptApprovedSource(recordId: string): boolean {
  const sourceId = recordId.split(":")[0] ?? "";
  return TRANSCRIPT_APPROVED_SOURCES.includes(sourceId);
}

export type TranscriptRefusal = "absent" | "unreadable" | "refused" | "ungranted";

export type TranscriptResult =
  | { ok: true; transcript: Transcript }
  | { ok: false; reason: TranscriptRefusal };

/** Mirrors the pipeline's `_key`: record ids carry colons, paths should not. */
export function transcriptKey(recordId: string): string {
  return recordId.replace(/:/g, "__").replace(/\//g, "_");
}

function isTimedSpan(value: unknown, textKey: "t" | "w"): boolean {
  if (typeof value !== "object" || value === null) return false;
  const span = value as Record<string, unknown>;
  return typeof span[textKey] === "string"
    && typeof span.s === "number" && Number.isFinite(span.s)
    && typeof span.e === "number" && Number.isFinite(span.e);
}

/**
 * Fails closed. A transcript is usable only if it says what it is, says a
 * model made it, and carries at least one timed word — an empty transcript is
 * a failed one, and a reader shown an empty panel would reasonably conclude
 * the episode had no speech in it.
 */
export function readTranscript(parsed: unknown, fallbackId: string): TranscriptResult {
  if (typeof parsed !== "object" || parsed === null) return { ok: false, reason: "refused" };
  const candidate = parsed as Record<string, unknown>;

  if (candidate.schema !== "transcript/v1") return { ok: false, reason: "refused" };
  if (candidate.generated !== true) return { ok: false, reason: "refused" };
  if (typeof candidate.model !== "string" || candidate.model.length === 0) {
    return { ok: false, reason: "refused" };
  }

  const words = Array.isArray(candidate.words) ? candidate.words : [];
  const segments = Array.isArray(candidate.segments) ? candidate.segments : [];
  if (words.length === 0) return { ok: false, reason: "refused" };
  if (!words.every((word) => isTimedSpan(word, "w"))) return { ok: false, reason: "refused" };
  if (!segments.every((line) => isTimedSpan(line, "t"))) return { ok: false, reason: "refused" };

  /* Sorted here rather than trusted. Consumers pick the active line by scanning
     for the last start at or before the playhead, which silently selects the
     wrong line if the spans arrive out of order. */
  return {
    ok: true,
    transcript: {
      schema: "transcript/v1",
      generated: true,
      model: candidate.model,
      id: typeof candidate.id === "string" ? candidate.id : fallbackId,
      words: [...(words as TranscriptWord[])].sort((a, b) => a.s - b.s),
      segments: [...(segments as TranscriptLine[])].sort((a, b) => a.s - b.s),
      audioSeconds: typeof candidate.audioSeconds === "number" ? candidate.audioSeconds : null,
    },
  };
}
