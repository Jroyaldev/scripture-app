/**
 * What belongs in the reader's library — publisher by publisher, kind by kind.
 *
 * This is a preference, not a filter, and the difference is the whole design.
 * A filter answers "what am I looking at right now" and should forget; this
 * answers "what do I want to hear from at all" and must not. So it never wears
 * a passage count: the numbers here are what the library holds, which is the
 * fact that does not change as the reader moves.
 *
 * It is a matrix in substance and a list in form. A grid of every publisher
 * against every kind would be thirty cells of which a dozen exist, and drawing
 * emptiness is not rigour. Each publisher shows the kinds it actually holds.
 */

import type React from "react";
import { useCallback } from "react";
import { safeCall } from "../utils/safeCall.js";

export interface ResourceLibraryKind {
  kind: string;
  records: number;
  muted: boolean;
}

export interface ResourceLibrarySource {
  id: string;
  name: string;
  homepageUrl: string;
  records: number;
  muted: boolean;
  kinds: ResourceLibraryKind[];
}

export interface ResourceLibraryCatalogue {
  sources: ResourceLibrarySource[];
  mutes: string[];
}

/** A mark per kind. Line art at 12px, because a filled glyph this small is a blob. */
export function ResourceKindIcon({ kind }: { kind: string }): React.JSX.Element {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.4,
  };
  const marks: Record<string, React.JSX.Element> = {
    podcast: <g {...common}><rect x="5.6" y="1.6" width="4.8" height="8" rx="2.4" /><path d="M3.2 7.2a4.8 4.8 0 0 0 9.6 0M8 11.6v2.8" /></g>,
    video: <g {...common}><rect x="1.6" y="3.2" width="12.8" height="9.6" rx="2" /><path d="M6.6 6.4 10 8l-3.4 1.6z" /></g>,
    article: <g {...common}><rect x="2.8" y="1.8" width="10.4" height="12.4" rx="1.6" /><path d="M5.4 5.4h5.2M5.4 8h5.2M5.4 10.6h3.2" /></g>,
    commentary: <g {...common}><path d="M8 4.2S6.4 2.6 4 2.6c-1 0-1.6.2-1.6.2v9s.6-.2 1.6-.2c2.4 0 4 1.6 4 1.6s1.6-1.6 4-1.6c1 0 1.6.2 1.6.2v-9s-.6-.2-1.6-.2c-2.4 0-4 1.6-4 1.6zM8 4.2v9.2" /></g>,
    sermon: <g {...common}><path d="M4 13.4h8M8 13.4V6M4.4 6h7.2L8 2.2z" /></g>,
    guide: <g {...common}><path d="M2.6 3.4 6 2.2l4 1.4 3.4-1.2v10L10 13.6 6 12.2l-3.4 1.2z" /><path d="M6 2.2v10M10 3.6v10" /></g>,
  };
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" className="resource-kind-icon">
      {marks[kind] ?? <g {...common}><circle cx="8" cy="8" r="5.4" /></g>}
    </svg>
  );
}

export function countMutedRules(catalogue: ResourceLibraryCatalogue | null): number {
  return catalogue?.mutes.length ?? 0;
}

export function ResourceLibraryMatrix({
  catalogue,
  onChanged,
  onFailed,
}: {
  catalogue: ResourceLibraryCatalogue | null;
  onChanged: () => void;
  onFailed: (message: string) => void;
}): React.JSX.Element {
  /* Written straight to settings, which the main process consults on every
     query. Nothing here keeps its own copy of the answer. */
  const save = useCallback(async (mutes: string[]): Promise<void> => {
    const saved = await safeCall(() => window.api.settings.set({ resourceMutes: mutes }));
    if (!saved.ok) {
      onFailed("That preference could not be saved.");
      return;
    }
    onChanged();
  }, [onChanged, onFailed]);

  if (!catalogue) return <p className="resource-matrix-status">Reading your library…</p>;
  if (catalogue.sources.length === 0) {
    return <p className="resource-matrix-status">No publishers are installed yet.</p>;
  }

  const mutes = new Set(catalogue.mutes);

  /* Muting a publisher outright supersedes its per-kind rules rather than
     sitting alongside them, so turning one back on cannot restore a state the
     reader has no memory of setting. */
  const toggleSource = (source: ResourceLibrarySource): void => {
    const next = new Set(mutes);
    if (source.muted) {
      next.delete(source.id);
    } else {
      next.add(source.id);
      for (const kind of source.kinds) next.delete(`${source.id}:${kind.kind}`);
    }
    void save([...next]);
  };

  const toggleKind = (source: ResourceLibrarySource, kind: ResourceLibraryKind): void => {
    const next = new Set(mutes);
    const rule = `${source.id}:${kind.kind}`;
    if (source.muted) {
      /* Reaching for one kind of a silenced publisher means "this one, please":
         lift the publisher and mute its other kinds, rather than doing nothing
         and leaving the reader tapping a dead control. */
      next.delete(source.id);
      for (const other of source.kinds) {
        if (other.kind !== kind.kind) next.add(`${source.id}:${other.kind}`);
      }
      next.delete(rule);
    } else if (next.has(rule)) {
      next.delete(rule);
    } else {
      next.add(rule);
      const silenced = source.kinds.every((other) => other.kind === kind.kind || next.has(`${source.id}:${other.kind}`));
      if (silenced) {
        // Every kind muted one by one is a muted publisher; say so plainly.
        for (const other of source.kinds) next.delete(`${source.id}:${other.kind}`);
        next.add(source.id);
      }
    }
    void save([...next]);
  };

  return (
    <div className="resource-matrix">
      {catalogue.sources.map((source) => (
        <div className="resource-matrix-row" data-muted={source.muted} data-source={source.id} key={source.id}>
          <button
            aria-pressed={!source.muted}
            className="resource-matrix-publisher"
            onClick={() => toggleSource(source)}
            type="button"
          >
            <span className="resource-matrix-rail" aria-hidden="true" />
            <span className="resource-matrix-name">{source.name}</span>
            <span className="resource-matrix-total">{source.records.toLocaleString()}</span>
          </button>
          <div className="resource-matrix-kinds">
            {source.kinds.map((kind) => (
              <button
                aria-label={`${kind.kind} from ${source.name} — ${kind.records.toLocaleString()} in your library`}
                aria-pressed={!kind.muted}
                className="resource-matrix-kind"
                key={kind.kind}
                onClick={() => toggleKind(source, kind)}
                type="button"
              >
                <ResourceKindIcon kind={kind.kind} />
                <span className="resource-matrix-kind-name">{kind.kind}</span>
                <span className="resource-matrix-kind-count">{kind.records.toLocaleString()}</span>
              </button>
            ))}
          </div>
        </div>
      ))}

      {mutes.size > 0 && (
        <button className="resource-matrix-reset" onClick={() => void save([])} type="button">
          Turn everything back on
        </button>
      )}
    </div>
  );
}
