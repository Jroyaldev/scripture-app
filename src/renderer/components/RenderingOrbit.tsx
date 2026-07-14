/**
 * Rendering Orbit — condensed circular map of how a lemma is glossed
 * across the corpus. Shepherdly visual language (not a Logos clone).
 */

import React, { useMemo, useState } from "react";
import type { LanguageRenderingOrbit } from "../api.js";

const PALETTE = [
  "#6B9AC4",
  "#C4A35A",
  "#7BAE7F",
  "#C47B8A",
  "#8B7EC8",
  "#5FA8A0",
  "#C48B5A",
  "#7A8B9A",
  "#8A8A8A",
];

function donutPath(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  a0: number,
  a1: number,
): string {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const x0 = cx + rOuter * Math.sin(a0);
  const y0 = cy - rOuter * Math.cos(a0);
  const x1 = cx + rOuter * Math.sin(a1);
  const y1 = cy - rOuter * Math.cos(a1);
  const x2 = cx + rInner * Math.sin(a1);
  const y2 = cy - rInner * Math.cos(a1);
  const x3 = cx + rInner * Math.sin(a0);
  const y3 = cy - rInner * Math.cos(a0);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${rOuter} ${rOuter} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} L ${x2.toFixed(2)} ${y2.toFixed(2)} A ${rInner} ${rInner} 0 ${large} 0 ${x3.toFixed(2)} ${y3.toFixed(2)} Z`;
}

type Props = {
  orbit: LanguageRenderingOrbit;
  /** Greek/Hebrew surface for center label. */
  surface?: string;
  dir?: "ltr" | "rtl";
  lang?: string;
};

export function RenderingOrbitView({
  orbit,
  surface,
  dir = "ltr",
}: Props): React.JSX.Element {
  const [hover, setHover] = useState<number | null>(null);
  const size = 148;
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = 64;
  const rInner = 36;

  const arcs = useMemo(() => {
    let angle = 0;
    return orbit.segments.map((seg, i) => {
      const sweep = Math.max(seg.share, 0.01) * Math.PI * 2;
      // tiny gap between segments
      const gap = orbit.segments.length > 1 ? 0.02 : 0;
      const a0 = angle + gap / 2;
      const a1 = angle + sweep - gap / 2;
      angle += sweep;
      return { seg, i, a0, a1, path: donutPath(cx, cy, rOuter, rInner, a0, Math.max(a1, a0 + 0.04)) };
    });
  }, [orbit.segments, cx, cy]);

  const active = hover !== null ? orbit.segments[hover] : orbit.segments.find((s) => s.isCurrent) ?? orbit.segments[0];
  const centerTop = surface?.slice(0, 12) ?? orbit.lemma.slice(0, 14);
  const pct = active ? Math.round(active.share * 100) : 0;

  return (
    <div className="lang-orbit">
      <div className="lang-orbit-kicker">
        <span className="lang-orbit-kind">Rendering orbit</span>
        <span className="lang-orbit-count">{orbit.total} glossed</span>
      </div>
      <div className="lang-orbit-body">
        <svg
          className="lang-orbit-svg"
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label={`Rendering orbit for ${orbit.lemma}`}
        >
          <circle cx={cx} cy={cy} r={rOuter + 2} className="lang-orbit-halo" />
          {arcs.map(({ seg, i, path }) => (
            <path
              key={`${seg.label}-${i}`}
              d={path}
              fill={PALETTE[i % PALETTE.length]}
              className={`lang-orbit-seg${seg.isCurrent ? " is-current" : ""}${hover === i ? " is-hover" : ""}`}
              opacity={hover === null || hover === i ? 1 : 0.45}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              <title>
                {seg.label}: {seg.count}× ({Math.round(seg.share * 100)}%)
              </title>
            </path>
          ))}
          <circle cx={cx} cy={cy} r={rInner - 1} className="lang-orbit-hub" />
          <text
            x={cx}
            y={cy - 4}
            textAnchor="middle"
            className="lang-orbit-hub-lemma"
            style={{ direction: dir }}
          >
            {centerTop}
          </text>
          <text x={cx} y={cy + 12} textAnchor="middle" className="lang-orbit-hub-meta">
            {orbit.strongPrefixed ?? `${orbit.lemmaCount}×`}
          </text>
        </svg>
        <div className="lang-orbit-legend">
          {orbit.segments.map((seg, i) => (
            <button
              key={`${seg.label}-${i}`}
              type="button"
              className={`lang-orbit-row${seg.isCurrent ? " is-current" : ""}${hover === i ? " is-hover" : ""}`}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              <span
                className="lang-orbit-swatch"
                style={{ background: PALETTE[i % PALETTE.length] }}
              />
              <span className="lang-orbit-label">{seg.label}</span>
              <span className="lang-orbit-meta">
                {seg.count}× · {Math.round(seg.share * 100)}%
              </span>
            </button>
          ))}
          {active && (
            <p className="lang-orbit-focus" aria-live="polite">
              <strong>{active.label}</strong> — {pct}% of glossed hits
              {active.isCurrent ? " · this verse" : ""}
            </p>
          )}
        </div>
      </div>
      <p className="lang-orbit-attr">
        {orbit.source === "package-gloss"
          ? "Corpus gloss map · package data"
          : "Lexicon gloss · single rendering"}
      </p>
    </div>
  );
}
