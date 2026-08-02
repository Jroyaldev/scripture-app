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
}

export interface AudioCatalogueSeries {
  sourceId: string;
  episodes: AudioCatalogueEpisode[];
}

export type AudioCatalogueResult =
  | { ok: true; series: AudioCatalogueSeries[] }
  | { ok: false; reason: "refused" };
