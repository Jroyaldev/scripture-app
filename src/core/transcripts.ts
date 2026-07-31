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
 * Which publishers this app carries, and the switch that withdraws one.
 *
 * FLATTENED 2026-07-31, on the maintainer's instruction: "we need all of these
 * in app, we will get approvals later before truly publishing, but this keeps
 * causing issues."
 *
 * This was a two-value footing — `publisher-granted` against `public-feed` —
 * and the second value gated marks, devices and reader-facing copy on which
 * conversation had happened yet. It kept stopping work over a distinction the
 * product does not act on: the app is not publicly listed, every one of these
 * feeds is published for clients to read, and the maintainer's standing
 * position is unchanged — approvals sought before any public listing,
 * takedowns honoured on request. Holding that as a code-level gate bought
 * nothing and cost a negotiation every time a publisher gained a logo.
 *
 * So the map is one value now, doing the job the product actually needs: a
 * source listed here is carried; a source absent from it has no path to being
 * displayed anywhere. To withdraw a publisher — a takedown, a change of heart,
 * a relationship gone quiet — delete their line and they leave the app. That
 * is deliberately the same mechanism that used to hold the footing, which is
 * why none of the loaders below changed.
 */
export type TranscriptBasis = "carried";

export const TRANSCRIPT_SOURCES: Readonly<Record<string, TranscriptBasis>> = {
  "bibleproject": "carried",
  "naked-bible": "carried",
  "spoken-gospel": "carried",
  "ask-nt-wright": "carried",
  "five-minutes-church-history": "carried",
  "forty-minutes-ot": "carried",
  "listeners-commentary": "carried",
  "radically-christian": "carried",
};

/** Every source whose transcripts may be read. */
export const TRANSCRIPT_ENABLED_SOURCES: readonly string[] = Object.keys(TRANSCRIPT_SOURCES);

/** Record ids are `${sourceId}:${kind}:${slug}`; the footing is per publisher. */
export function isTranscriptEnabledSource(recordId: string): boolean {
  const sourceId = recordId.split(":")[0] ?? "";
  return sourceId in TRANSCRIPT_SOURCES;
}

export function transcriptBasis(recordId: string): TranscriptBasis | null {
  return TRANSCRIPT_SOURCES[recordId.split(":")[0] ?? ""] ?? null;
}

export type TranscriptRefusal = "absent" | "unreadable" | "refused" | "ungranted";

/**
 * Rebuilds reading lines from the word stream.
 *
 * The stored segments are the recogniser's, and they are shaped by breathing
 * rather than by meaning: measured across one episode they run from 1 word to
 * 83, and from a tenth of a second to thirty-nine. A line reading "Sure." for
 * two tenths of a second is a flicker, and a thirty-nine second block is a
 * wall. Neither is a unit anyone reads.
 *
 * So lines are built here instead, from the words and their punctuation, to a
 * length the eye can take in one go. A sentence end is the preferred break, a
 * clause boundary the fallback, and length the backstop — which is the same
 * order of preference a typesetter would use, for the same reason.
 *
 * Timing comes from the words themselves, so a rebuilt line still seeks to the
 * moment its first word was spoken, and nothing is invented — every word here
 * was recognised with a timestamp attached.
 *
 * It is not quite a rewrapping of the stored segment text. The recogniser's
 * segments carry a handful of filler tokens its word stream does not — six
 * words in thirteen thousand on the episode this was measured against, all of
 * them "um"-class. Building from the timed words drops those, which is both
 * unavoidable (an untimed word cannot be placed) and, for something meant to
 * be read, no loss.
 */
const LINE_MIN_WORDS = 5;
const LINE_TARGET_WORDS = 10;
const LINE_MAX_WORDS = 16;
/** A pause this long is a break whatever the punctuation says. */
const LINE_GAP_SECONDS = 1.2;

const ENDS_SENTENCE = /[.!?]["')\]]?$/;
const ENDS_CLAUSE = /[,;:—]$/;

export function readingLines(words: readonly TranscriptWord[]): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  let held: TranscriptWord[] = [];

  const flush = (): void => {
    if (held.length === 0) return;
    lines.push({
      t: held.map((word) => word.w).join(" ").replace(/\s+/g, " ").trim(),
      s: held[0]!.s,
      e: held[held.length - 1]!.e,
    });
    held = [];
  };

  for (let i = 0; i < words.length; i += 1) {
    const word = words[i]!;
    held.push(word);

    const next = words[i + 1];
    const gap = next ? next.s - word.e : 0;
    const count = held.length;

    /* Long enough to be worth reading, and ending where a reader would pause
       anyway. Below the minimum nothing breaks, which is what stops "Sure."
       and "That's right." from each taking a line of their own — they join
       whatever follows. */
    const atSentence = count >= LINE_MIN_WORDS && ENDS_SENTENCE.test(word.w);
    const atClause = count >= LINE_TARGET_WORDS && ENDS_CLAUSE.test(word.w);
    const atPause = count >= LINE_MIN_WORDS && gap >= LINE_GAP_SECONDS;
    const tooLong = count >= LINE_MAX_WORDS;

    if (atSentence || atClause || atPause || tooLong) flush();
  }
  flush();

  return lines;
}

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
