/**
 * Rendering Orbit — quantitative donut for forward / reverse corpus modes,
 * plus the structural outline model used by Senses.
 *
 * Colors: --viz-* tokens. Full-circle uses two half-arcs (never degenerate).
 * Two-step activate when onSelectSegment is set: first tap focuses, second jumps.
 */

import React, { useEffect, useMemo, useState } from "react";
import type {
  LanguageOrbitSegment,
  LanguageRenderingOrbit,
  LanguageReverseOrbit,
  LanguageSemanticSenseOutline,
} from "../api.js";


/** Shared orbit shape so all modes use one renderer. */
export type OrbitViewModel = {
  hubLabel: string;
  hubMeta?: string;
  total: number;
  /** When empty, parent owns the kicker (mode pills). */
  kicker: string;
  segments: LanguageOrbitSegment[];
  ariaLabel: string;
  hubDir?: "ltr" | "rtl";
  /** Set false for a future non-frequency orbit that must hide counts. */
  countMeta?: boolean;
};

export function forwardOrbitModel(
  orbit: LanguageRenderingOrbit,
  surface?: string,
): OrbitViewModel {
  return {
    hubLabel: surface ?? orbit.lemma,
    hubMeta: orbit.strongPrefixed,
    total: orbit.total,
    kicker: "",
    segments: orbit.segments,
    ariaLabel: `How ${orbit.lemma} is rendered in English`,
    countMeta: true,
  };
}

export function reverseOrbitModel(orbit: LanguageReverseOrbit): OrbitViewModel {
  const scopeParts = (orbit.scopeHint ?? "whole Bible").split(/\s*·\s*/).filter(Boolean);
  return {
    hubLabel: orbit.englishWord,
    // The scope belongs beside the use count; only the compact source label
    // fits inside the 70px hub without crossing the ring.
    hubMeta: scopeParts.length > 1 ? scopeParts[scopeParts.length - 1] : undefined,
    total: orbit.total,
    kicker: "",
    segments: orbit.segments,
    ariaLabel: `Original-language lemmas behind “${orbit.englishWord}”`,
    hubDir: "ltr",
    countMeta: true,
  };
}

/**
 * Only unique numeric top-level senses make the mode eligible. Descendants
 * remain attached to those roots; one primary sense needs no separate mode.
 */
export function topLevelSenses(
  senses: Array<{ n: string; text: string; label?: string }>,
): Array<{ n: string; text: string; label?: string }> {
  const allNumbers = senses.map((sense) => sense.n.trim());
  if (new Set(allNumbers).size !== allNumbers.length) return [];
  const top = senses.filter((sense) => /^\d+$/.test(sense.n.trim()));
  return top.length > 1 ? top : [];
}

export type SenseOutlineNode = {
  n: string;
  text: string;
  label?: string;
  detail?: string;
  meta?: string;
  current?: boolean;
  children: SenseOutlineNode[];
};

export type SenseOutlineModel = {
  lemma: string;
  strongId?: string;
  source?: string;
  shape: "flat" | "hierarchical";
  total: number;
  hiddenCount?: number;
  nodes: SenseOutlineNode[];
  ariaLabel: string;
};

/**
 * Lexicon senses are a tree, not a measured distribution. Preserve that tree
 * for the outline while retaining the same eligibility rule as the old pill:
 * at least two unique numeric top-level senses.
 */
export function senseOutlineModel(opts: {
  lemma: string;
  senses: Array<{ n: string; text: string; label?: string }>;
  strongId?: string;
  source?: string;
}): SenseOutlineModel | null {
  const top = topLevelSenses(opts.senses);
  if (top.length < 2) return null;

  const nodesByNumber = new Map<string, SenseOutlineNode>();
  const roots: SenseOutlineNode[] = [];

  for (const rawSense of opts.senses) {
    const n = rawSense.n.trim();
    const node: SenseOutlineNode = {
      n,
      text: rawSense.text.trim(),
      ...(rawSense.label?.trim() ? { label: rawSense.label.trim() } : {}),
      children: [],
    };
    nodesByNumber.set(n, node);

    if (/^\d+$/.test(n)) {
      roots.push(node);
      continue;
    }

    const parent = [...nodesByNumber.values()]
      .filter((candidate) => candidate.n.length < n.length && n.startsWith(candidate.n))
      .sort((a, b) => b.n.length - a.n.length)[0];
    parent?.children.push(node);
  }

  return {
    lemma: opts.lemma,
    ...(opts.strongId ? { strongId: opts.strongId } : {}),
    ...(opts.source ? { source: opts.source } : {}),
    shape: roots.some((node) => node.children.length > 0) ? "hierarchical" : "flat",
    total: roots.length,
    nodes: roots,
    ariaLabel: `Lexicon sense outline for ${opts.lemma}`,
  };
}

/** Adapt occurrence-tagged MACULA/MARBLE senses to the shared outline view. */
export function semanticSenseOutlineModel(opts: {
  lemma: string;
  outline: LanguageSemanticSenseOutline;
  strongId?: string;
}): SenseOutlineModel | null {
  if (opts.outline.total < 2 || opts.outline.senses.length < 2) return null;
  return {
    lemma: opts.lemma,
    ...(opts.strongId ? { strongId: opts.strongId } : {}),
    source: "MACULA · MARBLE · CC BY 4.0",
    shape: "flat",
    total: opts.outline.total,
    hiddenCount: opts.outline.hiddenCount,
    nodes: opts.outline.senses.map((sense) => ({
      n: String(sense.rank),
      text: sense.label,
      label: sense.label,
      detail: sense.label,
      meta: [
        sense.current ? "Used here" : null,
        `${sense.count} occurrence${sense.count === 1 ? "" : "s"}`,
        sense.domain ?? null,
      ].filter(Boolean).join(" · "),
      current: sense.current,
      children: [],
    })),
    ariaLabel: `Context-tagged semantic range for ${opts.lemma}`,
  };
}

function senseTextParts(text: string): { qualifier: string | null; text: string } {
  const match = text.trim().match(/^\(([^)]+)\)\s*(.*)$/);
  const qualifier = match?.[1]?.trim() || null;
  const body = (match?.[2] ?? text).trim().replace(/^to\s+/i, "");
  return { qualifier, text: body };
}

function primarySenseLabel(text: string): string {
  const body = senseTextParts(text).text;
  return body ? `${body.charAt(0).toUpperCase()}${body.slice(1)}` : text;
}

export type FlatSensePresentation = {
  summary: string;
  detail: string | null;
};

/**
 * Thayer emits flat scholarly paragraphs. Use the exact first source clause
 * as the closed label; reveal the remaining prose rather than inventing a
 * hierarchy or an AI-authored summary.
 */
export function flatSensePresentation(text: string, sourceLabel?: string): FlatSensePresentation {
  const normalized = text.replace(/\s+/g, " ").trim();
  let separator = -1;
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (ch !== ":" && ch !== ";") continue;
    if (ch === ":" && /(?:[1-3])?[A-Z][a-z]{1,8}_\d+$/.test(normalized.slice(0, i))) continue;
    separator = i;
    break;
  }
  const rawLead = (separator >= 0 ? normalized.slice(0, separator) : normalized)
    .replace(/^to\s+/i, "")
    .trim();
  const lead = rawLead
    ? `${rawLead.charAt(0).toUpperCase()}${rawLead.slice(1)}`
    : normalized;
  const maxSummary = 78;
  const clipped = lead.length > maxSummary;
  const summary = clipped ? `${lead.slice(0, maxSummary - 1).trimEnd()}…` : lead;
  const supplied = sourceLabel?.trim();
  const suppliedSummary = supplied
    ? `${supplied.charAt(0).toUpperCase()}${supplied.slice(1)}`
    : null;
  // Opening a row repeats the complete sentence. A fragment beginning after
  // punctuation made the old accordion feel broken and hid its subject.
  const detail = normalized.length >= 3 ? normalized : null;
  return { summary: suppliedSummary ?? summary, detail };
}

const SCRIPTURE_REF_PART = /(\b(?:[1-3])?[A-Z][a-z]{1,6}_\d+:\d+\b)/g;
const SCRIPTURE_REF_EXACT = /^(?:[1-3])?[A-Z][a-z]{1,6}_\d+:\d+$/;

function SenseProse({ text }: { text: string }): React.JSX.Element {
  return (
    <>
      {text.split(SCRIPTURE_REF_PART).map((part, index) =>
        SCRIPTURE_REF_EXACT.test(part) ? (
          <span key={`${part}-${index}`} className="lang-sense-ref">
            {part.replace("_", " ")}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

function normalizedGrammar(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z\p{L}]+/gu, "");
}

function grammarIsActive(grammar: string | null, activeMorphLabels: readonly string[]): boolean {
  if (!grammar) return false;
  const target = normalizedGrammar(grammar);
  return activeMorphLabels.some((label) => normalizedGrammar(label) === target);
}

function firstActiveBranch(
  nodes: readonly SenseOutlineNode[],
  activeMorphLabels: readonly string[],
): SenseOutlineNode | null {
  for (const node of nodes) {
    if (grammarIsActive(senseTextParts(node.text).qualifier, activeMorphLabels)) return node;
    const nested = firstActiveBranch(node.children, activeMorphLabels);
    if (nested) return nested;
  }
  return null;
}

function containsNode(root: SenseOutlineNode, n: string): boolean {
  return root.n === n || root.children.some((child) => containsNode(child, n));
}

function SenseBranch({
  node,
  activeMorphLabels,
  openBranches,
  onToggle,
}: {
  node: SenseOutlineNode;
  activeMorphLabels: readonly string[];
  openBranches: ReadonlySet<string>;
  onToggle: (n: string) => void;
}): React.JSX.Element {
  const parts = senseTextParts(node.text);
  const hasChildren = node.children.length > 0;
  const open = hasChildren && openBranches.has(node.n);
  const current = grammarIsActive(parts.qualifier, activeMorphLabels);
  const content = (
    <>
      {parts.qualifier ? (
        <span className="lang-sense-qualifier">{parts.qualifier}</span>
      ) : (
        <span className="lang-sense-dot" aria-hidden="true" />
      )}
      {parts.text ? <span className="lang-sense-branch-text">{parts.text}</span> : null}
      {hasChildren ? (
        <span className={`lang-sense-caret${open ? " is-open" : ""}`} aria-hidden="true">
          ›
        </span>
      ) : null}
    </>
  );

  return (
    <div className={`lang-sense-branch${current ? " is-current" : ""}`}>
      {hasChildren ? (
        <button
          type="button"
          className="lang-sense-branch-row"
          aria-expanded={open}
          onClick={() => onToggle(node.n)}
        >
          {content}
        </button>
      ) : (
        <div className="lang-sense-branch-row">{content}</div>
      )}
      {open ? (
        <div className="lang-sense-children">
          {node.children.map((child) => (
            <SenseBranch
              key={child.n}
              node={child}
              activeMorphLabels={activeMorphLabels}
              openBranches={openBranches}
              onToggle={onToggle}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function SenseOutlineView({
  model,
  activeMorphLabels = [],
}: {
  model: SenseOutlineModel;
  activeMorphLabels?: readonly string[];
}): React.JSX.Element {
  const activeBranch = useMemo(
    () =>
      model.shape === "hierarchical"
        ? firstActiveBranch(model.nodes, activeMorphLabels)
        : null,
    [activeMorphLabels, model.nodes, model.shape],
  );
  const initialRoot =
    model.shape === "hierarchical"
      ? ((activeBranch && model.nodes.find((node) => containsNode(node, activeBranch.n))) ??
        model.nodes[0] ??
        null)
      : null;
  const [openRoot, setOpenRoot] = useState<string | null>(initialRoot?.n ?? null);
  const [openBranches, setOpenBranches] = useState<Set<string>>(
    () => new Set(activeBranch?.children.length ? [activeBranch.n] : []),
  );

  useEffect(() => {
    setOpenRoot(initialRoot?.n ?? null);
    setOpenBranches(new Set(activeBranch?.children.length ? [activeBranch.n] : []));
  }, [activeBranch, initialRoot?.n, model.lemma, model.shape, model.strongId]);

  const toggleBranch = (n: string): void => {
    setOpenBranches((current) => {
      const next = new Set(current);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  };

  return (
    <div
      className={`lang-sense-outline is-${model.shape}`}
      aria-label={model.ariaLabel}
    >
      {model.nodes.map((node) => {
        const open = openRoot === node.n;
        const hasChildren = node.children.length > 0;
        const flat = model.shape === "flat";
        const flatPresentation = flat
          ? node.detail
            ? { summary: node.label ?? node.text, detail: node.detail }
            : flatSensePresentation(node.text, node.label)
          : null;
        const expandable = flat ? flatPresentation?.detail != null : hasChildren;
        const rowContent = (
          <>
            <span className="lang-sense-number">{node.n}</span>
            <span className="lang-sense-primary-title-wrap">
              <span className="lang-sense-primary-title">
                {flatPresentation?.summary ?? primarySenseLabel(node.text)}
              </span>
              {node.current ? <span className="lang-sense-here">here</span> : null}
            </span>
            {expandable ? (
              <span className={`lang-sense-caret${open ? " is-open" : ""}`} aria-hidden="true">
                ›
              </span>
            ) : null}
          </>
        );
        return (
          <section
            key={node.n}
            className={`lang-sense-primary${open ? " is-open" : ""}${node.current ? " is-current" : ""}`}
            style={{ "--sense-color": "var(--study-gold)" } as React.CSSProperties}
          >
            {expandable ? (
              <button
                type="button"
                className="lang-sense-primary-row"
                aria-expanded={open}
                title={node.text}
                onClick={() => setOpenRoot((current) => (current === node.n ? null : node.n))}
              >
                {rowContent}
              </button>
            ) : (
              <div className="lang-sense-primary-row" title={node.text}>
                {rowContent}
              </div>
            )}
            {flat && open && flatPresentation?.detail ? (
              <div className="lang-sense-flat-detail">
                <p>
                  <SenseProse text={flatPresentation.detail} />
                </p>
                {node.meta ? <p className="lang-sense-detail-meta">{node.meta}</p> : null}
                {model.source ? <span className="lang-sense-source">{model.source}</span> : null}
              </div>
            ) : !flat && open ? (
              <div className="lang-sense-branches">
                {node.children.map((child) => (
                  <SenseBranch
                    key={child.n}
                    node={child}
                    activeMorphLabels={activeMorphLabels}
                    openBranches={openBranches}
                    onToggle={toggleBranch}
                  />
                ))}
              </div>
            ) : null}
          </section>
        );
      })}
      {(model.hiddenCount ?? 0) > 0 ? (
        <div className="lang-sense-more">+{model.hiddenCount} less common</div>
      ) : null}
    </div>
  );
}

type Props = {
  model?: OrbitViewModel;
  orbit?: LanguageRenderingOrbit;
  surface?: string;
  dir?: "ltr" | "rtl";
  lang?: string;
  /**
   * Two-step: first activation focuses; second on the focused row fires this.
   * Hover still previews (updates focus line) without navigating.
   */
  onSelectSegment?: (index: number, segment: LanguageOrbitSegment) => void;
};

export function RenderingOrbitView({
  model: modelProp,
  orbit,
  surface,
  onSelectSegment,
}: Props): React.JSX.Element | null {
  const model: OrbitViewModel | null = modelProp
    ? modelProp
    : orbit
      ? forwardOrbitModel(orbit, surface)
      : null;

  const [focusIdx, setFocusIdx] = useState<number | null>(null);

  // Reset sticky focus when the model changes (mode switch / new word).
  useEffect(() => {
    setFocusIdx(null);
  }, [model?.hubLabel, model?.segments]);

  if (!model || model.segments.length === 0) return null;

  /**
   * Three ranked rows, and a count for the rest. The donut this replaces put
   * nine hues on screen to say one thing — which rendering dominates — and its
   * legend was already saying it in words. Three rows say it in reading order,
   * with the proportion rule doing the comparing.
   */
  const RANKED = 3;
  const ranked = model.segments.slice(0, RANKED);
  const remainder = model.segments.length - ranked.length;

  const active =
    focusIdx !== null
      ? model.segments[focusIdx]
      : model.segments.find((s) => s.isCurrent) ?? model.segments[0];
  const showCounts = model.countMeta !== false;

  const activate = (i: number): void => {
    if (onSelectSegment && focusIdx === i) {
      const seg = model.segments[i];
      if (seg) onSelectSegment(i, seg);
      return;
    }
    setFocusIdx(i);
  };

  return (
    <div className="lang-orbit">
      {model.kicker ? (
        <div className="lang-orbit-kicker">
          <span className="lang-orbit-kind">{model.kicker}</span>
          <span className="lang-orbit-count">
            {showCounts ? `${model.total} uses` : `${model.total} senses`}
          </span>
        </div>
      ) : null}
      <div className="lang-orbit-body">
        <div className="lang-orbit-legend" role="img" aria-label={model.ariaLabel}>
          {ranked.map((seg, i) => (
            <button
              key={`${seg.label}-${i}`}
              type="button"
              className={`lang-orbit-row${seg.isCurrent ? " is-current" : ""}${focusIdx === i ? " is-hover" : ""}${onSelectSegment ? " is-interactive" : ""}`}
              data-rank={i + 1}
              onMouseEnter={() => setFocusIdx(i)}
              onFocus={() => setFocusIdx(i)}
              onClick={() => activate(i)}
              title={seg.label}
            >
              <span className="lang-orbit-label">{seg.label}</span>
              {onSelectSegment && focusIdx === i ? (
                <span className="lang-orbit-open-hint">open →</span>
              ) : showCounts ? (
                <span className="lang-orbit-meta">
                  {seg.count}× {Math.round(seg.share * 100)}%
                </span>
              ) : null}
              {showCounts ? (
                /* One hue at three lightnesses by rank, not nine hues. The rule
                   IS the comparison; a swatch would only be a key to itself. */
                <span className="lang-orbit-rule" aria-hidden="true">
                  <i style={{ inlineSize: `${Math.max(2, Math.round(seg.share * 100))}%` }} />
                </span>
              ) : null}
            </button>
          ))}
          {remainder > 0 ? (
            <p className="lang-orbit-remainder">+{remainder} more</p>
          ) : null}
          {active && (
            <p className="lang-orbit-focus" aria-live="polite">
              <strong>{active.label}</strong>
              {showCounts ? (
                <>
                  {" "}
                  · {active.count} of {model.total}
                  {active.isCurrent ? " · this verse" : ""}
                </>
              ) : null}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
