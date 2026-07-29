/**
 * For a passage: who has taught it, where, and for how long.
 *
 * The inverse of the per-episode references, and the read that answers the
 * question a reader actually arrives with. Episode → passages is a footnote
 * list on something already chosen; passage → moments is "I am reading Romans
 * 8, who has worked through this".
 *
 * RANKED BY SECONDS, AND BY NOTHING ELSE
 *
 * That is a finding rather than a default. Two publishers with opposite formats
 * were measured — one ranging thematically across scripture, one walking
 * through a passage an episode at a time — and the two obvious alternatives
 * both turned out to describe the publisher rather than the passage:
 *
 *   share of episode   a "subject" occupies 3.1% of an episode on one and
 *                      12.7% on the other. It measures how an episode is made.
 *   relation counts    55% of references are "subject" on one and 11% on the
 *                      other. It measures teaching style.
 *
 * Duration is the quantity that survived: the two corpora's distributions sit
 * almost on top of each other, median 36 seconds against 30. Eleven minutes is
 * eleven minutes whoever made the episode, which is what makes it the only
 * thing safe to order across publishers on.
 *
 * Relation still travels with each moment, because a reader wants to know
 * whether a passage was worked through or glanced at. It labels; it does not
 * rank.
 */

import { isTranscriptApprovedSource } from "./transcripts.js";
import type { ReferenceRelation } from "./references.js";

export interface PassageMoment {
  /** Record id of the episode. */
  id: string;
  /** The episode's own name. */
  episode: string;
  sourceId: string;
  sourceName: string;
  /** Carried so a moment can be pressed, not merely read. */
  audioUrl: string;
  officialUrl: string;
  kind: string;
  /** Seconds from the start of the episode. */
  at: number;
  /** How long the discussion runs. */
  seconds: number;
  relation: ReferenceRelation;
  /** The passage as the episode framed it — "Romans 8:1-11". */
  title: string;
}

export interface PassageEntry {
  bref: string;
  book: string;
  chapter: number;
  moments: PassageMoment[];
}

export interface PassageIndex {
  schema: "passage-index/v1";
  generated: true;
  ranking: string;
  index: PassageEntry[];
}

export type PassageIndexResult =
  | { ok: true; index: PassageIndex }
  | { ok: false; reason: "absent" | "unreadable" | "refused" };

const RELATIONS = new Set<string>(["subject", "crossref", "mention", "allusion"]);

function isMoment(value: unknown): value is PassageMoment {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Record<string, unknown>;
  return typeof m["id"] === "string" && m["id"].length > 0
    && typeof m["at"] === "number" && Number.isFinite(m["at"]) && m["at"] >= 0
    && typeof m["seconds"] === "number" && Number.isFinite(m["seconds"]) && m["seconds"] >= 0
    && typeof m["relation"] === "string" && RELATIONS.has(m["relation"])
    && typeof m["title"] === "string" && typeof m["episode"] === "string"
    /* A moment with no audio cannot be played, and a row that looks pressable
       and is not is worse than one that was never drawn. */
    && typeof m["audioUrl"] === "string" && m["audioUrl"].startsWith("https://")
    && typeof m["sourceId"] === "string" && typeof m["sourceName"] === "string";
}

/**
 * Fails closed, and drops any moment belonging to a publisher who has not
 * granted transcripts.
 *
 * The index is built from granted sources only, so that filter should never
 * fire — which is exactly why it is here. An artifact on disk is a file
 * anything can write, and a grant enforced only at the point the data was
 * created is a grant that a stale or hand-edited file walks straight past.
 */
export function readPassageIndex(parsed: unknown): PassageIndexResult {
  if (typeof parsed !== "object" || parsed === null) return { ok: false, reason: "refused" };
  const candidate = parsed as Record<string, unknown>;
  if (candidate["schema"] !== "passage-index/v1") return { ok: false, reason: "refused" };
  if (candidate["generated"] !== true) return { ok: false, reason: "refused" };

  const raw = Array.isArray(candidate["index"]) ? candidate["index"] : [];
  const index: PassageEntry[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e["bref"] !== "string" || typeof e["book"] !== "string") continue;
    if (typeof e["chapter"] !== "number" || !Number.isFinite(e["chapter"])) continue;
    const moments = (Array.isArray(e["moments"]) ? e["moments"] : [])
      .filter(isMoment)
      .filter((m) => isTranscriptApprovedSource(m.id))
      /* Longest first, established here rather than trusted from the file. */
      .sort((a, b) => b.seconds - a.seconds);
    if (moments.length === 0) continue;
    index.push({ bref: e["bref"], book: e["book"], chapter: e["chapter"], moments });
  }
  if (index.length === 0) return { ok: false, reason: "refused" };

  return {
    ok: true,
    index: { schema: "passage-index/v1", generated: true, ranking: typeof candidate["ranking"] === "string" ? candidate["ranking"] : "seconds", index },
  };
}

/**
 * Moments for a chapter.
 *
 * Deliberately chapter-granular. A reference is recorded against the chapter it
 * belongs to, so asking at verse granularity would return nothing for most
 * verses and give a reader the false impression that nobody teaches them.
 */
export function momentsFor(index: PassageIndex, book: string, chapter: number): PassageMoment[] {
  return index.index.find((e) => e.book === book && e.chapter === chapter)?.moments ?? [];
}
