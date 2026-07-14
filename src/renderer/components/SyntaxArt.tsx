/**
 * Structure — three study modes:
 *  1. Tree  — real constituency chart (no scale-crush; scroll if wide)
 *  2. Flow  — reading-order cards by clause (always readable)
 *  3. Outline — indented list
 *
 * Tree never scales leaves down to fit; complex sentences scroll.
 * Data: MACULA (CC BY).
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { LanguageSyntaxHit, LanguageSyntaxNode } from "../api.js";

type RoleKey =
  | "subj"
  | "verb"
  | "obj"
  | "pred"
  | "prep"
  | "adv"
  | "conj"
  | "det"
  | "noun"
  | "sub"
  | "clause"
  | "other";

const ROLE_LABEL: Record<RoleKey, string> = {
  subj: "Subject",
  verb: "Verb",
  obj: "Object",
  pred: "Predicate",
  prep: "Prep.",
  adv: "Adverbial",
  conj: "Connector",
  det: "Article",
  noun: "Noun",
  sub: "Subord.",
  clause: "Clause",
  other: "·",
};

function roleOf(cat: string, rule?: string): RoleKey {
  const c = (cat ?? "").toLowerCase();
  const r = (rule ?? "").toUpperCase();
  if (c === "s") return "clause";
  if (c === "cl") return /SUB|ADVCL|RELC/.test(r) ? "sub" : "clause";
  if (c === "subj") return "subj";
  if (c === "vc" || c === "v" || c === "vp" || c === "verb") return "verb";
  if (c === "o" || c === "obj" || c === "do" || c === "io") return "obj";
  if (c === "pp" || c === "prep") return "prep";
  if (c === "p") return /PREP|PP/.test(r) ? "prep" : "pred";
  if (c === "adv" || c === "advp") return "adv";
  if (c === "conj" || c === "c") return "conj";
  if (c === "det" || c === "art" || c === "article") return "det";
  if (c === "noun" || c === "pron") return "noun";
  if (c === "np") return "noun";
  return "other";
}

function cleanGloss(g?: string): string {
  if (!g) return "";
  return g
    .replace(/\[[^\]]*]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isLeaf(n: LanguageSyntaxNode): boolean {
  if (n.tokenId) return true;
  if (n.children?.length) return false;
  return Boolean(n.surface || n.gloss);
}

/* ─── pruned chart tree ────────────────────────────────────── */

type ChartNode = {
  id: string;
  kind: "branch" | "word";
  role: RoleKey;
  label: string;
  surface?: string;
  gloss?: string;
  tokenId?: string;
  children: ChartNode[];
};

/** Drop unary NP scaffolding; keep clause/function containers + words. */
function toChartTree(node: LanguageSyntaxNode, roleHint: RoleKey = "other"): ChartNode {
  if (isLeaf(node)) {
    const own = roleOf(node.cat, node.rule);
    const role =
      roleHint !== "other" && roleHint !== "noun" && roleHint !== "det" && roleHint !== "clause"
        ? roleHint
        : own === "other"
          ? "noun"
          : own;
    return {
      id: node.tokenId ?? node.id,
      kind: "word",
      role,
      label: ROLE_LABEL[role],
      surface: (node.surface ?? "·").trim(),
      gloss: cleanGloss(node.gloss),
      tokenId: node.tokenId,
      children: [],
    };
  }

  const cat = (node.cat ?? "").toLowerCase();
  const own = roleOf(node.cat, node.rule);
  const keepBranch =
    cat === "s" ||
    cat === "cl" ||
    own === "subj" ||
    own === "verb" ||
    own === "obj" ||
    own === "prep" ||
    own === "pred" ||
    own === "adv" ||
    own === "sub";

  const childHint: RoleKey =
    own === "subj" || own === "verb" || own === "obj" || own === "prep" || own === "pred" || own === "adv"
      ? own
      : roleHint;

  const kids = (node.children ?? []).map((ch) => {
    const ck = roleOf(ch.cat, ch.rule);
    const h =
      ck === "subj" || ck === "verb" || ck === "obj" || ck === "prep" || ck === "pred" || ck === "adv"
        ? ck
        : childHint;
    return toChartTree(ch, h);
  });

  // Flatten pure-noise unary wrappers
  if (!keepBranch) {
    if (kids.length === 1) return kids[0]!;
    // Multiple kids under NP-ish: keep as invisible group by folding into a soft branch
    if (kids.length > 1) {
      return {
        id: node.id,
        kind: "branch",
        role: childHint !== "other" ? childHint : "noun",
        label: childHint !== "other" ? ROLE_LABEL[childHint] : "Phrase",
        children: kids,
      };
    }
  }

  // Collapse branch that only wraps one word
  if (kids.length === 1 && kids[0]!.kind === "word" && cat !== "cl" && cat !== "s") {
    return kids[0]!;
  }

  let label = ROLE_LABEL[own] || cat.toUpperCase();
  if (cat === "s") label = "Sentence";
  if (cat === "cl") label = own === "sub" ? "Subordinate" : "Clause";
  if (own === "subj") label = "Subject";
  if (own === "verb") label = "Verb";
  if (own === "obj") label = "Object";
  if (own === "pred") label = "Predicate";
  if (own === "prep") label = "Prep.";
  if (own === "adv") label = "Adverbial";

  return {
    id: node.id,
    kind: "branch",
    role: own === "other" && (cat === "s" || cat === "cl") ? "clause" : own,
    label,
    children: kids,
  };
}

/* ─── layout: NEVER scale ──────────────────────────────────── */

type Laid = {
  id: string;
  kind: "branch" | "word";
  role: RoleKey;
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
};

type Edge = { x1: number; y1: number; x2: number; y2: number };

const LEAF_W_MIN = 72;
const LEAF_H = 58;
const BRANCH_H = 28;
const H_GAP = 20;
const V_GAP = 52;
const PAD = 28;

function leafWidth(n: ChartNode): number {
  const g = (n.surface ?? "").length;
  const e = (n.gloss ?? "").length;
  return Math.min(Math.max(g * 12, e * 7.5, LEAF_W_MIN), 160);
}

function layoutTree(
  root: ChartNode,
  focusTokenId: string,
): { nodes: Laid[]; edges: Edge[]; width: number; height: number } {
  type M = { n: ChartNode; width: number; kids: M[] };

  function measure(n: ChartNode): M {
    if (n.kind === "word" || n.children.length === 0) {
      return { n, width: leafWidth(n), kids: [] };
    }
    const kids = n.children.map(measure);
    const inner = kids.reduce((s, k) => s + k.width, 0) + H_GAP * Math.max(0, kids.length - 1);
    return { n, width: Math.max(64, inner), kids };
  }

  const m = measure(root);
  // CRITICAL: do not scale — use natural width; parent scrolls
  const nodes: Laid[] = [];
  const edges: Edge[] = [];

  function place(mm: M, left: number, depth: number): number {
    const y = PAD + depth * V_GAP;
    let cx: number;

    if (mm.kids.length === 0) {
      const w = mm.width;
      cx = left + w / 2;
      nodes.push({
        id: mm.n.id,
        kind: "word",
        role: mm.n.role,
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
      });
      return cx;
    }

    let x = left;
    const centers: number[] = [];
    for (const k of mm.kids) {
      centers.push(place(k, x, depth + 1));
      x += k.width + H_GAP;
    }
    cx = (Math.min(...centers) + Math.max(...centers)) / 2;
    const w = Math.min(120, Math.max(56, mm.n.label.length * 8.5 + 16));
    nodes.push({
      id: mm.n.id,
      kind: "branch",
      role: mm.n.role,
      label: mm.n.label,
      x: cx - w / 2,
      y,
      w,
      h: BRANCH_H,
      isFocus: false,
      cx,
    });
    for (const k of mm.kids) {
      const child = nodes.find((nn) => nn.id === k.n.id);
      if (child) {
        edges.push({ x1: cx, y1: y + BRANCH_H, x2: child.cx, y2: child.y });
      }
    }
    return cx;
  }

  place(m, PAD, 0);
  const width = Math.ceil(Math.max(...nodes.map((n) => n.x + n.w), 400) + PAD);
  const height = Math.ceil(Math.max(...nodes.map((n) => n.y + n.h), 200) + PAD);
  return { nodes, edges, width, height };
}

function curve(e: Edge): string {
  const my = (e.y1 + e.y2) / 2;
  return `M ${e.x1.toFixed(1)} ${e.y1.toFixed(1)} C ${e.x1.toFixed(1)} ${my.toFixed(1)}, ${e.x2.toFixed(1)} ${my.toFixed(1)}, ${e.x2.toFixed(1)} ${e.y2.toFixed(1)}`;
}

/* ─── flow + outline ───────────────────────────────────────── */

type FlowWord = {
  id: string;
  tokenId?: string;
  surface: string;
  gloss: string;
  role: RoleKey;
  isFocus: boolean;
};

type FlowClause = {
  id: string;
  title: string;
  rule?: string;
  words: FlowWord[];
};

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

function buildFlow(
  root: LanguageSyntaxNode,
  focusTokenId: string,
): { clauses: FlowClause[]; outline: OutlineRow[]; wordCount: number } {
  const clauses: FlowClause[] = [];
  const outline: OutlineRow[] = [];
  let wordCount = 0;
  let clauseI = 0;
  let wordI = 0;
  let current: FlowClause = { id: "main", title: "Main clause", words: [] };
  clauses.push(current);

  function pushClause(title: string, rule?: string, depth = 0): void {
    if (current.words.length === 0) {
      current.title = title;
      current.rule = rule;
      return;
    }
    current = { id: `cl-${++clauseI}`, title, rule, words: [] };
    clauses.push(current);
    outline.push({
      id: current.id,
      kind: "clause",
      depth,
      role: title,
      roleKey: /subord/i.test(title) ? "sub" : "clause",
      rule,
      isFocus: false,
    });
  }

  function walk(node: LanguageSyntaxNode, depth: number, roleHint: RoleKey): void {
    const cat = (node.cat ?? "").toLowerCase();
    const own = roleOf(node.cat, node.rule);

    if (isLeaf(node)) {
      const role =
        roleHint !== "other" && roleHint !== "noun" && roleHint !== "det" && roleHint !== "clause"
          ? roleHint
          : own === "other"
            ? "noun"
            : own;
      const surface = (node.surface ?? "·").replace(/\s+/g, " ").trim();
      const gloss = cleanGloss(node.gloss);
      const id = node.tokenId ?? `w${wordI++}`;
      const isFocus = node.tokenId === focusTokenId;
      current.words.push({ id, tokenId: node.tokenId, surface, gloss, role, isFocus });
      outline.push({
        id,
        kind: "word",
        depth: Math.min(depth, 4),
        role: ROLE_LABEL[role],
        roleKey: role,
        surface,
        gloss,
        isFocus,
      });
      wordCount += 1;
      return;
    }

    if (cat === "cl") {
      const sub = own === "sub";
      const title = sub ? "Subordinate clause" : depth === 0 ? "Main clause" : "Clause";
      if (depth > 0) pushClause(title, node.rule, Math.min(depth, 3));
      for (const ch of node.children ?? []) walk(ch, depth + 1, roleHint);
      return;
    }

    let next: RoleKey = roleHint;
    if (
      own === "subj" ||
      own === "verb" ||
      own === "obj" ||
      own === "prep" ||
      own === "pred" ||
      own === "adv"
    ) {
      next = own;
    }

    if (cat === "s") {
      for (const ch of node.children ?? []) walk(ch, depth, next);
      return;
    }

    for (const ch of node.children ?? []) {
      const ck = roleOf(ch.cat, ch.rule);
      let childHint = next;
      if (
        ck === "subj" ||
        ck === "verb" ||
        ck === "obj" ||
        ck === "prep" ||
        ck === "pred" ||
        ck === "adv"
      ) {
        childHint = ck;
      }
      walk(ch, depth + (cat === "pp" || cat === "vp" || cat === "p" ? 1 : 0), childHint);
    }
  }

  walk(root, 0, "other");
  const cleaned = clauses.filter((c) => c.words.length > 0);
  if (cleaned.length === 0) cleaned.push({ id: "empty", title: "Clause", words: [] });
  if (outline.length && outline[0]!.kind === "word") {
    outline.unshift({
      id: "cl-main",
      kind: "clause",
      depth: 0,
      role: cleaned[0]?.title ?? "Main clause",
      roleKey: "clause",
      isFocus: false,
    });
  }
  return { clauses: cleaned, outline, wordCount };
}

/* ─── component ────────────────────────────────────────────── */

type Mode = "tree" | "flow" | "outline";

type Props = {
  hit: LanguageSyntaxHit;
  dir?: "ltr" | "rtl";
  fillContainer?: boolean;
  chartWidth?: number;
  defaultMode?: Mode;
};

export function SyntaxArtView({
  hit,
  dir = "ltr",
  defaultMode = "tree",
}: Props): React.JSX.Element {
  // Accept legacy "chart" as alias for tree
  const initial: Mode =
    (defaultMode as string) === "chart" ? "tree" : (defaultMode as Mode) || "tree";
  const [active, setActive] = useState<Mode>(initial);

  const [hoverId, setHoverId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const chartRoot = useMemo(() => toChartTree(hit.sentence.root), [hit.sentence.root]);
  const treeLayout = useMemo(
    () => layoutTree(chartRoot, hit.focusTokenId),
    [chartRoot, hit.focusTokenId],
  );
  const { clauses, outline, wordCount } = useMemo(
    () => buildFlow(hit.sentence.root, hit.focusTokenId),
    [hit.sentence.root, hit.focusTokenId],
  );

  // Center focus leaf in tree scroll area when opening
  useEffect(() => {
    if (active !== "tree" || !scrollRef.current) return;
    const focus = treeLayout.nodes.find((n) => n.isFocus);
    if (!focus) return;
    const el = scrollRef.current;
    const targetLeft = focus.x + focus.w / 2 - el.clientWidth / 2;
    const targetTop = focus.y + focus.h / 2 - el.clientHeight / 2;
    el.scrollTo({
      left: Math.max(0, targetLeft),
      top: Math.max(0, targetTop),
      behavior: "smooth",
    });
  }, [active, treeLayout, hit.focusTokenId]);

  const allWords = clauses.flatMap((c) => c.words);
  const focus = allWords.find((w) => w.isFocus) ?? allWords[0] ?? null;
  const hover = hoverId ? allWords.find((w) => w.id === hoverId) ?? null : null;
  const spotlight = hover ?? focus;

  return (
    <div className="lang-syntax lang-syntax--modal">
      <div className="lang-syntax-modes" role="tablist" aria-label="Structure view">
        <button
          type="button"
          role="tab"
          className={`lang-syntax-mode${active === "tree" ? " is-active" : ""}`}
          aria-selected={active === "tree"}
          onClick={() => setActive("tree")}
        >
          Tree
        </button>
        <button
          type="button"
          role="tab"
          className={`lang-syntax-mode${active === "flow" ? " is-active" : ""}`}
          aria-selected={active === "flow"}
          onClick={() => setActive("flow")}
        >
          Flow
        </button>
        <button
          type="button"
          role="tab"
          className={`lang-syntax-mode${active === "outline" ? " is-active" : ""}`}
          aria-selected={active === "outline"}
          onClick={() => setActive("outline")}
        >
          Outline
        </button>
        <span className="lang-syntax-meta">
          {wordCount} words · {hit.sentence.refLabel}
        </span>
      </div>

      {active === "tree" ? (
        <div className="lang-tree">
          <p className="lang-tree-intro">
            Constituency chart · scroll to explore · leaves never shrunk · selected word ringed
          </p>
          <div className="lang-tree-scroll" ref={scrollRef}>
            <svg
              className="lang-tree-svg"
              width={treeLayout.width}
              height={treeLayout.height}
              viewBox={`0 0 ${treeLayout.width} ${treeLayout.height}`}
              role="img"
              aria-label={`Syntax tree for ${hit.sentence.refLabel}`}
            >
              {treeLayout.edges.map((e, i) => (
                <path key={i} d={curve(e)} className="lang-tree-edge" fill="none" />
              ))}
              {treeLayout.nodes.map((n) =>
                n.kind === "word" ? (
                  <g
                    key={n.id}
                    className={`lang-tree-leaf role-${n.role}${n.isFocus ? " is-focus" : ""}`}
                    transform={`translate(${n.x}, ${n.y})`}
                  >
                    <title>
                      {n.label}: {n.surface}
                      {n.gloss ? ` — ${n.gloss}` : ""}
                    </title>
                    <rect width={n.w} height={n.h} rx={10} className="lang-tree-leaf-bg" />
                    <rect
                      x={0}
                      y={0}
                      width={4}
                      height={n.h}
                      rx={2}
                      className={`lang-tree-leaf-bar role-${n.role}`}
                    />
                    <text
                      x={n.w / 2 + 2}
                      y={22}
                      textAnchor="middle"
                      className="lang-tree-leaf-grk"
                      style={{ direction: dir }}
                    >
                      {n.surface ?? "·"}
                    </text>
                    <text x={n.w / 2 + 2} y={42} textAnchor="middle" className="lang-tree-leaf-en">
                      {(n.gloss || n.label).slice(0, 18)}
                    </text>
                  </g>
                ) : (
                  <g
                    key={n.id}
                    className={`lang-tree-branch role-${n.role}`}
                    transform={`translate(${n.x}, ${n.y})`}
                  >
                    <rect width={n.w} height={n.h} rx={14} className="lang-tree-branch-bg" />
                    <text x={n.w / 2} y={18} textAnchor="middle" className="lang-tree-branch-label">
                      {n.label}
                    </text>
                  </g>
                ),
              )}
            </svg>
          </div>
          <div className="lang-syntax-legend" aria-hidden="true">
            <span className="role-subj">Subject</span>
            <span className="role-verb">Verb</span>
            <span className="role-obj">Object</span>
            <span className="role-prep">Prep.</span>
            <span className="role-pred">Pred.</span>
            <span className="role-adv">Adv.</span>
          </div>
        </div>
      ) : active === "flow" ? (
        <div className="lang-flow">
          <p className="lang-flow-intro">
            Reading order by clause · color = role · never overlaps
          </p>
          <div className="lang-flow-scroll">
            {clauses.map((cl) => (
              <section key={cl.id} className="lang-flow-clause">
                <header className="lang-flow-clause-head">
                  <span className="lang-flow-clause-title">{cl.title}</span>
                  {cl.rule ? <span className="lang-flow-clause-rule">{cl.rule}</span> : null}
                </header>
                <div className="lang-flow-words" dir={dir}>
                  {cl.words.map((w) => (
                    <button
                      key={w.id}
                      type="button"
                      className={`lang-flow-card role-${w.role}${w.isFocus ? " is-focus" : ""}${hoverId === w.id ? " is-hover" : ""}`}
                      onMouseEnter={() => setHoverId(w.id)}
                      onMouseLeave={() => setHoverId(null)}
                      title={`${ROLE_LABEL[w.role]}${w.gloss ? ` · ${w.gloss}` : ""}`}
                    >
                      <span className="lang-flow-role">{ROLE_LABEL[w.role]}</span>
                      <span className="lang-flow-grk">{w.surface}</span>
                      {w.gloss ? (
                        <span className="lang-flow-en" dir="ltr">
                          {w.gloss}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
          <div className="lang-syntax-legend" aria-hidden="true">
            <span className="role-subj">Subject</span>
            <span className="role-verb">Verb</span>
            <span className="role-obj">Object</span>
            <span className="role-prep">Prep.</span>
            <span className="role-pred">Pred.</span>
            <span className="role-adv">Adv.</span>
            <span className="role-conj">Conn.</span>
          </div>
        </div>
      ) : (
        <ul className="lang-syntax-outline lang-syntax-outline--wide" aria-label="Clause outline">
          {outline.map((row) =>
            row.kind === "clause" ? (
              <li
                key={row.id}
                className="lang-syntax-clause"
                style={{ paddingLeft: 16 + row.depth * 20 }}
              >
                <span className="lang-syntax-clause-label">{row.role}</span>
                {row.rule ? <span className="lang-syntax-clause-rule">{row.rule}</span> : null}
              </li>
            ) : (
              <li
                key={row.id}
                className={`lang-syntax-row role-${row.roleKey}${row.isFocus ? " is-focus" : ""}`}
                style={{ paddingLeft: 16 + row.depth * 20 }}
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

      {spotlight ? (
        <p className="lang-syntax-caption" aria-live="polite">
          <span className={`lang-syntax-role role-${spotlight.role}`}>
            {ROLE_LABEL[spotlight.role]}
          </span>
          <span className="lang-syntax-caption-body">
            {spotlight.surface}
            {spotlight.gloss ? ` — ${spotlight.gloss}` : ""}
          </span>
        </p>
      ) : null}
    </div>
  );
}
