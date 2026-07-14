/**
 * Syntax Art — modern interactive layout of a MACULA sentence tree.
 * Structure from Clear Bible MACULA (CC BY); drawing is Shepherdly.
 */

import React, { useMemo, useState } from "react";
import type { LanguageSyntaxHit, LanguageSyntaxNode } from "../api.js";

type Laid = {
  id: string;
  cat: string;
  x: number;
  y: number;
  w: number;
  h: number;
  isLeaf: boolean;
  isFocus: boolean;
  surface?: string;
  gloss?: string;
  tokenId?: string;
};

type Edge = { x1: number; y1: number; x2: number; y2: number };

const LEAF_W = 52;
const LEAF_H = 34;
const PHRASE_W = 44;
const PHRASE_H = 18;
const H_GAP = 8;
const V_GAP = 32;

function catShort(cat: string): string {
  const c = cat.toLowerCase();
  if (c === "s") return "S";
  if (c === "cl") return "CL";
  if (c === "np" || c === "np") return "np";
  if (c === "vp") return "vp";
  if (c === "pp") return "pp";
  if (c === "p") return "P";
  if (c.length <= 4) return cat;
  return cat.slice(0, 4);
}

function layoutTree(
  root: LanguageSyntaxNode,
  focusTokenId: string,
  maxWidth: number,
): { nodes: Laid[]; edges: Edge[]; width: number; height: number } {
  type M = { n: LanguageSyntaxNode; width: number; kids: M[] };
  function measure(n: LanguageSyntaxNode): M {
    if (n.tokenId || !n.children?.length) {
      return { n, width: n.tokenId ? LEAF_W : PHRASE_W, kids: [] };
    }
    const kids = n.children.map(measure);
    const inner =
      kids.reduce((s, k) => s + k.width, 0) + H_GAP * Math.max(0, kids.length - 1);
    return { n, width: Math.max(PHRASE_W, inner), kids };
  }
  const m = measure(root);
  const scale = m.width > maxWidth ? maxWidth / m.width : 1;
  const nodes: Laid[] = [];
  const edges: Edge[] = [];

  function place(mm: M, left: number, depth: number): number {
    const y = 10 + depth * V_GAP;
    const isLeaf = Boolean(mm.n.tokenId);
    const w = (isLeaf ? LEAF_W : PHRASE_W) * Math.max(scale, 0.72);
    const h = isLeaf ? LEAF_H : PHRASE_H;
    let cx: number;
    if (!mm.kids.length) {
      cx = left + (mm.width * scale) / 2;
    } else {
      let x = left;
      const cxs: number[] = [];
      for (const k of mm.kids) {
        cxs.push(place(k, x, depth + 1));
        x += k.width * scale + H_GAP * scale;
      }
      cx = (Math.min(...cxs) + Math.max(...cxs)) / 2;
    }
    const id = mm.n.id;
    nodes.push({
      id,
      cat: mm.n.cat,
      x: cx - w / 2,
      y,
      w,
      h,
      isLeaf,
      isFocus: mm.n.tokenId === focusTokenId,
      surface: mm.n.surface,
      gloss: mm.n.gloss,
      tokenId: mm.n.tokenId,
    });
    for (const k of mm.kids) {
      const child = nodes.find((nn) => nn.id === k.n.id);
      if (child) {
        edges.push({
          x1: cx,
          y1: y + h,
          x2: child.x + child.w / 2,
          y2: child.y,
        });
      }
    }
    return cx;
  }

  place(m, 6, 0);
  const width = Math.ceil(Math.max(...nodes.map((n) => n.x + n.w), 120) + 10);
  const height = Math.ceil(Math.max(...nodes.map((n) => n.y + n.h), 60) + 14);
  return { nodes, edges, width, height };
}

/** Soft cubic connector for modern art feel. */
function curvePath(e: Edge): string {
  const midY = (e.y1 + e.y2) / 2;
  return `M ${e.x1.toFixed(1)} ${e.y1.toFixed(1)} C ${e.x1.toFixed(1)} ${midY.toFixed(1)}, ${e.x2.toFixed(1)} ${midY.toFixed(1)}, ${e.x2.toFixed(1)} ${e.y2.toFixed(1)}`;
}

type Props = {
  hit: LanguageSyntaxHit;
  dir?: "ltr" | "rtl";
  lang?: string;
};

export function SyntaxArtView({ hit, dir = "ltr" }: Props): React.JSX.Element {
  const [hoverId, setHoverId] = useState<string | null>(null);
  const layout = useMemo(
    () => layoutTree(hit.sentence.root, hit.focusTokenId, 300),
    [hit.sentence.root, hit.focusTokenId],
  );
  const hoverNode = hoverId ? layout.nodes.find((n) => n.id === hoverId) : null;
  const focusNode = layout.nodes.find((n) => n.isFocus);

  return (
    <div className="lang-syntax">
      <div className="lang-syntax-kicker">
        <span className="lang-syntax-kind">Syntax art</span>
        <span className="lang-syntax-ref">{hit.sentence.refLabel}</span>
      </div>
      <div className="lang-syntax-scroll">
        <svg
          className="lang-syntax-svg"
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          role="img"
          aria-label={`Syntax tree for ${hit.sentence.refLabel}`}
        >
          <defs>
            <linearGradient id="syn-edge" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--text-tertiary)" stopOpacity="0.55" />
              <stop offset="100%" stopColor="var(--text-tertiary)" stopOpacity="0.25" />
            </linearGradient>
          </defs>
          {layout.edges.map((e, i) => (
            <path
              key={i}
              d={curvePath(e)}
              className="lang-syntax-edge"
              fill="none"
              stroke="url(#syn-edge)"
            />
          ))}
          {layout.nodes.map((n) => (
            <g
              key={n.id}
              className={`lang-syntax-node${n.isLeaf ? " is-leaf" : " is-phrase"}${n.isFocus ? " is-focus" : ""}${hoverId === n.id ? " is-hover" : ""}`}
              transform={`translate(${n.x}, ${n.y})`}
              onMouseEnter={() => setHoverId(n.id)}
              onMouseLeave={() => setHoverId(null)}
            >
              <rect
                width={n.w}
                height={n.h}
                rx={n.isLeaf ? 8 : 6}
                className="lang-syntax-rect"
              />
              {n.isLeaf ? (
                <>
                  <text
                    x={n.w / 2}
                    y={14}
                    textAnchor="middle"
                    className="lang-syntax-surface"
                    style={{ direction: dir }}
                  >
                    {(n.surface ?? "").slice(0, 8)}
                  </text>
                  <text x={n.w / 2} y={26} textAnchor="middle" className="lang-syntax-gloss">
                    {(n.gloss ?? n.cat).slice(0, 10)}
                  </text>
                </>
              ) : (
                <text x={n.w / 2} y={13} textAnchor="middle" className="lang-syntax-cat">
                  {catShort(n.cat)}
                </text>
              )}
            </g>
          ))}
        </svg>
      </div>
      <p className="lang-syntax-caption">
        {(hoverNode ?? focusNode)?.isLeaf
          ? `${(hoverNode ?? focusNode)?.surface ?? ""} · ${(hoverNode ?? focusNode)?.gloss ?? ""}`
          : `${(hoverNode ?? focusNode)?.cat ?? "clause"} · structural node`}
      </p>
      <p className="lang-syntax-attr">MACULA · Clear Bible · CC BY</p>
    </div>
  );
}
