/**
 * The AUDIO catalogue — every episode a publisher has, not every episode whose
 * title happened to name a passage.
 *
 * ── THE DISTINCTION THIS FILE EXISTS FOR ────────────────────────────────────
 *
 * `manifest.json` and `episodes.json` sit side by side in every feed-imported
 * publisher's directory and they are NOT the same list. The manifest is the
 * card catalogue: a record cannot exist in it without `brefs`, because a card
 * that claims no passage has nothing to rank on. `episodes.json` is the audio
 * catalogue: every episode with a file behind it.
 *
 * docs/onboarding-a-podcast.md warns that conflating them "loses episodes
 * silently", and on 2026-08-02 that is exactly what happened — on a listening
 * page, of all places. `trustedResources.catalogue()` reports manifest counts,
 * which is right for the margin it was written for and badly wrong for a room
 * about audio. It drew Radically Christian as ELEVEN episodes when the library
 * holds 301, Ask N.T. Wright as ZERO against 318, and 5 Minutes in Church
 * History as THREE against 676 — because those publishers title topically and
 * the passage comes from listening rather than from the title.
 *
 * The reader caught it, and named the symptom precisely: the same "11" the
 * main branch's curated manifest shows. One number, two causes, and this is
 * the one a listening room must never read.
 *
 * So: a loader of its own, over the audio catalogue, gated the same way the
 * transcripts are. The margin keeps its manifest; the room gets the records.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { readFileSyncInterruptible } from "./exec-sync.js";
import { isTranscriptEnabledSource } from "../core/transcripts.js";

export interface AudioCatalogueEpisode {
  recordId: string;
  title: string;
  audioUrl: string;
  officialUrl: string | null;
  publishedAt: string | null;
  durationSeconds: number | null;
  /** The publisher's own line, where the feed gave one. Plain text, optional. */
  summary?: string;
}

export interface AudioCatalogueSeries {
  sourceId: string;
  episodes: AudioCatalogueEpisode[];
}

export type AudioCatalogueResult =
  | { ok: true; series: AudioCatalogueSeries[] }
  | { ok: false; reason: "refused" };

interface RawEpisode {
  id?: unknown; title?: unknown; audioUrl?: unknown;
  officialUrl?: unknown; publishedAt?: unknown; durationSeconds?: unknown;
  summary?: unknown;
}

/** Long enough to be worth a row, short enough not to become the row. */
const SUMMARY_MAX = 300;

const str = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

/**
 * Read one publisher's audio catalogue.
 *
 * Gated on the transcript grant rather than a list of its own, for the reason
 * the references loader gives: a source the app may not carry is a source
 * whose episodes it may not enumerate either, and one gate that everything
 * passes through cannot drift out of step with a second.
 *
 * An episode without a playable URL is dropped rather than returned empty —
 * a row that cannot be pressed is worse than a row that is not there.
 */
export function loadAudioCatalogue(
  libraryPath: string,
  sourceIds: readonly string[],
): AudioCatalogueResult {
  const series: AudioCatalogueSeries[] = [];
  for (const sourceId of sourceIds) {
    if (!isTranscriptEnabledSource(sourceId)) continue;
    const path = join(libraryPath, ".artifacts", "resources", sourceId, "episodes.json");
    if (!existsSync(path)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSyncInterruptible(path, "utf-8")) as unknown;
    } catch {
      /* A catalogue that will not parse is a catalogue this publisher does not
         have today. The room draws what it can and says nothing about it. */
      continue;
    }
    const rows: RawEpisode[] = Array.isArray(parsed)
      ? (parsed as RawEpisode[])
      : ((parsed as { episodes?: RawEpisode[] } | null)?.episodes ?? []);

    const episodes: AudioCatalogueEpisode[] = [];
    for (const row of rows) {
      const recordId = str(row.id);
      const audioUrl = str(row.audioUrl);
      const title = str(row.title);
      if (!recordId || !audioUrl || !title) continue;
      episodes.push({
        recordId,
        title,
        audioUrl,
        officialUrl: str(row.officialUrl),
        publishedAt: str(row.publishedAt),
        durationSeconds: typeof row.durationSeconds === "number" && Number.isFinite(row.durationSeconds)
          ? row.durationSeconds
          : null,
        /* Trimmed HERE rather than where it is drawn, so a catalogue holding a
           publisher's whole three-thousand-word show notes does not send three
           thousand words over the IPC for a row that shows one line of them. */
        ...(str(row.summary) ? { summary: (row.summary as string).slice(0, SUMMARY_MAX) } : {}),
      });
    }
    if (episodes.length > 0) series.push({ sourceId, episodes });
  }
  return { ok: true, series };
}
