/**
 * The AUDIO catalogue's shape — shared, because both sides of the IPC need it.
 *
 * It lives in core rather than beside its loader for the reason the renderer's
 * tsconfig enforces: a type the renderer imports from `src/host` drags the
 * host's node imports into the renderer's typecheck, and the layering that
 * prevents is the same layering that keeps `fs` out of the window.
 *
 * WHAT THIS IS NOT is written where the loader is: an audio catalogue is every
 * episode a publisher has, and the manifest the margin reads is only those
 * whose title named a passage. See src/host/audio-catalogue-loader.ts.
 */

export interface AudioCatalogueEpisode {
  recordId: string;
  title: string;
  audioUrl: string;
  officialUrl: string | null;
  publishedAt: string | null;
  durationSeconds: number | null;
  /**
   * The publisher's own line about this episode, where the feed gave one.
   *
   * OPTIONAL, and it stays optional. A catalogue built before this field
   * existed carries none, and a publisher who writes no show notes never will
   * — a row without one draws exactly as it always did. Plain text by the time
   * it reaches here: feeds put HTML in these, and the room is not a place that
   * renders a publisher's markup.
   */
  summary?: string;
}

export interface AudioCatalogueSeries {
  sourceId: string;
  episodes: AudioCatalogueEpisode[];
}

export type AudioCatalogueResult =
  | { ok: true; series: AudioCatalogueSeries[] }
  | { ok: false; reason: "refused" };

/**
 * IS THIS THE EPISODE THAT IS PLAYING?
 *
 * An episode's identity ACROSS surfaces is its source and its record. It is
 * NOT `episode.id`, which every surface builds for its own list keys and
 * builds differently: the margin hands over `entry.key`, the Listen room
 * composes `sourceId:recordId`, and both are correct locally.
 *
 * That difference was a real bug. Press play on the reading page, walk to the
 * Listen room, and nothing was marked — no tinted row, no moving bars — because
 * the room was comparing its own key against the margin's. The same episode,
 * unrecognised, purely because two surfaces name their rows differently.
 *
 * `recordId` is the publisher's own episode id and is identical in
 * `manifest.json` and `episodes.json`, so this holds for an episode reached
 * from any surface, before or after a restart.
 */
export function sameEpisode(
  playing: { sourceId: string; recordId: string } | null | undefined,
  sourceId: string,
  recordId: string,
): boolean {
  if (!playing) return false;
  return playing.sourceId === sourceId && playing.recordId === recordId;
}
