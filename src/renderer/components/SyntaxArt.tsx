/**
 * Structure study: one truthful progression over a MACULA sentence.
 *
 * Clause is the primary source-order reading surface. Sentence map appears
 * only when the source sentence actually contains multiple clauses. Phrase
 * detail is an advanced drill-down from a real multi-word source branch.
 */

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  buildSyntaxStudyModel,
  syntaxStudyGroupsInSourceOrder,
  syntaxStudyPhraseStops,
  type SyntaxStudyClause,
  type SyntaxStudyGroup,
  type SyntaxStudyPhraseNode,
  type SyntaxStudyWord,
} from "../../core/language/syntax-study.js";
import {
  buildPhraseDiagramProjection,
  layoutPhraseDiagram,
  phraseDiagramPolicy,
  type PhraseDiagramLayout,
  type PhraseDiagramNode,
  type PhraseDiagramView,
} from "../../core/language/syntax-diagram.js";
import type { LanguageSyntaxHit } from "../api.js";

type Mode = "clause" | "sentence";

const VIEW_COPY: Record<Mode, { title: string; description: string }> = {
  clause: {
    title: "Clause detail",
    description:
      "Browse source-order groups; open any branched phrase for its diagram.",
  },
  sentence: {
    title: "Sentence map",
    description: "An overview of the sentence; choose any clause to jump there.",
  },
};

function OriginalWords({
  words,
  dir,
  className,
  maxWords,
}: {
  words: SyntaxStudyWord[];
  dir: "ltr" | "rtl";
  className: string;
  maxWords?: number;
}): React.JSX.Element {
  const focusIndex = words.findIndex((word) => word.isFocus);
  let start = 0;
  let end = words.length;
  if (maxWords && words.length > maxWords) {
    if (focusIndex >= 0) {
      start = Math.max(0, focusIndex - Math.floor(maxWords / 2));
      end = Math.min(words.length, start + maxWords);
      start = Math.max(0, end - maxWords);
    } else {
      end = maxWords;
    }
  }
  const visible = words.slice(start, end);
  return (
    <span className={className} dir={dir}>
      {start > 0 ? <span className="lang-source-ellipsis">… </span> : null}
      {visible.map((word, index) => (
        <React.Fragment key={word.id}>
          {index > 0 ? " " : null}
          <span className={word.isFocus ? "is-focus-word" : undefined}>{word.surface}</span>
        </React.Fragment>
      ))}
      {end < words.length ? <span className="lang-source-ellipsis"> …</span> : null}
    </span>
  );
}

/** Crop the composed source gloss; never rebuild English from untranslated token fragments. */
function groupGlossPreview(group: SyntaxStudyGroup, maxWords: number): string {
  const fallback = group.gloss || group.surface;
  const words = fallback.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return fallback;

  const focusGloss = group.words.find((word) => word.isFocus)?.gloss;
  const normalize = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const focusWords = focusGloss?.split(/\s+/).map(normalize).filter(Boolean) ?? [];
  let focusIndex = -1;
  if (focusWords.length) {
    focusIndex = words.findIndex((_, index) =>
      focusWords.every((focusWord, offset) => normalize(words[index + offset] ?? "") === focusWord),
    );
  }
  let start = focusIndex >= 0 ? Math.max(0, focusIndex - Math.floor(maxWords / 2)) : 0;
  let end = Math.min(words.length, start + maxWords);
  start = Math.max(0, end - maxWords);
  return `${start > 0 ? "… " : ""}${words.slice(start, end).join(" ")}${
    end < words.length ? " …" : ""
  }`;
}

function ClauseGroup({
  group,
  dir,
  expanded,
  onToggle,
}: {
  group: SyntaxStudyGroup;
  dir: "ltr" | "rtl";
  expanded: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  const className = `lang-flow-group role-${group.role}${group.isFocus ? " is-focus" : ""}${
    group.phrase ? " has-detail" : ""
  }${expanded ? " is-detail-open" : ""}`;
  const content = (
    <>
      <span className="lang-flow-group-role">{group.label}</span>
      <OriginalWords
        words={group.words}
        dir={dir}
        className="lang-flow-group-original"
        maxWords={12}
      />
      {group.gloss ? (
        <span className="lang-flow-group-gloss" dir="ltr">
          {groupGlossPreview(group, 14)}
        </span>
      ) : null}
      {group.phrase ? (
        <span className="lang-flow-group-detail">
          {expanded ? "detail open" : "phrase detail →"}
        </span>
      ) : null}
    </>
  );

  if (!group.phrase) return <div className={className}>{content}</div>;
  return (
    <button
      id={`structure-group-${group.id}`}
      type="button"
      className={className}
      aria-expanded={expanded}
      aria-controls="structure-phrase-detail"
      onClick={onToggle}
    >
      {content}
    </button>
  );
}

function PhraseTreeNode({
  node,
  dir,
  onOpenClause,
}: {
  node: SyntaxStudyPhraseNode;
  dir: "ltr" | "rtl";
  onOpenClause: (clauseId: string) => void;
}): React.JSX.Element {
  const hasChildren = node.children.length > 0;
  const [showAll, setShowAll] = useState(false);
  const branchLimit = 11;
  const focusIndex = node.children.findIndex((child) => child.containsFocus);
  let start = 0;
  let end = node.children.length;
  if (!showAll && node.children.length > branchLimit) {
    if (focusIndex >= 0) {
      start = Math.max(0, focusIndex - Math.floor(branchLimit / 2));
      end = Math.min(node.children.length, start + branchLimit);
      start = Math.max(0, end - branchLimit);
    } else {
      end = branchLimit;
    }
  }
  const visibleChildren = node.children.slice(start, end);
  const hiddenBefore = start;
  const hiddenAfter = node.children.length - end;
  return (
    <li
      className={`lang-phrase-tree-item kind-${node.kind}${
        node.containsFocus ? " contains-focus" : ""
      }${node.isFocus ? " is-focus" : ""}${
        node.edgeKind === "compressed-member" ? " edge-compressed" : ""
      }`}
    >
      <div className="lang-phrase-node">
        <span className="lang-phrase-node-label">
          {node.label}
          {node.isFocus ? <span className="lang-phrase-node-here">selected</span> : null}
        </span>
        {node.surface ? (
          <span className="lang-phrase-node-source" dir={dir}>
            {node.surface}
          </span>
        ) : null}
        {node.kind === "word" && node.gloss ? (
          <span className="lang-phrase-node-gloss" dir="ltr">
            {node.gloss}
          </span>
        ) : null}
        {node.relation ? <span className="lang-phrase-node-relation">{node.relation}</span> : null}
        {node.kind === "clause" && node.targetClauseId ? (
          <button
            type="button"
            className="lang-phrase-open-clause"
            dir="ltr"
            onClick={() => onOpenClause(node.targetClauseId!)}
          >
            Open clause →
          </button>
        ) : null}
      </div>
      {hasChildren ? (
        <ul>
          {hiddenBefore > 0 ? (
            <li className="lang-phrase-tree-gap" dir="ltr">
              {hiddenBefore} earlier {hiddenBefore === 1 ? "item" : "items"}
            </li>
          ) : null}
          {visibleChildren.map((child) => (
            <PhraseTreeNode
              key={child.id}
              node={child}
              dir={dir}
              onOpenClause={onOpenClause}
            />
          ))}
          {hiddenAfter > 0 ? (
            <li className="lang-phrase-tree-gap" dir="ltr">
              {hiddenAfter} more {hiddenAfter === 1 ? "item" : "items"}
            </li>
          ) : null}
          {node.children.length > branchLimit ? (
            <li className="lang-phrase-tree-more" dir="ltr">
              <button
                type="button"
                aria-expanded={showAll}
                onClick={() => setShowAll((current) => !current)}
              >
                {showAll ? "Show focused portion" : `Show all ${node.children.length} items`}
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </li>
  );
}

function flattenDiagramNodes(root: PhraseDiagramNode): PhraseDiagramNode[] {
  return [root, ...root.children.flatMap(flattenDiagramNodes)];
}

function PhraseDiagramNodeBody({
  node,
  dir,
}: {
  node: PhraseDiagramNode;
  dir: "ltr" | "rtl";
}): React.JSX.Element {
  const detail = node.kind === "word" ? node.gloss : node.relation;
  return (
    <>
      <span className="lang-phrase-diagram-label">
        {node.label}
        {node.isFocus ? <span className="lang-phrase-node-here">selected</span> : null}
      </span>
      {node.kind === "word" && node.surface ? (
        <span className="lang-phrase-diagram-source" dir={dir}>
          {node.surface}
        </span>
      ) : null}
      {detail ? (
        <span className="lang-phrase-diagram-detail" dir="ltr">
          {detail}
        </span>
      ) : null}
      {node.kind === "clause" ? (
        <span className="lang-phrase-diagram-action" dir="ltr">
          Open clause →
        </span>
      ) : null}
    </>
  );
}

function PhraseDiagram({
  phrase,
  dir,
  onOpenClause,
  onRequestOutline,
  onClose,
}: {
  phrase: SyntaxStudyPhraseNode;
  dir: "ltr" | "rtl";
  onOpenClause: (clauseId: string) => void;
  onRequestOutline: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const projection = useMemo(() => buildPhraseDiagramProjection(phrase), [phrase]);
  const indexed = useMemo(() => {
    const nodes = flattenDiagramNodes(projection.root);
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const parentById = new Map<string, string>();
    const depthById = new Map<string, number>();
    (function visit(node: PhraseDiagramNode, depth: number): void {
      depthById.set(node.id, depth);
      for (const child of node.children) {
        parentById.set(child.id, node.id);
        visit(child, depth + 1);
      }
    })(projection.root, 1);
    return { nodes, byId, parentById, depthById };
  }, [projection.root]);
  const focusNodeId = indexed.nodes.find((node) => node.isFocus)?.id ?? projection.root.id;
  const [layout, setLayout] = useState<PhraseDiagramLayout | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState(focusNodeId);
  const [activeNodeId, setActiveNodeId] = useState(focusNodeId);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setSelectedNodeId(focusNodeId);
    setActiveNodeId(focusNodeId);
  }, [focusNodeId, phrase.id]);

  useLayoutEffect(() => {
    const measureRoot = measureRef.current;
    if (!measureRoot) return;
    let cancelled = false;
    const measure = (): void => {
      if (cancelled) return;
      const sizes = [...measureRoot.querySelectorAll<HTMLElement>("[data-diagram-node]")].map(
        (element) => {
          const rect = element.getBoundingClientRect();
          return {
            id: element.dataset.diagramNode!,
            width: Math.ceil(rect.width),
            height: Math.ceil(rect.height),
          };
        },
      );
      if (sizes.length !== indexed.nodes.length) return;
      setLayout(
        layoutPhraseDiagram(projection.root, sizes, {
          direction: dir,
          horizontalGap: projection.strategy === "full" ? 26 : 20,
          verticalGap: projection.strategy === "full" ? 32 : 24,
        }),
      );
    };
    measure();
    void document.fonts?.ready.then(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(measureRoot);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [dir, indexed.nodes.length, projection.root]);

  useLayoutEffect(() => {
    if (!layout || !viewportRef.current) return;
    const selected = layout.nodes.find((node) => node.isFocus);
    if (!selected) return;
    viewportRef.current.scrollLeft = Math.max(
      0,
      selected.x + selected.width / 2 - viewportRef.current.clientWidth / 2,
    );
  }, [layout]);

  function moveFocus(nodeId: string | undefined): void {
    if (!nodeId) return;
    setActiveNodeId(nodeId);
    requestAnimationFrame(() => document.getElementById(`phrase-diagram-${nodeId}`)?.focus());
  }

  function onNodeKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    node: PhraseDiagramNode,
  ): void {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    // Modified arrows belong to the sentence-level Phrase navigator. Do not
    // also move the active node inside the diagram.
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Home") {
      event.preventDefault();
      moveFocus(focusNodeId);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(indexed.parentById.get(node.id));
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveFocus(node.children[0]?.id);
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const parent = indexed.byId.get(indexed.parentById.get(node.id) ?? "");
    if (!parent || !layout) return;
    const siblings = [...parent.children].sort((left, right) => {
      const leftX = layout.nodes.find((candidate) => candidate.id === left.id)?.x ?? 0;
      const rightX = layout.nodes.find((candidate) => candidate.id === right.id)?.x ?? 0;
      return leftX - rightX;
    });
    const index = siblings.findIndex((candidate) => candidate.id === node.id);
    const next = siblings[index + (event.key === "ArrowLeft" ? -1 : 1)];
    if (!next) return;
    event.preventDefault();
    moveFocus(next.id);
  }

  function activate(node: PhraseDiagramNode): void {
    if (node.kind === "summary") {
      onRequestOutline();
      return;
    }
    if (node.kind === "clause" && node.targetClauseId) {
      onOpenClause(node.targetClauseId);
      return;
    }
    setSelectedNodeId(node.id);
  }

  const selectedNode = indexed.byId.get(selectedNodeId) ?? indexed.byId.get(focusNodeId)!;
  return (
    <div className="lang-phrase-diagram-wrap">
      <div ref={measureRef} className="lang-phrase-diagram-measure" aria-hidden="true">
        {indexed.nodes.map((node) => (
          <div
            key={node.id}
            data-diagram-node={node.id}
            className={`lang-phrase-diagram-node kind-${node.kind}`}
          >
            <PhraseDiagramNodeBody node={node} dir={dir} />
          </div>
        ))}
      </div>
      {layout ? (
        <div
          ref={viewportRef}
          className="lang-phrase-diagram-viewport"
          role="tree"
          aria-label="Spatial phrase diagram"
        >
          <div
            className="lang-phrase-diagram-canvas"
            style={{ width: layout.width, height: layout.height }}
          >
            <svg
              className="lang-phrase-diagram-edges"
              width={layout.width}
              height={layout.height}
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              aria-hidden="true"
            >
              {layout.edges.map((edge) => (
                <path
                  key={`${edge.from}:${edge.to}`}
                  d={`M ${edge.x1} ${edge.y1} V ${edge.midY} H ${edge.x2} V ${edge.y2}`}
                  className={`${edge.isFocusPath ? "is-focus" : ""}${
                    edge.edgeKind === "compressed-member" ? " is-compressed" : ""
                  }`}
                  fill="none"
                />
              ))}
            </svg>
            {layout.nodes.map((node) => (
              <button
                key={node.id}
                id={`phrase-diagram-${node.id}`}
                type="button"
                role="treeitem"
                aria-selected={selectedNodeId === node.id}
                aria-level={indexed.depthById.get(node.id)}
                aria-expanded={node.children.length ? true : undefined}
                tabIndex={activeNodeId === node.id ? 0 : -1}
                className={`lang-phrase-diagram-node kind-${node.kind}${
                  node.containsFocus ? " contains-focus" : ""
                }${node.isFocus ? " is-focus" : ""}${
                  selectedNodeId === node.id ? " is-selected" : ""
                }`}
                style={{
                  left: node.x,
                  top: node.y,
                  width: node.width,
                  height: node.height,
                }}
                onClick={() => activate(node)}
                onFocus={() => setActiveNodeId(node.id)}
                onKeyDown={(event) => onNodeKeyDown(event, node)}
              >
                <PhraseDiagramNodeBody node={node} dir={dir} />
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="lang-phrase-diagram-loading">Laying out diagram…</div>
      )}
      <div className="lang-phrase-diagram-meta" dir="ltr">
        <span>
          {projection.strategy === "full"
            ? "Complete phrase diagram"
            : projection.strategy === "lineage"
              ? "Focused lineage diagram"
              : "Focused phrase diagram"}
        </span>
        {projection.hiddenNodeCount > 0 ? (
          <button type="button" onClick={onRequestOutline}>
            {projection.hiddenNodeCount} hidden · open outline →
          </button>
        ) : null}
        {projection.hasCompressedEdges ? (
          <span className="lang-phrase-diagram-key">Dashed = condensed source path</span>
        ) : null}
      </div>
      {selectedNode ? (
        <div className="lang-phrase-diagram-inspector" dir="ltr">
          <span>{selectedNode.label}</span>
          {selectedNode.surface ? <bdi dir={dir}>{selectedNode.surface}</bdi> : null}
          {selectedNode.kind === "word" && selectedNode.gloss ? (
            <span>{selectedNode.gloss}</span>
          ) : selectedNode.relation ? (
            <span>{selectedNode.relation}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PhraseDetail({
  group,
  dir,
  onClose,
  onOpenClause,
}: {
  group: SyntaxStudyGroup;
  dir: "ltr" | "rtl";
  onClose: () => void;
  onOpenClause: (clauseId: string) => void;
}): React.JSX.Element | null {
  const phrase = group.phrase;
  const detailRef = useRef<HTMLElement | null>(null);
  const policy = useMemo(() => (phrase ? phraseDiagramPolicy(phrase) : null), [phrase]);
  // PhraseDetail stays mounted while the reader moves through adjacent
  // phrases. Preserve an explicit Diagram/Outline choice across that journey.
  const [view, setView] = useState<PhraseDiagramView>(() => policy?.defaultView ?? "diagram");
  useLayoutEffect(() => {
    if (view === "diagram") {
      const scrollSurface = detailRef.current?.closest<HTMLElement>(".lang-flow");
      if (scrollSurface) scrollSurface.scrollTop = 0;
      return;
    }
    detailRef.current
      ?.querySelector<HTMLElement>(".lang-phrase-tree-item.is-focus")
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [group.id, view]);
  if (!phrase || !policy) return null;
  const reason =
    policy.reason === "linked-chain"
      ? "Linked chains scan more clearly as an outline."
      : policy.reason === "wide"
        ? "This phrase has a wide source branch."
        : policy.reason === "deep"
          ? "This phrase has deep source nesting."
          : policy.reason === "large"
            ? "This phrase contains many source nodes."
            : null;
  return (
    <section
      ref={detailRef}
      id="structure-phrase-detail"
      className="lang-phrase-detail"
      aria-label={`${group.label} phrase detail`}
      tabIndex={-1}
    >
      <header className="lang-phrase-detail-head">
        <div className="lang-phrase-detail-heading">
          <span className="lang-phrase-detail-kicker">
            {group.label} · {phrase.label}
          </span>
          <OriginalWords
            words={group.words}
            dir={dir}
            className="lang-phrase-detail-source"
            maxWords={18}
          />
          {group.gloss ? <p>{groupGlossPreview(group, 24)}</p> : null}
        </div>
        <div className="lang-phrase-detail-controls">
          <div className="lang-phrase-detail-views" role="group" aria-label="Phrase detail view">
            <button
              type="button"
              className={view === "diagram" ? "is-active" : ""}
              aria-pressed={view === "diagram"}
              onClick={() => setView("diagram")}
            >
              Diagram
            </button>
            <button
              type="button"
              className={view === "outline" ? "is-active" : ""}
              aria-pressed={view === "outline"}
              onClick={() => setView("outline")}
            >
              Outline
            </button>
          </div>
          <button type="button" className="lang-phrase-detail-close" onClick={onClose}>
            ← Clause
          </button>
        </div>
      </header>
      {reason && view === "outline" ? (
        <p className="lang-phrase-detail-recommendation">
          {reason} Diagram remains available as a focused projection.
        </p>
      ) : null}
      {view === "diagram" ? (
        <PhraseDiagram
          phrase={phrase}
          dir={dir}
          onOpenClause={onOpenClause}
          onRequestOutline={() => setView("outline")}
          onClose={onClose}
        />
      ) : (
        <ul
          className="lang-phrase-tree"
          dir={dir}
          aria-label={`${group.label} phrase outline`}
        >
          <PhraseTreeNode node={phrase} dir={dir} onOpenClause={onOpenClause} />
        </ul>
      )}
    </section>
  );
}

function clausePosition(clause: SyntaxStudyClause, clauses: SyntaxStudyClause[]): string {
  const index = clauses.findIndex((candidate) => candidate.id === clause.id);
  return `Clause ${Math.max(0, index) + 1} of ${clauses.length}`;
}

function shortTextPreview(value: string, maxWords = 5): string {
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return value;
  return `${words.slice(0, maxWords).join(" ")} …`;
}

function clauseNavigatorPreview(clause: SyntaxStudyClause, index: number): string {
  const preview = shortTextPreview(clause.gloss || clause.surface, 5);
  return `${clause.label} ${index + 1}${preview ? ` · ${preview}` : ""}`;
}

function phraseNavigatorPreview(group: SyntaxStudyGroup): string {
  const preview = shortTextPreview(group.gloss || group.surface, 5);
  return `${group.label}${preview ? ` · ${preview}` : ""}`;
}

function StudyNavigator({
  kind,
  position,
  total,
  context,
  previousPreview,
  nextPreview,
  onPrevious,
  onNext,
  returnLabel,
  onReturn,
}: {
  kind: "clause" | "phrase";
  position: number;
  total: number;
  context?: string;
  previousPreview?: string;
  nextPreview?: string;
  onPrevious?: () => void;
  onNext?: () => void;
  returnLabel?: string;
  onReturn?: () => void;
}): React.JSX.Element {
  const label = kind === "phrase" ? "Phrase" : "Clause";
  return (
    <nav className="lang-study-nav" aria-label={`${label} navigation`}>
      <button
        type="button"
        className="lang-study-nav-step is-previous"
        aria-disabled={!onPrevious}
        aria-keyshortcuts="Alt+ArrowLeft"
        tabIndex={onPrevious ? 0 : -1}
        onClick={onPrevious}
      >
        <span className="lang-study-nav-direction">
          <span>← Previous {kind}</span>
          <kbd>⌥←</kbd>
        </span>
        <span className="lang-study-nav-preview">
          {previousPreview ?? "Start of sentence"}
        </span>
      </button>

      <div className="lang-study-nav-position" aria-live="polite" aria-atomic="true">
        <span>
          {label} {position} of {total}
        </span>
        {context ? <small>{context}</small> : null}
        {onReturn && returnLabel ? (
          <button type="button" className="lang-study-nav-return" onClick={onReturn}>
            {returnLabel}
          </button>
        ) : null}
      </div>

      <button
        type="button"
        className="lang-study-nav-step is-next"
        aria-disabled={!onNext}
        aria-keyshortcuts="Alt+ArrowRight"
        tabIndex={onNext ? 0 : -1}
        onClick={onNext}
      >
        <span className="lang-study-nav-direction">
          <span>Next {kind} →</span>
          <kbd>⌥→</kbd>
        </span>
        <span className="lang-study-nav-preview">
          {nextPreview ?? "End of sentence"}
        </span>
      </button>
    </nav>
  );
}

type Props = {
  hit: LanguageSyntaxHit;
  dir?: "ltr" | "rtl";
};

export function SyntaxArtView({ hit, dir = "ltr" }: Props): React.JSX.Element {
  const [active, setActive] = useState<Mode>("clause");
  const [detailGroupId, setDetailGroupId] = useState<string | null>(null);
  const [viewClauseId, setViewClauseId] = useState<string | null>(null);
  const outlineRef = useRef<HTMLDivElement | null>(null);
  const study = useMemo(
    () => buildSyntaxStudyModel(hit.sentence.root, hit.focusTokenId),
    [hit.sentence.root, hit.focusTokenId],
  );
  const clauseCount = study.clauses.length;
  const modes = useMemo(
    () =>
      clauseCount > 1
        ? ([
            { id: "clause", label: "Clause" },
            { id: "sentence", label: "Sentence map" },
          ] as const)
        : ([{ id: "clause", label: "Clause" }] as const),
    [clauseCount],
  );
  const sourceClause = study.clauses.find((clause) => clause.id === study.focusClauseId) ?? null;
  const sourceGroup =
    sourceClause?.groups.find((group) => group.isFocus) ??
    study.clauses.flatMap((clause) => clause.groups).find((group) => group.isFocus) ??
    null;
  const viewClause = study.clauses.find((clause) => clause.id === viewClauseId) ?? sourceClause;
  const detailGroup = viewClause?.groups.find((group) => group.id === detailGroupId) ?? null;
  const phraseStops = useMemo(
    () =>
      syntaxStudyPhraseStops(study).flatMap((stop) => {
        const clause = study.clauses.find((candidate) => candidate.id === stop.clauseId);
        const group = clause?.groups.find((candidate) => candidate.id === stop.groupId);
        return clause && group?.phrase ? [{ clause, group }] : [];
      }),
    [study],
  );
  const viewClauseIndex = viewClause
    ? study.clauses.findIndex((clause) => clause.id === viewClause.id)
    : -1;
  const detailPhraseIndex =
    detailGroup && viewClause
      ? phraseStops.findIndex(
          (stop) => stop.clause.id === viewClause.id && stop.group.id === detailGroup.id,
        )
      : -1;
  const previousClause = viewClauseIndex > 0 ? study.clauses[viewClauseIndex - 1] : undefined;
  const nextClause =
    viewClauseIndex >= 0 && viewClauseIndex < study.clauses.length - 1
      ? study.clauses[viewClauseIndex + 1]
      : undefined;
  const previousPhrase =
    detailPhraseIndex > 0 ? phraseStops[detailPhraseIndex - 1] : undefined;
  const nextPhrase =
    detailPhraseIndex >= 0 && detailPhraseIndex < phraseStops.length - 1
      ? phraseStops[detailPhraseIndex + 1]
      : undefined;

  useEffect(() => {
    setActive("clause");
    setDetailGroupId(null);
    setViewClauseId(null);
  }, [hit.focusTokenId, hit.sentence.id]);

  useLayoutEffect(() => {
    if (active !== "sentence" || !outlineRef.current) return;
    const selected = outlineRef.current.querySelector<HTMLElement>(".lang-outline-clause.is-focus");
    if (!selected) return;
    const containerRect = outlineRef.current.getBoundingClientRect();
    const selectedRect = selected.getBoundingClientRect();
    const selectedTop = selectedRect.top - containerRect.top + outlineRef.current.scrollTop;
    // Keep a little preceding context instead of dead-centering the row.
    outlineRef.current.scrollTop = Math.max(0, selectedTop - 64);
  }, [active, study.focusClauseId]);

  function openClause(clause: SyntaxStudyClause, focusTab = true): void {
    setViewClauseId(clause.id);
    setDetailGroupId(null);
    setActive("clause");
    if (focusTab) {
      requestAnimationFrame(() => document.getElementById("structure-tab-clause")?.focus());
    }
  }

  function openClauseById(clauseId: string): void {
    const clause = study.clauses.find((candidate) => candidate.id === clauseId);
    if (clause) openClause(clause);
  }

  function openPhraseGroup(
    clause: SyntaxStudyClause,
    group: SyntaxStudyGroup,
    focusDetail = false,
  ): void {
    if (!group.phrase) return;
    setViewClauseId(clause.id);
    setDetailGroupId(group.id);
    setActive("clause");
    if (focusDetail) {
      requestAnimationFrame(() => document.getElementById("structure-phrase-detail")?.focus());
    }
  }

  function closePhraseDetail(): void {
    const groupId = detailGroupId;
    setDetailGroupId(null);
    if (groupId) {
      requestAnimationFrame(() => document.getElementById(`structure-group-${groupId}`)?.focus());
    }
  }

  function returnToSelection(): void {
    if (!sourceClause) return;
    if (sourceGroup?.phrase) {
      openPhraseGroup(sourceClause, sourceGroup);
      return;
    }
    openClause(sourceClause, false);
  }

  function onStructureKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (
      active !== "clause" ||
      !event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
    ) {
      return;
    }
    const previous = event.key === "ArrowLeft";
    event.preventDefault();
    if (detailGroup?.phrase) {
      const stop = previous ? previousPhrase : nextPhrase;
      if (!stop) return;
      openPhraseGroup(stop.clause, stop.group);
      return;
    }
    const clause = previous ? previousClause : nextClause;
    if (!clause) return;
    openClause(clause, false);
  }

  function onTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, mode: Mode): void {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const index = modes.findIndex((candidate) => candidate.id === mode);
    let nextIndex = index;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % modes.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + modes.length) % modes.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = modes.length - 1;
    else return;
    event.preventDefault();
    const next = modes[nextIndex]!.id;
    setActive(next);
    requestAnimationFrame(() => document.getElementById(`structure-tab-${next}`)?.focus());
  }

  const copy =
    active === "clause" && detailGroup?.phrase
      ? {
          title: "Phrase detail",
          description: "Move through real phrase branches without leaving the diagram.",
        }
      : VIEW_COPY[active];
  const unit = dir === "rtl" ? "text units" : "words";
  const phraseAwayFromSelection = Boolean(
    detailGroup?.phrase &&
      sourceClause &&
      (sourceGroup?.phrase
        ? viewClause?.id !== sourceClause.id || detailGroup.id !== sourceGroup.id
        : viewClause?.id !== sourceClause.id),
  );
  const phraseReturnLabel = sourceGroup?.phrase
    ? "Return to selected phrase"
    : "Return to selected clause";

  return (
    <div className="lang-syntax lang-syntax--modal" onKeyDown={onStructureKeyDown}>
      <details className="lang-structure-source">
        <summary>
          <span className="lang-structure-source-label">Source sentence</span>
          {study.focusWord ? (
            <span className="lang-structure-source-focus" dir="ltr">
              <span className="lang-structure-source-word" dir={dir}>
                {study.focusWord.surface}
              </span>
              {study.focusWord.gloss ? <span>“{study.focusWord.gloss}”</span> : null}
              {sourceGroup ? <span>{sourceGroup.label}</span> : null}
              {sourceClause ? <span>{clausePosition(sourceClause, study.clauses)}</span> : null}
            </span>
          ) : null}
          <span className="lang-structure-source-open">Show sentence</span>
        </summary>
        <OriginalWords words={study.words} dir={dir} className="lang-structure-source-original" />
      </details>

      <div className="lang-syntax-toolbar">
        {modes.length > 1 ? (
          <div className="lang-syntax-modes" role="tablist" aria-label="Structure view">
            {modes.map((mode) => (
              <button
                key={mode.id}
                id={`structure-tab-${mode.id}`}
                type="button"
                role="tab"
                className={`lang-syntax-mode${active === mode.id ? " is-active" : ""}`}
                aria-selected={active === mode.id}
                aria-controls={`structure-panel-${mode.id}`}
                tabIndex={active === mode.id ? 0 : -1}
                onClick={() => setActive(mode.id)}
                onKeyDown={(event) => onTabKeyDown(event, mode.id)}
              >
                {mode.label}
              </button>
            ))}
          </div>
        ) : (
          <span className="lang-syntax-single-mode">Clause</span>
        )}
        <span className="lang-syntax-meta">
          {study.wordCount} {unit} · {clauseCount} {clauseCount === 1 ? "clause" : "clauses"}
        </span>
      </div>

      <div className="lang-structure-view-head">
        <div>
          <h3>{copy.title}</h3>
          <p>{copy.description}</p>
        </div>
        {viewClause && active === "clause" && clauseCount === 1 && !detailGroup?.phrase ? (
          <span className="lang-structure-scope">{clausePosition(viewClause, study.clauses)}</span>
        ) : null}
      </div>

      {active === "clause" && viewClause && detailGroup?.phrase && detailPhraseIndex >= 0 ? (
        <StudyNavigator
          kind="phrase"
          position={detailPhraseIndex + 1}
          total={phraseStops.length}
          context={clausePosition(viewClause, study.clauses)}
          previousPreview={
            previousPhrase ? phraseNavigatorPreview(previousPhrase.group) : undefined
          }
          nextPreview={nextPhrase ? phraseNavigatorPreview(nextPhrase.group) : undefined}
          onPrevious={
            previousPhrase
              ? () => openPhraseGroup(previousPhrase.clause, previousPhrase.group)
              : undefined
          }
          onNext={
            nextPhrase ? () => openPhraseGroup(nextPhrase.clause, nextPhrase.group) : undefined
          }
          returnLabel={phraseAwayFromSelection ? phraseReturnLabel : undefined}
          onReturn={phraseAwayFromSelection ? returnToSelection : undefined}
        />
      ) : active === "clause" && viewClause && clauseCount > 1 && viewClauseIndex >= 0 ? (
        <StudyNavigator
          kind="clause"
          position={viewClauseIndex + 1}
          total={clauseCount}
          context={viewClause.isFocus ? "Selected word is here" : "Browsing the sentence"}
          previousPreview={
            previousClause
              ? clauseNavigatorPreview(previousClause, viewClauseIndex - 1)
              : undefined
          }
          nextPreview={
            nextClause ? clauseNavigatorPreview(nextClause, viewClauseIndex + 1) : undefined
          }
          onPrevious={previousClause ? () => openClause(previousClause, false) : undefined}
          onNext={nextClause ? () => openClause(nextClause, false) : undefined}
          returnLabel={!viewClause.isFocus ? "Return to selected clause" : undefined}
          onReturn={
            !viewClause.isFocus && sourceClause
              ? () => openClause(sourceClause, false)
              : undefined
          }
        />
      ) : null}

      {active === "clause" ? (
        <div
          id="structure-panel-clause"
          className="lang-flow"
          role={modes.length > 1 ? "tabpanel" : undefined}
          aria-labelledby={modes.length > 1 ? "structure-tab-clause" : undefined}
        >
          {viewClause ? (
            detailGroup?.phrase ? (
              <PhraseDetail
                group={detailGroup}
                dir={dir}
                onClose={closePhraseDetail}
                onOpenClause={openClauseById}
              />
            ) : (
              <section
                className={`lang-flow-clause${
                  viewClause.isFocus ? " is-source" : " is-browsing"
                }`}
              >
                <header className="lang-flow-clause-head">
                  <span className="lang-flow-clause-title">{viewClause.label}</span>
                </header>
                <div className="lang-flow-sequence" dir={dir}>
                  {viewClause.groups.map((group) => (
                    <ClauseGroup
                      key={group.id}
                      group={group}
                      dir={dir}
                      expanded={detailGroupId === group.id}
                      onToggle={() => openPhraseGroup(viewClause, group, true)}
                    />
                  ))}
                </div>
              </section>
            )
          ) : (
            <div className="lang-structure-empty">No focused clause was found.</div>
          )}
        </div>
      ) : (
        <div
          ref={outlineRef}
          id="structure-panel-sentence"
          className="lang-outline"
          role="tabpanel"
          aria-labelledby="structure-tab-sentence"
        >
          <ol className="lang-outline-list" aria-label="Source-language sentence clauses">
            {study.clauses.map((clause, index) => (
              <li key={clause.id} className="lang-outline-item">
                <button
                  type="button"
                  className={`lang-outline-clause${clause.isFocus ? " is-focus" : ""}`}
                  style={{ "--outline-depth": Math.min(clause.depth, 3) } as React.CSSProperties}
                  onClick={() => openClause(clause)}
                  aria-label={`Open clause ${index + 1} of ${clauseCount}`}
                >
                  <div className="lang-outline-rail" aria-hidden="true" />
                  <div className="lang-outline-body">
                    <div className="lang-outline-heading">
                      <span className="lang-outline-labels">
                        <span className="lang-outline-title">
                          {clause.label} · {index + 1} of {clauseCount}
                        </span>
                        {clause.parentId ? (
                          <span className="lang-outline-parent">
                            inside clause{
                              ` ${Math.max(
                                1,
                                study.clauses.findIndex(
                                  (candidate) => candidate.id === clause.parentId,
                                ) + 1,
                              )}`
                            }
                          </span>
                        ) : null}
                      </span>
                      <span className="lang-outline-actions">
                        {clause.isFocus ? <span className="lang-outline-here">selected</span> : null}
                        <span className="lang-outline-open">open →</span>
                      </span>
                    </div>
                    <div className="lang-outline-summary" dir="ltr">
                      {syntaxStudyGroupsInSourceOrder(clause.groups).map((group) => (
                        <span
                          key={group.id}
                          className={`lang-outline-summary-group role-${group.role}`}
                        >
                          <span className="lang-outline-summary-role">{group.label}</span>
                          <span className="lang-outline-summary-text">
                            {groupGlossPreview(group, 14)}
                          </span>
                        </span>
                      ))}
                    </div>
                    <OriginalWords
                      words={clause.words}
                      dir={dir}
                      className="lang-outline-original"
                      maxWords={24}
                    />
                  </div>
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}

      <p className="lang-structure-gloss-note">
        Function labels follow the source analysis; English lines are rough glosses, not a
        translation.
      </p>
    </div>
  );
}
