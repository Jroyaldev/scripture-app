/**
 * Where an episode discusses a passage, and in what way.
 *
 * These replace the anchors that preceded them. Anchors were guessed by
 * comparing embeddings numerically, which cannot distinguish two passages that
 * merely feel alike — a moment about fire falling on Carmel scored the same as
 * one about fire at Sinai, because nothing in a vector knows that one says Baal
 * and the other says calf. These are read out of the transcript instead, so the
 * distinction is available.
 *
 * The relation is the part that matters and the part anchors could not carry:
 *
 *   subject   the speakers are working through this passage here
 *   crossref  brought in to illuminate a different passage that is the subject
 *   mention   named in passing, no engagement
 *   allusion  unmistakably this passage, never named aloud
 *
 * Those are different claims and a reader wants them told apart. "This episode
 * works through Genesis 19" and "Genesis 19 comes up at 39:15" are both worth
 * saying; collapsing them into one list of hits says neither.
 *
 * `seconds` is how long the discussion runs, which is what separates a passing
 * turn of phrase from a treatment. Without it, ranking between them would be
 * arbitrary — measured across the corpus, a subject runs about eighty seconds
 * against ten for a mention.
 */

export type ReferenceRelation = "subject" | "crossref" | "mention" | "allusion";

export interface PassageReference {
  /** Canonical bref, so a press can reach the reading canvas. */
  bref: string;
  book: string;
  chapter: number;
  /** Verses within the chapter, as spoken — "17", "1-4", "8-9,16-17". */
  verses: string | null;
  /** Human label — "Genesis 19", or "Matthew 5:17-20" where verses are known. */
  title: string;
  /** Seconds from the start of the episode. */
  at: number;
  /** How long the discussion runs. Zero for a single remark. */
  seconds: number;
  relation: ReferenceRelation;
  /** True when a speaker says the book name aloud; false for allusions. */
  named: boolean;
  /** How many separate times this passage comes up. */
  times: number;
  /**
   * A short verbatim fragment showing why this entry exists.
   *
   * The one field carrying the publisher's own words, and the reason it is here
   * is that a reader who can see the basis of a claim can dismiss a wrong one in
   * a glance. An unexplained reference asks to be believed; an explained one
   * can be checked.
   */
  evidence: string;
}

export interface ReferenceSet {
  schema: "references/v1";
  generated: true;
  method: string;
  id: string;
  references: PassageReference[];
}

export type ReferenceResult =
  | { ok: true; references: ReferenceSet }
  | { ok: false; reason: "absent" | "unreadable" | "refused" | "ungranted" };

const RELATIONS = new Set<string>(["subject", "crossref", "mention", "allusion"]);

function isReference(value: unknown): value is PassageReference {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return typeof r["bref"] === "string" && r["bref"].startsWith("bref:v1/")
    && typeof r["title"] === "string" && r["title"].length > 0
    && typeof r["at"] === "number" && Number.isFinite(r["at"]) && r["at"] >= 0
    && typeof r["seconds"] === "number" && Number.isFinite(r["seconds"]) && r["seconds"] >= 0
    && typeof r["relation"] === "string" && RELATIONS.has(r["relation"]);
}

/**
 * Fails closed, and drops anything it does not recognise rather than trusting
 * the file. An unknown relation reaching a reader would be a claim of a kind
 * nothing here knows how to describe, which is worse than a missing entry.
 */
export function readReferences(parsed: unknown, fallbackId: string): ReferenceResult {
  if (typeof parsed !== "object" || parsed === null) return { ok: false, reason: "refused" };
  const candidate = parsed as Record<string, unknown>;
  if (candidate["schema"] !== "references/v1") return { ok: false, reason: "refused" };
  if (candidate["generated"] !== true) return { ok: false, reason: "refused" };

  const raw = Array.isArray(candidate["references"]) ? candidate["references"] : [];
  const references = raw.filter(isReference);
  if (references.length === 0) return { ok: false, reason: "refused" };

  return {
    ok: true,
    references: {
      schema: "references/v1",
      generated: true,
      method: typeof candidate["method"] === "string" ? candidate["method"] : "unknown",
      id: typeof candidate["id"] === "string" ? candidate["id"] : fallbackId,
      /* Sorted here rather than trusted: consumers find the active span by
         scanning for the last start at or before the playhead, which selects
         the wrong one silently if the order is off. */
      references: [...references].sort((a, b) => a.at - b.at),
    },
  };
}

/** What the episode works through, longest treatment first. */
export function subjectsOf(set: ReferenceSet): PassageReference[] {
  return set.references.filter((r) => r.relation === "subject")
    .sort((a, b) => b.seconds - a.seconds || a.at - b.at);
}

/** Everything else, in the order it comes up. */
export function passingIn(set: ReferenceSet): PassageReference[] {
  return set.references.filter((r) => r.relation !== "subject");
}
