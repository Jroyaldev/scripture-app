/**
 * Structure (syntax) — pastor-usable view of a MACULA sentence.
 *
 * Pastors use syntax for: clause breaks, who-does-what, argument flow
 * (phrasing / propositional display) — not dense academic trees in a
 * narrow margin. Default view is an indented outline in reading order.
 * Optional compact word-strip for a quick scan.
 *
 * Structure data: Clear Bible MACULA (CC BY). Presentation: Shepherdly.
 */

import React, { useMemo, useState } from "react";
import type { LanguageSyntaxHit, LanguageSyntaxNode } from "../api.js";

type OutlineRow = {
  id: string;
  kind: "clause" | "word";
  depth: number;
  /** Pastor-facing role, e.g. Subject, Verb, Prep. */
  role: string;
  roleKey: string;
  surface?: string;
  gloss?: string;
  tokenId?: string;
  isFocus: boolean;
  /** Optional clause rule hint (e.g. P-VC-S) for power users. */
  rule?: string;
};

/** Map MACULA cats → short pastoral labels. */
function roleFromCat(cat: string, rule?: string): { key: string; label: string } {
  const c = (cat ?? "").toLowerCase();
  const r = (rule ?? "").toUpperCase();

  if (c === "s") return { key: "sentence", label: "Sentence" };
  if (c === "cl") {
    if (r.includes("SUB") || r.includes("ADV")) return { key: "sub", label: "Subordinate" };
    return { key: "clause", label: "Clause" };
  }
  if (c === "subj") return { key: "subj", label: "Subject" };
  if (c === "vc" || c === "v" || c === "vp" || c === "verb") return { key: "verb", label: "Verb" };
  if (c === "o" || c === "obj" || c === "do" || c === "io") return { key: "obj", label: "Object" };
  if (c === "p" && (r.includes("PP") || r.includes("PREP"))) return { key: "prep", label: "Prep." };
  if (c === "p") return { key: "pred", label: "Predicate" };
  if (c === "pp" || c === "prep") return { key: "prep", label: "Prep." };
  if (c === "adv" || c === "advp") return { key: "adv", label: "Adverbial" };
  if (c === "adj" || c === "adjp") return { key: "adj", label: "Modifier" };
  if (c === "conj" || c === "c") return { key: "conj", label: "Connector" };
  if (c === "det" || c === "art" || c === "article") return { key: "det", label: "Article" };
  if (c === "np") return { key: "np", label: "Noun phrase" };
  if (c === "noun") return { key: "noun", label: "Noun" };
  if (c === "pron") return { key: "pron", label: "Pronoun" };
  if (c === "adj") return { key: "adj", label: "Adjective" };
  if (c === "ptcl" || c === "particle") return { key: "ptcl", label: "Particle" };
  if (c.length <= 5) return { key: c || "x", label: cat || "·" };
  return { key: "other", label: cat.slice(0, 8) };
}

function inheritRole(node: LanguageSyntaxNode, parentRole: string): string {
  const own = roleFromCat(node.cat, node.rule);
  // Structural wrappers pass role through
  if (own.key === "np" || own.key === "sentence" || own.key === "clause") {
    return parentRole || own.key;
  }
  if (own.key === "pred" || own.key === "subj" || own.key === "verb" || own.key === "obj" || own.key === "prep") {
    return own.key;
  }
  return parentRole || own.key;
}

function flattenOutline(
  root: LanguageSyntaxNode,
  focusTokenId: string,
): OutlineRow[] {
  const rows: OutlineRow[] = [];
  let wordI = 0;

  function walk(node: LanguageSyntaxNode, depth: number, roleHint: string): void {
    const cat = (node.cat ?? "").toLowerCase();
    const isClause = cat === "cl" || cat === "s";

    if (node.tokenId || (!node.children?.length && (node.surface || node.gloss))) {
      const role = roleFromCat(node.cat, node.rule);
      // Prefer inherited functional role (Subject/Verb) over bare "noun"
      const functional =
        roleHint && !["np", "sentence", "clause", "other", "noun", "det"].includes(roleHint)
          ? roleHint
          : role.key;
      const label =
        functional === role.key
          ? role.label
          : roleFromCat(
              functional === "subj"
                ? "Subj"
                : functional === "verb"
                  ? "V"
                  : functional === "obj"
                    ? "O"
                    : functional === "prep"
                      ? "pp"
                      : functional === "pred"
                        ? "P"
                        : node.cat,
              node.rule,
            ).label;

      rows.push({
        id: node.tokenId ?? node.id ?? `w${wordI++}`,
        kind: "word",
        depth: Math.min(depth, 5),
        role: label,
        roleKey: functional,
        surface: node.surface,
        gloss: cleanGloss(node.gloss),
        tokenId: node.tokenId,
        isFocus: node.tokenId === focusTokenId,
      });
      return;
    }

    if (isClause && depth > 0) {
      const cr = roleFromCat(node.cat, node.rule);
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

    const nextRole = inheritRole(node, roleHint);
    // Bump depth for meaningful phrase boxes, not every unary wrapper
    const bump =
      cat === "cl" || cat === "pp" || cat === "vp" || cat === "subj" || cat === "p" ? 1 : 0;
    for (const ch of node.children ?? []) {
      walk(ch, depth + bump, nextRole);
    }
  }

  walk(root, 0, "");
  return rows;
}

function cleanGloss(g?: string): string | undefined {
  if (!g) return undefined;
  return g
    .replace(/\[[^\]]*]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 36);
}

type Props = {
  hit: LanguageSyntaxHit;
  dir?: "ltr" | "rtl";
  lang?: string;
};

export function SyntaxArtView({ hit, dir = "ltr" }: Props): React.JSX.Element {
  const [mode, setMode] = useState<"outline" | "strip">("outline");
  const rows = useMemo(
    () => flattenOutline(hit.sentence.root, hit.focusTokenId),
    [hit.sentence.root, hit.focusTokenId],
  );
  const words = rows.filter((r) => r.kind === "word");
  const focus = words.find((r) => r.isFocus) ?? words[0];
  const clauseCount = rows.filter((r) => r.kind === "clause").length + 1;

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
          className={`lang-syntax-mode${mode === "outline" ? " is-active" : ""}`}
          aria-selected={mode === "outline"}
          onClick={(e) => {
            e.stopPropagation();
            setMode("outline");
          }}
        >
          Outline
        </button>
        <button
          type="button"
          role="tab"
          className={`lang-syntax-mode${mode === "strip" ? " is-active" : ""}`}
          aria-selected={mode === "strip"}
          onClick={(e) => {
            e.stopPropagation();
            setMode("strip");
          }}
        >
          Words
        </button>
        <span className="lang-syntax-meta">
          {words.length} words
          {clauseCount > 1 ? ` · ${clauseCount} clauses` : ""}
        </span>
      </div>

      {mode === "outline" ? (
        <ul className="lang-syntax-outline" aria-label="Clause outline">
          {rows.map((row) =>
            row.kind === "clause" ? (
              <li
                key={row.id}
                className="lang-syntax-clause"
                style={{ paddingLeft: 8 + row.depth * 12 }}
              >
                <span className="lang-syntax-clause-label">{row.role}</span>
                {row.rule ? (
                  <span className="lang-syntax-clause-rule" title="MACULA rule">
                    {row.rule}
                  </span>
                ) : null}
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
      ) : (
        <div className="lang-syntax-strip" dir={dir} aria-label="Words in order">
          {words.map((w) => (
            <span
              key={w.id}
              className={`lang-syntax-chip role-${w.roleKey}${w.isFocus ? " is-focus" : ""}`}
              title={`${w.role}${w.gloss ? ` · ${w.gloss}` : ""}`}
            >
              <span className="lang-syntax-chip-grk">{w.surface}</span>
              {w.gloss ? <span className="lang-syntax-chip-en" dir="ltr">{w.gloss}</span> : null}
            </span>
          ))}
        </div>
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

      <p className="lang-syntax-hint">
        Who does what · clause flow · selected word highlighted
      </p>
      <p className="lang-syntax-attr">MACULA · Clear Bible · CC BY</p>
    </div>
  );
}
