/**
 * One provenance disclosure for every study surface: a quiet "Sources"
 * details element with per-source citation copy. Used by the Living Margin
 * blocks and the original-language cards so citations read (and copy)
 * identically everywhere.
 */
import type React from "react";
import { useToast } from "./Toast.js";

export interface CitationSource {
  name: string;
  license: string;
  detail?: string;
  citation?: string;
}

export function formatSourceCitation(source: CitationSource): string {
  return source.citation?.trim()
    || [source.name, source.license, source.detail].filter(Boolean).join(" · ");
}

export function SourcesDisclosure({
  sources,
  className = "",
}: {
  sources: CitationSource[];
  className?: string;
}): React.JSX.Element | null {
  const { showToast } = useToast();
  if (sources.length === 0) return null;
  const copyCitation = async (source: CitationSource): Promise<void> => {
    try {
      await navigator.clipboard.writeText(formatSourceCitation(source));
      showToast("Citation copied.", undefined, undefined, { tone: "success" });
    } catch {
      showToast("The citation could not be copied.", undefined, undefined, { tone: "error" });
    }
  };
  return (
    <details className={`margin-sources${className ? ` ${className}` : ""}`}>
      <summary>Sources</summary>
      <div className="margin-source-list">
        {sources.map((source) => (
          <div className="margin-source-row" key={`${source.name}-${source.license}-${source.detail ?? ""}`}>
            <span className="margin-source-copy">
              <span>{source.name} <span aria-hidden="true">·</span> {source.license}</span>
              {source.detail && <span className="margin-source-detail">{source.detail}</span>}
            </span>
            <button
              type="button"
              className="margin-source-cite"
              aria-label={`Copy citation for ${source.name}`}
              onClick={() => void copyCitation(source)}
            >
              Cite
            </button>
          </div>
        ))}
      </div>
    </details>
  );
}
