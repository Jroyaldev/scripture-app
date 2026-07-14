/**
 * Structure — pastor-usable MACULA syntax.
 *
 * Two complementary views:
 *  1. Chart — simplified visual of clause → roles → words (gestalt)
 *  2. Outline — clear indented list (reading / study)
 *
 * Pastors want who-does-what and clause flow, not dense NP/VP academia.
 * Data: Clear Bible MACULA (CC BY).
 */

import React, { useMemo, useState } from "react";
import type { LanguageSyntaxHit, LanguageSyntaxNode } from "../api.js";

/* ─── role mapping ─────────────────────────────────────────── */

type RoleKey =
  | "clause"
  | "sub"
  | "subj"
  | "verb"
  | "obj"
  | "pred"
  | "prep"
  | "adv"
  | "conj"
  | "det"
  | "noun"
  | "other";

function roleOf(cat: string, rule?: string): { key: RoleKey; label: string } {
  const c = (cat ?? "").toLowerCase();
  const r = (rule ?? "").toUpperCase();
  if (c === "s") return { key: "clause", label: "Sentence" };
  if (c === "cl") {
    if (/SUB|ADVCL|RELC/.test(r)) return { key: "sub", label: "Subord." };
    return { key: "clause", label: "Clause" };
  }
  if (c === "subj") return { key: "subj", label: "Subject" };
  if (c === "vc" || c === "v" || c === "vp" || c === "verb") return { key: "verb", label: "Verb" };
  if (c === "o" || c === "obj" || c === "do" || c === "io") return { key: "obj", label: "Object" };
  if (c === "pp" || c === "prep") return { key: "prep", label: "Prep." };
  if (c === "p") {
    if (/PREP|PP/.test(r)) return { key: "prep", label: "Prep." };
    return { key: "pred", label: "Predicate" };
  }
  if (c === "adv" || c === "advp") return { key: "adv", label: "Adverbial" };
  if (c === "conj" || c === "c") return { key: "conj", label: "And" };
  if (c === "det" || c === "art" || c === "article") return { key: "det", label: "Art." };
  if (c === "noun" || c === "np") return { key: "noun", label: c === "np" ? "NP" : "Noun" };
  if (c === "pron") return { key: "noun", label: "Pron." };
  if (c === "adj" || c === "adjp") return { key: "other", label: "Adj." };
  return { key: "other", label: cat ? cat.slice(0, 6) : "·" };
}

function cleanGloss(g?: string): string {
  if (!g) return "";
  return g
    .replace(/\[[^\]]*]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 28);
}

/* ─── prune tree for chart (drop unary NP noise) ───────────── */

type ChartNode = {
  id: string;
  kind: "clause" | "role" | "word";
  roleKey: RoleKey;
  label: string;
  surface?: string;
  gloss?: string;
  tokenId?: string;
  children: ChartNode[];
};

function isLeafish(n: LanguageSyntaxNode): boolean {
  if (n.tokenId) return true;
  if (n.children && n.children.length > 0) return false;
  return Boolean(n.surface || n.gloss);
}

/** Collapse unary wrappers; keep clause / functional / word nodes only. */
function toChartTree(node: LanguageSyntaxNode, roleHint: RoleKey = "other"): ChartNode {
  // Leaf word
  if (isLeafish(node)) {
    const r = roleOf(node.cat, node.rule);
    const key =
      roleHint !== "other" && roleHint !== "clause" && roleHint !== "noun" && roleHint !== "det"
        ? roleHint
        : r.key;
    const lab =
      key === r.key
        ? r.label
        : roleOf(
            key === "subj"
              ? "Subj"
              : key === "verb"
                ? "V"
                : key === "obj"
                  ? "O"
                  : key === "prep"
                    ? "pp"
                    : key === "pred"
                      ? "P"
                      : node.cat,
            node.rule,
          ).label;
    return {
      id: node.tokenId ?? node.id,
      kind: "word",
      roleKey: key,
      label: lab,
      surface: node.surface,
      gloss: cleanGloss(node.gloss),
      tokenId: node.tokenId,
      children: [],
    };
  }

  const cat = (node.cat ?? "").toLowerCase();
  const own = roleOf(node.cat, node.rule);
  const kids = (node.children ?? []).map((ch) => {
    let hint: RoleKey = roleHint;
    if (own.key === "subj" || own.key === "verb" || own.key === "obj" || own.key === "prep" || own.key === "pred") {
      hint = own.key;
    } else if (cat === "cl" || cat === "s") {
      // Rule P-VC-S etc. — assign by child cat
      const ck = roleOf(ch.cat, ch.rule).key;
      if (ck !== "other" && ck !== "noun" && ck !== "clause") hint = ck;
    }
    return toChartTree(ch, hint);
  });

  // Flatten unary non-interesting nodes
  const interesting =
    cat === "s" ||
    cat === "cl" ||
    own.key === "subj" ||
    own.key === "verb" ||
    own.key === "obj" ||
    own.key === "prep" ||
    own.key === "pred" ||
    own.key === "adv";

  if (!interesting && kids.length === 1) {
    return kids[0]!;
  }
  if (!interesting && kids.length > 1) {
    // Keep as anonymous group under parent — fold children up by using a soft role
    return {
      id: node.id,
      kind: "role",
      roleKey: roleHint !== "other" ? roleHint : "other",
      label: own.label,
      children: kids,
    };
  }

  const kind: ChartNode["kind"] = cat === "s" || cat === "cl" ? "clause" : "role";
  return {
    id: node.id,
    kind,
    roleKey: own.key,
    label: own.label,
    children: kids,
  };
}

/* ─── layout ───────────────────────────────────────────────── */

type Laid = {
  id: string;
  kind: ChartNode["kind"];
  roleKey: RoleKey;
  label: string;
  surface?: string;
  gloss?: string;
  tokenId?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  isFocus: boolean;
  cx: number;
  cy: number;
};

type Edge = { x1: number; y1: number; x2: number; y2: number };

const LEAF_MIN_W = 44;
const LEAF_H = 40;
const ROLE_H = 18;
const H_GAP = 6;
const V_GAP = 28;

function measureLeafWidth(n: ChartNode): number {
  const grk = (n.surface ?? "").length;
  const en = (n.gloss ?? "").length;
  const byChars = Math.max(grk * 8.5, en * 5.2, LEAF_MIN_W);
  return Math.min(Math.max(byChars, LEAF_MIN_W), 88);
}

function layoutChart(
  root: ChartNode,
  focusTokenId: string,
  maxWidth: number,
): { nodes: Laid[]; edges: Edge[]; width: number; height: number } {
  type M = { n: ChartNode; width: number; kids: M[] };

  function measure(n: ChartNode): M {
    if (n.kind === "word" || n.children.length === 0) {
      return { n, width: measureLeafWidth(n), kids: [] };
    }
    const kids = n.children.map(measure);
    const inner = kids.reduce((s, k) => s + k.width, 0) + H_GAP * Math.max(0, kids.length - 1);
    return { n, width: Math.max(40, inner), kids };
  }

  const m = measure(root);
  const scale = m.width > maxWidth ? maxWidth / m.width : 1;
  const nodes: Laid[] = [];
  const edges: Edge[] = [];

  function place(mm: M, left: number, depth: number): number {
    const isWord = mm.n.kind === "word";
    const h = isWord ? LEAF_H : ROLE_H;
    const y = 8 + depth * V_GAP;
    let cx: number;

    if (mm.kids.length === 0) {
      const w = Math.max(LEAF_MIN_W * 0.85, mm.width * scale);
      cx = left + w / 2;
      nodes.push({
        id: mm.n.id,
        kind: mm.n.kind,
        roleKey: mm.n.roleKey,
        label: mm.n.label,
        surface: mm.n.surface,
        gloss: mm.n.gloss,
        tokenId: mm.n.tokenId,
        x: left,
        y,
        w,
        h: LEAF_H,
        isFocus: mm.n.tokenId === focusTokenId,
        cx,
        cy: y + LEAF_H / 2,
      });
      return cx;
    }

    let x = left;
    const childCenters: number[] = [];
    for (const k of mm.kids) {
      childCenters.push(place(k, x, depth + 1));
      x += k.width * scale + H_GAP * scale;
    }
    cx = (Math.min(...childCenters) + Math.max(...childCenters)) / 2;
    const w = Math.min(72, Math.max(36, mm.n.label.length * 6.5));
    nodes.push({
      id: mm.n.id,
      kind: mm.n.kind,
      roleKey: mm.n.roleKey,
      label: mm.n.label,
      x: cx - w / 2,
      y,
      w,
      h,
      isFocus: false,
      cx,
      cy: y + h / 2,
    });

    for (const k of mm.kids) {
      const child = nodes.find((nn) => nn.id === k.n.id);
      if (child) {
        edges.push({
          x1: cx,
          y1: y + h,
          x2: child.cx,
          y2: child.y,
        });
      }
    }
    return cx;
  }

  place(m, 6, 0);
  const width = Math.ceil(Math.max(...nodes.map((n) => n.x + n.w), 160) + 10);
  const height = Math.ceil(Math.max(...nodes.map((n) => n.y + n.h), 80) + 12);
  return { nodes, edges, width, height };
}

function curve(e: Edge): string {
  const my = (e.y1 + e.y2) / 2;
  return `M ${e.x1.toFixed(1)} ${e.y1.toFixed(1)} C ${e.x1.toFixed(1)} ${my.toFixed(1)}, ${e.x2.toFixed(1)} ${my.toFixed(1)}, ${e.x2.toFixed(1)} ${e.y2.toFixed(1)}`;
}

/* ─── outline rows ─────────────────────────────────────────── */

type OutlineRow = {
  id: string;
  kind: "clause" | "word";
  depth: number;
  role: string;
  roleKey: RoleKey;
  surface?: string;
  gloss?: string;
  isFocus: boolean;
  rule?: string;
};

function flattenOutline(root: LanguageSyntaxNode, focusTokenId: string): OutlineRow[] {
  const rows: OutlineRow[] = [];
  let i = 0;

  function walk(node: LanguageSyntaxNode, depth: number, roleHint: RoleKey): void {
    const cat = (node.cat ?? "").toLowerCase();
    if (isLeafish(node)) {
      const r = roleOf(node.cat, node.rule);
      const key =
        roleHint !== "other" && roleHint !== "clause" && roleHint !== "noun"
          ? roleHint
          : r.key;
      const label = key === r.key ? r.label : roleOf(
        key === "subj" ? "Subj" : key === "verb" ? "V" : key === "obj" ? "O" : key === "prep" ? "pp" : key === "pred" ? "P" : node.cat,
        node.rule,
      ).label;
      rows.push({
        id: node.tokenId ?? `w${i++}`,
        kind: "word",
        depth: Math.min(depth, 5),
        role: label,
        roleKey: key,
        surface: node.surface,
        gloss: cleanGloss(node.gloss),
        isFocus: node.tokenId === focusTokenId,
      });
      return;
    }
    if ((cat === "cl" || cat === "s") && depth > 0) {
      const cr = roleOf(node.cat, node.rule);
      rows.push({
        id: `cl-${node.id}`,
        kind: "clause",
        depth: Math.min(depth - 1, 4),
        role: cr.label,
        roleKey: cr.key,
        rule: node.rule,
        isFocus: false,
      });
    }
    const own = roleOf(node.cat, node.rule);
    const next: RoleKey =
      own.key === "subj" || own.key === "verb" || own.key === "obj" || own.key === "prep" || own.key === "pred"
        ? own.key
        : roleHint;
    const bump = cat === "cl" || cat === "pp" || cat === "vp" || cat === "subj" || cat === "p" ? 1 : 0;
    for (const ch of node.children ?? []) walk(ch, depth + bump, next);
  }

  walk(root, 0, "other");
  return rows;
}

/* ─── component ────────────────────────────────────────────── */

type Props = {
  hit: LanguageSyntaxHit;
  dir?: "ltr" | "rtl";
  lang?: string;
};

export function SyntaxArtView({ hit, dir = "ltr" }: Props): React.JSX.Element {
  const [mode, setMode] = useState<"chart" | "outline">("chart");

  const chartRoot = useMemo(() => toChartTree(hit.sentence.root), [hit.sentence.root]);
  const layout = useMemo(
    () => layoutChart(chartRoot, hit.focusTokenId, 300),
    [chartRoot, hit.focusTokenId],
  );
  const outline = useMemo(
    () => flattenOutline(hit.sentence.root, hit.focusTokenId),
    [hit.sentence.root, hit.focusTokenId],
  );
  const words = outline.filter((r) => r.kind === "word");
  const focus = words.find((w) => w.isFocus) ?? words[0];

  return (
    <div className="lang-syntax">
      <div className="lang-syntax-kicker">
        <span className="lang-syntax-kind">Structure</span>
        <span className="lang-syntax-ref">{hit.sentence.refLabel}</span>
      </div>

      <div className="lang-syntax-modes" role="tablist" aria-label="Structure view">
        <button
          type="button"
          role="tab"
          className={`lang-syntax-mode${mode === "chart" ? " is-active" : ""}`}
          aria-selected={mode === "chart"}
          onClick={(e) => {
            e.stopPropagation();
            setMode("chart");
          }}
        >
          Chart
        </button>
        <button
          type="button"
          role="tab"
          className={`lang-syntax-mode${mode === "outline" ? " is-active" : ""}`}
          aria-selected={mode === "outline"}
          onClick={(e) => {
            e.stopPropagation();
            setMode("outline");
          }}
        >
          Outline
        </button>
        <span className="lang-syntax-meta">{words.length} words</span>
      </div>

      {mode === "chart" ? (
        <div className="lang-syntax-chart-wrap">
          <svg
            className="lang-syntax-chart"
            width={layout.width}
            height={layout.height}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            role="img"
            aria-label={`Structure chart for ${hit.sentence.refLabel}`}
          >
            {layout.edges.map((e, i) => (
              <path key={i} d={curve(e)} className="lang-syntax-edge" fill="none" />
            ))}
            {layout.nodes.map((n) =>
              n.kind === "word" ? (
                <g
                  key={n.id}
                  className={`lang-syntax-leaf role-${n.roleKey}${n.isFocus ? " is-focus" : ""}`}
                  transform={`translate(${n.x}, ${n.y})`}
                >
                  <rect width={n.w} height={n.h} rx={7} className="lang-syntax-leaf-bg" />
                  <rect width={3} height={n.h} rx={1.5} className={`lang-syntax-leaf-accent role-${n.roleKey}`} />
                  <text x={n.w / 2 + 1} y={16} textAnchor="middle" className="lang-syntax-leaf-grk" style={{ direction: dir }}>
                    {(n.surface ?? "·").slice(0, 10)}
                  </text>
                  <text x={n.w / 2 + 1} y={30} textAnchor="middle" className="lang-syntax-leaf-en">
                    {(n.gloss || n.label).slice(0, 12)}
                  </text>
                </g>
              ) : (
                <g
                  key={n.id}
                  className={`lang-syntax-branch role-${n.roleKey}`}
                  transform={`translate(${n.x}, ${n.y})`}
                >
                  <rect width={n.w} height={n.h} rx={9} className="lang-syntax-branch-bg" />
                  <text x={n.w / 2} y={12.5} textAnchor="middle" className="lang-syntax-branch-label">
                    {n.label}
                  </text>
                </g>
              ),
            )}
          </svg>
          <div className="lang-syntax-legend" aria-hidden="true">
            <span className="role-subj">Subject</span>
            <span className="role-verb">Verb</span>
            <span className="role-obj">Object</span>
            <span className="role-prep">Prep.</span>
            <span className="role-pred">Pred.</span>
          </div>
        </div>
      ) : (
        <ul className="lang-syntax-outline" aria-label="Clause outline">
          {outline.map((row) =>
            row.kind === "clause" ? (
              <li
                key={row.id}
                className="lang-syntax-clause"
                style={{ paddingLeft: 8 + row.depth * 12 }}
              >
                <span className="lang-syntax-clause-label">{row.role}</span>
                {row.rule ? <span className="lang-syntax-clause-rule">{row.rule}</span> : null}
              </li>
            ) : (
              <li
                key={row.id}
                className={`lang-syntax-row role-${row.roleKey}${row.isFocus ? " is-focus" : ""}`}
                style={{ paddingLeft: 8 + row.depth * 12 }}
              >
                <span className={`lang-syntax-role role-${row.roleKey}`}>{row.role}</span>
                <span className="lang-syntax-forms">
                  <span className="lang-syntax-grk" dir={dir}>
                    {row.surface ?? "·"}
                  </span>
                  {row.gloss ? (
                    <span className="lang-syntax-en" dir="ltr">
                      {row.gloss}
                    </span>
                  ) : null}
                </span>
              </li>
            ),
          )}
        </ul>
      )}

      {focus ? (
        <p className="lang-syntax-caption" aria-live="polite">
          <span className={`lang-syntax-role role-${focus.roleKey}`}>{focus.role}</span>
          <span className="lang-syntax-caption-body">
            {focus.surface}
            {focus.gloss ? ` — ${focus.gloss}` : ""}
          </span>
        </p>
      ) : null}

      <p className="lang-syntax-hint">Chart for shape · Outline for study · selected word marked</p>
      <p className="lang-syntax-attr">MACULA · Clear Bible · CC BY</p>
    </div>
  );
}
