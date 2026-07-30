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

import { isTranscriptEnabledSource, transcriptBasis } from "./transcripts.js";
import type { TranscriptBasis } from "./transcripts.js";
import type { ReferenceRelation } from "./references.js";

/**
 * A moment as the artifact stores it — everything that came off disk.
 *
 * Split from `PassageMoment` because the footing is NOT in the file and must
 * never be read from one: an artifact is something anything can write, and a
 * publisher's basis is a fact about a conversation we did or did not have.
 * It is attached here, from `TRANSCRIPT_SOURCES`, on the way past.
 */
export interface StoredMoment {
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
  /**
   * The verses within the chapter, as spoken — "17", "1-4", "8-9,16-17".
   * Null where the discussion was of the chapter rather than a part of it,
   * which is about a quarter of them.
   */
  verses: string | null;
  /** The passage as the episode framed it — "Romans 8:1-11". */
  title: string;
}

/**
 * A moment as a surface receives it: the stored facts, plus the footing the
 * publisher is on.
 *
 * `basis` exists here because 48% of what this index surfaces comes from
 * publishers nobody has asked yet, and until this build the only place that
 * distinction was visible was a TypeScript literal and a test.
 * `docs/trusted-resource-permissions.md` says "the distinction must stay
 * visible"; a fact that never leaves the module it is declared in is not
 * visible, so it travels with the moment to the surface that draws it.
 *
 * It is a label and nothing else. It does not gate — the gate is
 * `isTranscriptEnabledSource`, and it treats both footings alike on purpose —
 * and it does not rank.
 */
export interface PassageMoment extends StoredMoment {
  basis: TranscriptBasis;
}

/**
 * Does this moment's verse range touch the verse a reader is on?
 *
 * A moment with no range covers the whole chapter and therefore touches every
 * verse in it. That is not a fallback — an episode working through Romans 8 as
 * a unit genuinely bears on verse 28, and treating "no range" as "no match"
 * would hide the longest treatments from every verse.
 */
/** First and last verse a range touches — "8-9,16-17" spans 8 to 17. */
export function verseSpan(verses: string | null): { from: number; to: number } | null {
  if (!verses) return null;
  let from = Infinity;
  let to = -Infinity;
  for (const part of verses.split(",")) {
    const [a, b] = part.split("-").map((n) => Number.parseInt(n.trim(), 10));
    if (!Number.isFinite(a)) continue;
    from = Math.min(from, a!);
    to = Math.max(to, Number.isFinite(b) ? b! : a!);
  }
  return Number.isFinite(from) ? { from, to } : null;
}

/** How close a moment sits to the verse in hand. */
export type Proximity = "on" | "chapter" | "whole";

/**
 * How far a moment's range sits from the verse, in verses. Zero when it
 * contains it.
 */
export function distanceFrom(moment: StoredMoment, verse: number | null): number {
  const span = verseSpan(moment.verses);
  if (!span || verse == null) return Number.POSITIVE_INFINITY;
  if (verse >= span.from && verse <= span.to) return 0;
  return verse < span.from ? span.from - verse : verse - span.to;
}

/**
 * "On this passage" means ON it — the range contains the verse, and nothing
 * else qualifies.
 *
 * An earlier version admitted anything within five verses, on the theory that
 * a paragraph is about that long. Selecting Romans 8:8 then offered a
 * discussion of 8:1-4 under a heading promising the passage in hand, which is
 * a heading making a claim the entry does not meet. Five verses is also not one
 * thought here: 8:1-4 and 8:5-8 are different arguments.
 *
 * Nearness did not stop mattering — it decides the order of everything that is
 * not on the verse. It just cannot buy membership in a group whose name says
 * otherwise.
 */
export function proximityOf(moment: StoredMoment, verse: number | null): Proximity {
  const span = verseSpan(moment.verses);
  /* No range means the episode took the chapter as a unit, which is a
     different offer from one that happens to land elsewhere in it — and often
     the better one. It gets its own band rather than being sorted among the
     misses. */
  if (!span) return "whole";
  if (verse == null) return "chapter";
  return distanceFrom(moment, verse) === 0 ? "on" : "chapter";
}

export function touchesVerse(moment: StoredMoment, verse: number | null): boolean {
  if (verse == null || !moment.verses) return true;
  for (const part of moment.verses.split(",")) {
    const [from, to] = part.split("-").map((n) => Number.parseInt(n.trim(), 10));
    if (!Number.isFinite(from)) continue;
    if (verse >= from! && verse <= (Number.isFinite(to) ? to! : from!)) return true;
  }
  return false;
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

function isMoment(value: unknown): value is StoredMoment {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Record<string, unknown>;
  return typeof m["id"] === "string" && m["id"].length > 0
    && typeof m["at"] === "number" && Number.isFinite(m["at"]) && m["at"] >= 0
    && typeof m["seconds"] === "number" && Number.isFinite(m["seconds"]) && m["seconds"] >= 0
    && typeof m["relation"] === "string" && RELATIONS.has(m["relation"])
    && typeof m["title"] === "string" && typeof m["episode"] === "string"
    && (m["verses"] === null || typeof m["verses"] === "string")
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
      .filter((m) => isTranscriptEnabledSource(m.id))
      /* The footing is attached here, from the map, rather than read from the
         file — see PassageMoment. `isTranscriptEnabledSource` has already
         passed, so the lookup cannot miss; the fallback exists so a future
         source added to one list and not the other fails as a public feed
         rather than as a grant. */
      .map((m): PassageMoment => ({ ...m, basis: transcriptBasis(m.id) ?? "public-feed" }))
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
export function momentsFor(
  index: PassageIndex,
  book: string,
  chapter: number,
  mutes: readonly string[] = [],
  verse: number | null = null,
): PassageMoment[] {
  let found = index.index.find((e) => e.book === book && e.chapter === chapter)?.moments ?? [];
  if (verse != null) {
    /* Banded, not filtered. A verse with nothing said about it specifically
       must still show the chapter's real treatments, or selecting a line would
       empty a list that was full a moment earlier and read as a fault. Order
       within each band is unchanged — longest first. */
    const order: Proximity[] = ["on", "whole", "chapter"];
    found = [...found].sort((a, b) => {
      const rank = order.indexOf(proximityOf(a, verse)) - order.indexOf(proximityOf(b, verse));
      if (rank !== 0) return rank;
      /* Within everything that is not on the verse, nearness leads and length
         breaks the tie. Ordering that group by length alone put a discussion
         four verses away above one immediately adjacent, on the strength of a
         single extra minute. */
      const near = distanceFrom(a, verse) - distanceFrom(b, verse);
      return near !== 0 ? near : b.seconds - a.seconds;
    });
  }
  if (mutes.length === 0) return found;
  /* The same rule shape the resource query uses — a source id, or source:kind.
     Applied identically here because a reader who switched a publisher off
     switched it off; a second list still showing them would read as the
     setting not working rather than as two lists with two policies. */
  const muted = new Set(mutes);
  return found.filter((m) => !muted.has(m.sourceId) && !muted.has(`${m.sourceId}:${m.kind}`));
}
