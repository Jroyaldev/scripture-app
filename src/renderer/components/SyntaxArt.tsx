/**
 * Structure chart — high-quality clause-flow map for pastors.
 *
 * Complex constituency trees scale badly (overlap, truncation). Instead:
 * words in reading order, grouped by clause, tagged with pastoral roles.
 * Outline tab for list study. Data: MACULA (CC BY).
 */

import React, { useMemo, useState } from "react";
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
  sub: "Subordinate",
  other: "·",
};

function roleOf(cat: string, rule?: string): RoleKey {
  const c = (cat ?? "").toLowerCase();
  const r = (rule ?? "").toUpperCase();
  if (c === "subj") return "subj";
  if (c === "vc" || c === "v" || c === "vp" || c === "verb") return "verb";
  if (c === "o" || c === "obj" || c === "do" || c === "io") return "obj";
  if (c === "pp" || c === "prep") return "prep";
  if (c === "p") return /PREP|PP/.test(r) ? "prep" : "pred";
  if (c === "adv" || c === "advp") return "adv";
  if (c === "conj" || c === "c") return "conj";
  if (c === "det" || c === "art" || c === "article") return "det";
  if (c === "cl" && /SUB|ADVCL|RELC/.test(r)) return "sub";
  if (c === "noun" || c === "pron" || c === "np") return "noun";
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
  if (n.children && n.children.length > 0) return false;
  return Boolean(n.surface || n.gloss);
}

/* ─── flatten to clause groups + words ─────────────────────── */

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

/**
 * Walk MACULA tree → ordered words with best-effort functional roles.
 * Intermediate NP scaffolding is dropped from the visual model.
 */
function buildFlow(
  root: LanguageSyntaxNode,
  focusTokenId: string,
): { clauses: FlowClause[]; outline: OutlineRow[]; wordCount: number } {
  const clauses: FlowClause[] = [];
  const outline: OutlineRow[] = [];
  let wordCount = 0;
  let clauseI = 0;
  let wordI = 0;

  // Active clause bucket
  let current: FlowClause = {
    id: "main",
    title: "Main clause",
    words: [],
  };
  clauses.push(current);

  function pushClause(title: string, rule?: string, depth = 0): void {
    // Don't open empty duplicate
    if (current.words.length === 0 && clauseI === 0 && title === "Main clause") {
      current.title = title;
      current.rule = rule;
      return;
    }
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
      roleKey: /subord/i.test(title) ? "sub" : "other",
      rule,
      isFocus: false,
    });
  }

  function walk(node: LanguageSyntaxNode, depth: number, roleHint: RoleKey): void {
    const cat = (node.cat ?? "").toLowerCase();
    const own = roleOf(node.cat, node.rule);

    if (isLeaf(node)) {
      const role =
        roleHint !== "other" && roleHint !== "noun" && roleHint !== "det" ? roleHint : own === "other" ? "noun" : own;
      const surface = (node.surface ?? "·").replace(/\s+/g, " ").trim();
      const gloss = cleanGloss(node.gloss);
      const id = node.tokenId ?? `w${wordI++}`;
      const isFocus = node.tokenId === focusTokenId;
      current.words.push({
        id,
        tokenId: node.tokenId,
        surface,
        gloss,
        role,
        isFocus,
      });
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

    // Clause boundary
    if (cat === "cl") {
      const sub = own === "sub" || /SUB|ADVCL|RELC/i.test(node.rule ?? "");
      const title = sub ? "Subordinate clause" : depth === 0 ? "Main clause" : "Clause";
      if (depth > 0) pushClause(title, node.rule, Math.min(depth, 3));
      const nextRole = roleHint;
      for (const ch of node.children ?? []) walk(ch, depth + 1, nextRole);
      return;
    }

    // Functional container: pass role to descendants
    let next: RoleKey = roleHint;
    if (own === "subj" || own === "verb" || own === "obj" || own === "prep" || own === "pred" || own === "adv") {
      next = own;
    }

    // S node — just descend
    if (cat === "s") {
      for (const ch of node.children ?? []) walk(ch, depth, next);
      return;
    }

    // Assign child roles from common MACULA clause rules when possible
    const kids = node.children ?? [];
    if (cat === "cl" || false) {
      /* handled above */
    }

    // Heuristic: under a rule like P-VC-S, map children by their own cats
    for (const ch of kids) {
      const ck = roleOf(ch.cat, ch.rule);
      let childHint = next;
      if (ck === "subj" || ck === "verb" || ck === "obj" || ck === "prep" || ck === "pred" || ck === "adv") {
        childHint = ck;
      } else if (next !== "other") {
        childHint = next;
      }
      walk(ch, depth + (cat === "pp" || cat === "vp" || cat === "p" ? 1 : 0), childHint);
    }
  }

  walk(root, 0, "other");

  // Drop empty trailing clauses
  const cleaned = clauses.filter((c) => c.words.length > 0);
  if (cleaned.length === 0) {
    cleaned.push({ id: "empty", title: "Clause", words: [] });
  }

  // Prepend outline clause header for first group if missing
  if (outline.length && outline[0]!.kind === "word") {
    outline.unshift({
      id: "cl-main",
      kind: "clause",
      depth: 0,
      role: cleaned[0]?.title ?? "Main clause",
      roleKey: "other",
      isFocus: false,
    });
  }

  return { clauses: cleaned, outline, wordCount };
}

/* ─── component ────────────────────────────────────────────── */

type Props = {
  hit: LanguageSyntaxHit;
  dir?: "ltr" | "rtl";
  fillContainer?: boolean;
  chartWidth?: number;
  defaultMode?: "chart" | "outline";
};

export function SyntaxArtView({
  hit,
  dir = "ltr",
  defaultMode = "chart",
}: Props): React.JSX.Element {
  const [mode, setMode] = useState<"chart" | "outline">(defaultMode);
  const [hoverId, setHoverId] = useState<string | null>(null);

  const { clauses, outline, wordCount } = useMemo(
    () => buildFlow(hit.sentence.root, hit.focusTokenId),
    [hit.sentence.root, hit.focusTokenId],
  );

  const focus =
    clauses.flatMap((c) => c.words).find((w) => w.isFocus) ??
    clauses[0]?.words[0] ??
    null;

  const hover =
    hoverId != null
      ? clauses.flatMap((c) => c.words).find((w) => w.id === hoverId) ?? null
      : null;
  const spotlight = hover ?? focus;

  return (
    <div className="lang-syntax lang-syntax--modal">
      <div className="lang-syntax-modes" role="tablist" aria-label="Structure view">
        <button
          type="button"
          role="tab"
          className={`lang-syntax-mode${mode === "chart" ? " is-active" : ""}`}
          aria-selected={mode === "chart"}
          onClick={() => setMode("chart")}
        >
          Chart
        </button>
        <button
          type="button"
          role="tab"
          className={`lang-syntax-mode${mode === "outline" ? " is-active" : ""}`}
          aria-selected={mode === "outline"}
          onClick={() => setMode("outline")}
        >
          Outline
        </button>
        <span className="lang-syntax-meta">
          {wordCount} words · {clauses.length} clause{clauses.length === 1 ? "" : "s"} ·{" "}
          {hit.sentence.refLabel}
        </span>
      </div>

      {mode === "chart" ? (
        <div className="lang-flow">
          <p className="lang-flow-intro">
            Reading order · color = grammatical role · selected word highlighted
          </p>
          <div className="lang-flow-scroll">
            {clauses.map((cl) => (
              <section key={cl.id} className="lang-flow-clause">
                <header className="lang-flow-clause-head">
                  <span className="lang-flow-clause-title">{cl.title}</span>
                  {cl.rule ? (
                    <span className="lang-flow-clause-rule" title="MACULA rule tag">
                      {cl.rule}
                    </span>
                  ) : null}
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
