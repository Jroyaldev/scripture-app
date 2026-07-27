/** Matching one publisher's episode titles against another catalogue's. No I/O. */

/**
 * Titles are compared, never displayed, so punctuation and case are noise.
 *
 * One abbreviation is not noise and has to be folded away deliberately: the two
 * catalogues write the same thing as "Question and Response" and as "Q+R".
 * "Exodus: Did God Try to Kill Moses? Question and Response" and "Did God Try
 * To Kill Moses? – Exodus Q+R" are one episode, and without this they share too
 * few words to match by any rule below.
 */
export const fold = (value: string): string =>
  value
    .toLowerCase()
    .normalize("NFKD")
    /* "&" is the word "and", and the catalogues use both — "Story: God & Money"
       against "Story: God and Money". Dropping the ampersand as punctuation left
       those two words apart, and with only "story" and "money" between them
       there was nothing distinctive enough for the fuzzy pass to rescue. */
    .replace(/&/g, " and ")
    .replace(/\bquestions?\s*(?:and|&|\+)\s*responses?\b/g, " qanda ")
    .replace(/\bq\s*(?:and|&|\+)\s*r\b/g, " qanda ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * The two catalogues name the same episode differently, systematically, and in
 * opposite directions. The feed appends the series and its number; the page
 * puts the same thing in front:
 *
 *   feed  "A Cup of Wrath? – Character of God E8"
 *   page  "The Letter of Jude E1: A Family Legacy and a Short Letter"
 *
 * So both sides are reduced to the bare episode name and matched on that.
 * Stripping only the suffix matched 81 episodes of 535; stripping only what the
 * feed does misses every page in a numbered series, which is most of them.
 */
export function titleKeys(title: string): string[] {
  const keys = new Set([fold(title)]);
  /* A trailing series tag, however it is numbered: "– Chaos Dragon E18",
     "- Gospel of Matthew Part 21", "— Top 5: ...". Only a segment that actually
     names a series is removed, so a title whose real subject follows a dash
     keeps it. */
  const withoutSuffix = title
    .replace(/\s+[–—-]\s+[^–—-]{0,60}?\b(?:E\d+|Part\s+\d+|Series|Top\s+\d+)\b[^–—-]{0,30}$/i, "")
    .trim();
  if (withoutSuffix) keys.add(fold(withoutSuffix));
  /* And the same tag with no separator at all: "Is the Gospel an Apocalypse?
     Apocalyptic E3" runs the series straight on after the question mark. Anchored
     to a sentence end so it cannot eat a title that merely ends in a number. */
  const withoutRunOn = title.replace(/(?<=[?!.”"'’])\s+\S[^?!.]{0,40}?\b(?:E\d+|Part\s+\d+|Q\s*[+&]\s*R\s*\d*)\s*$/i, "").trim();
  if (withoutRunOn && withoutRunOn !== title) keys.add(fold(withoutRunOn));
  const withoutPrefix = title.replace(/^.{0,60}?\b(?:E\d+|Part\s+\d+|Q\s*[+&]\s*R|Series)\s*[:–—-]\s*/i, "").trim();
  if (withoutPrefix) keys.add(fold(withoutPrefix));
  /* And a bare series prefix with no number in it — the feed writes "Jude: A
     Family Legacy and a Short Letter" where the page writes "The Letter of Jude
     E1: A Family Legacy and a Short Letter", so neither rule above reaches it.

     What survives the colon has to be distinctive, and length is the wrong test
     for that: "Question and Response" is twenty-one characters and describes a
     dozen episodes. "Numbers: Question and Response" and "The Holy Spirit:
     Question and Response" collapsed onto it and one of them played the other's
     audio. Three substantial words, counted, is the test that catches it. */
  const bare = fold(title.replace(/^[^:]{1,40}:\s*/, "").trim());
  if (bare.split(" ").filter((word) => word.length >= 4).length >= 3) keys.add(bare);
  return [...keys].filter(Boolean);
}

/**
 * Last resort, after every exact key has missed: the same episode described in
 * two vocabularies usually still shares most of its words.
 *
 * Two guards, because this is the one join that can attach the wrong recording
 * to a card. The page's significant words must be almost entirely present in
 * the feed's, and the winner must beat the runner-up clearly — a near-tie is
 * two episodes in a series with near-identical names, which is exactly when
 * guessing is worst. Titles too short to be distinctive do not try at all.
 */
const MIN_CONTAINMENT = 0.8;
const MIN_MARGIN = 0.15;

export function significantWords(title: string): Set<string> {
  return new Set(fold(title).split(" ").filter((word) => word.length >= 4));
}

export function fuzzyMatch<T>(
  title: string,
  candidates: ReadonlyArray<{ words: Set<string>; facts: T }>,
): T | undefined {
  const words = significantWords(title);
  if (words.size < 3) return undefined;
  let best = { score: 0, facts: undefined as T | undefined };
  let runnerUp = 0;
  for (const candidate of candidates) {
    let shared = 0;
    for (const word of words) if (candidate.words.has(word)) shared += 1;
    const score = shared / words.size;
    if (score > best.score) { runnerUp = best.score; best = { score, facts: candidate.facts }; }
    else if (score > runnerUp) runnerUp = score;
  }
  return best.score >= MIN_CONTAINMENT && best.score - runnerUp >= MIN_MARGIN ? best.facts : undefined;
}
