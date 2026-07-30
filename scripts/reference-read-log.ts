/**
 * Which episodes the reference extractor has already read.
 *
 * Split out of `extract-refs-codex.ts` so the one decision that costs money —
 * send this episode to Codex again, or not — can be tested without spawning
 * anything. Pure by construction: text in, decision out, no filesystem.
 *
 * WHY A LEDGER RATHER THAN THE OUTPUT FILE
 *
 * Resume used to be reconstructed from the output rows alone: every `recordId`
 * appearing in a reference was taken as an episode already read. That works
 * for an episode that yielded references and fails silently for one that did
 * not, because an episode with no references writes no row and so leaves no
 * trace of ever having been read.
 *
 * The 2026-07-30 sweep measured the cost: 3,521 transcripts on disk, 3,208
 * episodes with at least one reference, and therefore 313 episodes that were
 * paid for and then forgotten — about 309 wasted calls in one pass, for 22
 * marginal references. Nearly all of them are short-form shows where an
 * episode simply discusses no passage, which is a true answer, not a failure.
 *
 * So the ledger is kept beside the output rather than inferred from it, and it
 * records the question that was actually asked ("was this episode read?")
 * instead of a proxy for it ("did this episode produce anything?").
 *
 * WHY BESIDE, NOT INSIDE
 *
 * A sentinel row inside the `.jsonl` would also work and would need no second
 * file. It was not taken, for two reasons:
 *
 *   The output file has one shape and every field in it is checked on the way
 *   in. A row that is not a reference would be the first exception to that,
 *   and every consumer — `install-references.ts` today, whatever reads these
 *   next — would have to learn to ignore it or quietly miscount. Row counts
 *   are quoted as reference counts all over the operational notes.
 *
 *   The install step is `cat codex-refs-*.jsonl > combined`. The ledger must
 *   not be swept into that, which is why it is named `.read-log.json` and not
 *   `.jsonl` — the glob that collects references cannot collect it by accident.
 *
 * A RESUME MUST NEVER SHRINK
 *
 * The ledger is the union of what it says and what the rows prove, never just
 * the ledger. An output file written before this existed has no ledger at all,
 * and reading its rows is the only thing that keeps those episodes done — so
 * the first pass after the upgrade seeds the ledger from them rather than
 * starting empty. The reverse case matters too: a ledger entry survives even
 * if its rows were later filtered out of the output by hand, because it was
 * still read and still cost a call.
 */

export const READ_LOG_SCHEMA = "reference-read-log/v1";

export interface ReadLog {
  schema: typeof READ_LOG_SCHEMA;
  /** The publisher whose episodes this ledger covers. */
  source: string;
  /** Basename of the output file it belongs to, so a stray copy can be placed. */
  out: string;
  /** Record ids read, sorted, one per episode. */
  episodes: string[];
}

export interface ResumeState {
  /**
   * Rows from earlier passes. Carried rather than merely skipped because the
   * output file is rewritten whole after every episode.
   */
  carried: Array<Record<string, unknown>>;
  /** Every episode that must not be sent to Codex again. */
  alreadyRead: Set<string>;
  /** How many of those are known only from the ledger — read, yielded nothing. */
  barren: number;
  /**
   * A ledger file was present and could not be understood. Not fatal: the run
   * falls back to the rows, which is exactly the old behaviour. Worth saying
   * out loud, because the cost is a few hundred repeated calls rather than
   * anything wrong in the data.
   */
  unreadableLog: boolean;
}

/**
 * Where the ledger for an output file lives.
 *
 * `.jsonl` is replaced rather than appended to, so the result cannot match the
 * `codex-refs-*.jsonl` glob the install step uses to gather references.
 */
export function readLogPathFor(outPath: string): string {
  return `${outPath.replace(/\.jsonl$/i, "")}.read-log.json`;
}

/**
 * The record ids a ledger names, or null if the text is not a ledger.
 *
 * Null rather than an empty list, and null rather than a throw: the caller has
 * to tell "no episodes recorded" from "this file is not what I thought", and a
 * ledger truncated by a killed run should cost repeated work rather than the
 * whole run.
 */
export function parseReadLog(text: string): string[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const log = parsed as Partial<ReadLog>;
  if (log.schema !== READ_LOG_SCHEMA || !Array.isArray(log.episodes)) return null;
  return log.episodes.filter((id): id is string => typeof id === "string" && id.length > 0);
}

/** The ledger as it goes to disk. Sorted, so a diff between passes is readable. */
export function serializeReadLog(source: string, outPath: string, episodes: Iterable<string>): string {
  const log: ReadLog = {
    schema: READ_LOG_SCHEMA,
    source,
    out: outPath.split("/").pop() ?? outPath,
    episodes: [...episodes].sort(),
  };
  return `${JSON.stringify(log, null, 2)}\n`;
}

/**
 * What a previous pass leaves behind, from the two files that hold it.
 *
 * `rows` is the output `.jsonl`, `log` is the ledger beside it or null when
 * there is none. Both empty is a first run; rows without a ledger is an output
 * written before this existed.
 */
export function resumeFrom(input: { rows: string; log: string | null }): ResumeState {
  const carried: Array<Record<string, unknown>> = [];
  const fromRows = new Set<string>();
  for (const line of input.rows.split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as Record<string, unknown>;
      carried.push(row);
      if (typeof row["recordId"] === "string") fromRows.add(row["recordId"]);
    } catch { /* a partial last line from a killed run */ }
  }

  const recorded = input.log === null ? [] : parseReadLog(input.log);
  const alreadyRead = new Set(fromRows);
  for (const id of recorded ?? []) alreadyRead.add(id);

  return {
    carried,
    alreadyRead,
    barren: alreadyRead.size - fromRows.size,
    unreadableLog: input.log !== null && recorded === null,
  };
}

/** A run told to forget everything. Kept here so `--restart` means one thing. */
export function emptyResume(): ResumeState {
  return { carried: [], alreadyRead: new Set(), barren: 0, unreadableLog: false };
}
