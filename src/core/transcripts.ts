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
 * On what footing each publisher's transcripts are here.
 *
 *   publisher-granted   they were asked and they said yes
 *   public-feed         their RSS feed was read the way any podcast client
 *                       reads it, and they have not been asked
 *
 * The two are not the same claim and the list must not pretend they are. This
 * was one list called APPROVED while every entry on it had actually been
 * granted; once entries arrive on the other footing, a name saying "approved"
 * is the lie, not the policy. So the basis travels with the id.
 *
 * `public-feed` is a deliberate position rather than an oversight: a podcast
 * feed is published for clients to consume, catalogue metadata is not the
 * publisher's copyrightable work, and transcription is what every large client
 * already does. What it is NOT is permission. Every source on that footing is a
 * conversation still to have, permission is still to be sought before any
 * public listing, and a takedown is to be honoured on request — and this field
 * is what makes "which ones have we not asked yet" a query rather than a memory.
 *
 * Kept as data rather than as a check somewhere in the loader so the refusal
 * cannot be forgotten: a source absent from this map has no path to being
 * displayed, and `docs/trusted-resource-permissions.md` must name every id in
 * it and state its basis — a test holds the three together.
 */
export type TranscriptBasis = "publisher-granted" | "public-feed";

export const TRANSCRIPT_SOURCES: Readonly<Record<string, TranscriptBasis>> = {
  /* Granted 2026-07-28, on the condition that the transcriptions are not
     mischaracterized — which is what `generated` and `model` above are for. */
  "bibleproject": "publisher-granted",
  "naked-bible": "publisher-granted",
  /* Granted 2026-07-29, under the publisher's non-commercial terms. */
  "spoken-gospel": "publisher-granted",
  /* Read from their public feeds on 2026-07-29. Not yet asked. */
  "ask-nt-wright": "public-feed",
  "five-minutes-church-history": "public-feed",
  "forty-minutes-ot": "public-feed",
  "listeners-commentary": "public-feed",
  "radically-christian": "public-feed",
};

/** Every source whose transcripts may be read, on either footing. */
export const TRANSCRIPT_ENABLED_SOURCES: readonly string[] = Object.keys(TRANSCRIPT_SOURCES);

/** The sources nobody has asked yet. Empty is the condition for public listing. */
export const TRANSCRIPT_UNASKED_SOURCES: readonly string[] = TRANSCRIPT_ENABLED_SOURCES
  .filter((id) => TRANSCRIPT_SOURCES[id] === "public-feed");

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
