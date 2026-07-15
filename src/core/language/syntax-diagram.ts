import type { SyntaxStudyPhraseNode } from "./syntax-study.js";

export type PhraseDiagramView = "diagram" | "outline";

export type PhraseDiagramShape = {
  nodeCount: number;
  wordCount: number;
  maxDepth: number;
  maxChildren: number;
  compressedEdges: number;
};

export type PhraseDiagramPolicy = {
  defaultView: PhraseDiagramView;
  reason?: "linked-chain" | "deep" | "wide" | "large";
  shape: PhraseDiagramShape;
};

export type PhraseDiagramNode = {
  id: string;
  sourceId?: string;
  kind: SyntaxStudyPhraseNode["kind"] | "summary";
  label: string;
  relation?: string;
  surface: string;
  gloss: string;
  isFocus: boolean;
  containsFocus: boolean;
  edgeKind: "source-child" | "compressed-member";
  targetClauseId?: string;
  children: PhraseDiagramNode[];
};

export type PhraseDiagramProjection = {
  root: PhraseDiagramNode;
  strategy: "full" | "focus-window" | "lineage";
  hiddenNodeCount: number;
  visibleSourceNodeCount: number;
  sourceNodeCount: number;
  hasCompressedEdges: boolean;
};

export type PhraseDiagramNodeSize = {
  id: string;
  width: number;
  height: number;
};

export type LaidOutPhraseDiagramNode = PhraseDiagramNode & {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PhraseDiagramEdge = {
  from: string;
  to: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  midY: number;
  edgeKind: "source-child" | "compressed-member";
  isFocusPath: boolean;
};

export type PhraseDiagramLayout = {
  width: number;
  height: number;
  nodes: LaidOutPhraseDiagramNode[];
  edges: PhraseDiagramEdge[];
};

export function phraseDiagramShape(root: SyntaxStudyPhraseNode): PhraseDiagramShape {
  let nodeCount = 0;
  let wordCount = 0;
  let maxDepth = 0;
  let maxChildren = 0;
  let compressedEdges = 0;
  function visit(node: SyntaxStudyPhraseNode, depth: number): void {
    nodeCount += 1;
    if (node.kind === "word") wordCount += 1;
    maxDepth = Math.max(maxDepth, depth);
    maxChildren = Math.max(maxChildren, node.children.length);
    if (node.edgeKind === "compressed-member") compressedEdges += 1;
    for (const child of node.children) visit(child, depth + 1);
  }
  visit(root, 1);
  return { nodeCount, wordCount, maxDepth, maxChildren, compressedEdges };
}

/**
 * Prefer the exhaustive outline when spatial fan-out would require tiny text,
 * horizontal pan, or would make a compressed lineage look like a source star.
 * Diagram remains available through a focus-windowed projection.
 */
export function phraseDiagramPolicy(root: SyntaxStudyPhraseNode): PhraseDiagramPolicy {
  const shape = phraseDiagramShape(root);
  if (root.relation === "Linked noun chain" || root.compression === "recursive-spine") {
    return { defaultView: "outline", reason: "linked-chain", shape };
  }
  if (shape.maxChildren > 8) return { defaultView: "outline", reason: "wide", shape };
  if (shape.maxDepth > 7) return { defaultView: "outline", reason: "deep", shape };
  if (shape.nodeCount > 28) return { defaultView: "outline", reason: "large", shape };
  return { defaultView: "diagram", shape };
}

function countNodes(node: SyntaxStudyPhraseNode): number {
  return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
}

function summaryNode(
  parentId: string,
  position: "earlier" | "later" | "below",
  count: number,
  unit: "item" | "branch" = "item",
): PhraseDiagramNode {
  const noun = count === 1 ? unit : unit === "branch" ? "branches" : "items";
  const label =
    position === "below" ? `${count} ${noun} below` : `${count} ${position} ${noun}`;
  return {
    id: `${parentId}:diagram-summary:${position}`,
    kind: "summary",
    label,
    relation: "Continue in outline",
    surface: "",
    gloss: "",
    isFocus: false,
    containsFocus: false,
    edgeKind: "compressed-member",
    children: [],
  };
}

function focusedPathSummary(
  parentId: string,
  skippedLevels: number,
  focus: SyntaxStudyPhraseNode,
): PhraseDiagramNode {
  const noun = skippedLevels === 1 ? "branch" : "branches";
  return {
    id: `${parentId}:diagram-summary:focus-path`,
    kind: "summary",
    label: `${skippedLevels} nested ${noun}`,
    relation: "Selected path condensed",
    surface: "",
    gloss: "",
    isFocus: false,
    containsFocus: true,
    edgeKind: "compressed-member",
    children: [
      {
        id: focus.id,
        sourceId: focus.id,
        kind: focus.kind,
        label: focus.label,
        relation: focus.relation,
        surface: focus.surface,
        gloss: focus.gloss,
        isFocus: focus.isFocus,
        containsFocus: true,
        edgeKind: "compressed-member",
        targetClauseId: focus.targetClauseId,
        children: [],
      },
    ],
  };
}

type ProjectionOptions = {
  maxChildren?: number;
  maxDepth?: number;
};

/**
 * Produce a bounded spatial projection. Summary nodes are explicit UI
 * constructs; every non-summary node remains one source-backed study node.
 */
export function buildPhraseDiagramProjection(
  root: SyntaxStudyPhraseNode,
  options: ProjectionOptions = {},
): PhraseDiagramProjection {
  const policy = phraseDiagramPolicy(root);
  const maxChildren = Math.max(2, options.maxChildren ?? (policy.defaultView === "outline" ? 3 : 4));
  const defaultMaxDepth = policy.defaultView === "outline" ? 4 : 7;
  const maxDepth = Math.max(3, options.maxDepth ?? defaultMaxDepth);
  const focusedProjection = policy.defaultView === "outline";
  let summaryCount = 0;

  function focusedLeaf(node: SyntaxStudyPhraseNode): {
    focus: SyntaxStudyPhraseNode;
    skippedLevels: number;
  } | null {
    let current = node;
    let skippedLevels = 0;
    while (!current.isFocus) {
      const child = current.children.find((candidate) => candidate.containsFocus);
      if (!child) return null;
      skippedLevels += 1;
      current = child;
    }
    return { focus: current, skippedLevels };
  }

  function projectedChildren(node: SyntaxStudyPhraseNode, depth: number): PhraseDiagramNode[] {
    const children = node.children;
    if (!children.length) return [];

    if (depth >= maxDepth) {
      const focusIndex = children.findIndex((child) => child.containsFocus);
      if (focusIndex < 0) {
        summaryCount += 1;
        return [summaryNode(node.id, "below", children.reduce((sum, child) => sum + countNodes(child), 0))];
      }
      const result: PhraseDiagramNode[] = [];
      if (focusIndex > 0) {
        summaryCount += 1;
        result.push(summaryNode(node.id, "earlier", focusIndex));
      }
      const focusChild = children[focusIndex]!;
      const condensed = focusedLeaf(focusChild);
      if (condensed && condensed.skippedLevels > 0) {
        summaryCount += 1;
        result.push(
          focusedPathSummary(
            node.id,
            condensed.skippedLevels,
            condensed.focus,
          ),
        );
      } else {
        result.push(project(focusChild, depth + 1));
      }
      if (focusIndex < children.length - 1) {
        summaryCount += 1;
        result.push(summaryNode(node.id, "later", children.length - focusIndex - 1));
      }
      return result;
    }

    const focusIndex = children.findIndex((child) => child.containsFocus);
    const allTerminals = children.every((child) => child.children.length === 0);
    // Once a phrase is too large for a complete spatial view, show its exact
    // selected lineage and summarize off-path subtrees. Keep the final local
    // terminal neighborhood so the selected word still has useful siblings.
    if (focusedProjection && focusIndex >= 0 && !allTerminals) {
      const result: PhraseDiagramNode[] = [];
      if (focusIndex > 0) {
        summaryCount += 1;
        result.push(summaryNode(node.id, "earlier", focusIndex, "branch"));
      }
      result.push(project(children[focusIndex]!, depth + 1));
      if (focusIndex < children.length - 1) {
        summaryCount += 1;
        result.push(
          summaryNode(node.id, "later", children.length - focusIndex - 1, "branch"),
        );
      }
      return result;
    }

    if (children.length <= maxChildren) {
      return children.map((child) => project(child, depth + 1));
    }

    summaryCount += 1;
    if (focusIndex < 0) {
      return [
        ...children.slice(0, maxChildren - 1).map((child) => project(child, depth + 1)),
        summaryNode(node.id, "later", children.length - maxChildren + 1),
      ];
    }
    if (focusIndex <= 1) {
      const kept = children.slice(0, maxChildren - 1);
      return [
        ...kept.map((child) => project(child, depth + 1)),
        summaryNode(node.id, "later", children.length - kept.length),
      ];
    }
    if (focusIndex >= children.length - 2) {
      const kept = children.slice(-(maxChildren - 1));
      return [
        summaryNode(node.id, "earlier", children.length - kept.length),
        ...kept.map((child) => project(child, depth + 1)),
      ];
    }
    return [
      summaryNode(node.id, "earlier", focusIndex),
      project(children[focusIndex]!, depth + 1),
      summaryNode(node.id, "later", children.length - focusIndex - 1),
    ];
  }

  function project(node: SyntaxStudyPhraseNode, depth: number): PhraseDiagramNode {
    return {
      id: node.id,
      sourceId: node.id,
      kind: node.kind,
      label: node.label,
      relation: node.relation,
      surface: node.surface,
      gloss: node.gloss,
      isFocus: node.isFocus,
      containsFocus: node.containsFocus,
      edgeKind: node.edgeKind ?? "source-child",
      targetClauseId: node.targetClauseId,
      children: projectedChildren(node, depth),
    };
  }

  const projectedRoot = project(root, 1);
  let visibleSourceNodeCount = 0;
  let hasCompressedEdges = false;
  (function inspect(node: PhraseDiagramNode, isRoot = false): void {
    if (node.sourceId) visibleSourceNodeCount += 1;
    if (!isRoot && node.edgeKind === "compressed-member") hasCompressedEdges = true;
    for (const child of node.children) inspect(child);
  })(projectedRoot, true);
  const sourceNodeCount = countNodes(root);
  return {
    root: projectedRoot,
    strategy:
      root.relation === "Linked noun chain"
        ? "lineage"
        : summaryCount > 0
          ? "focus-window"
          : "full",
    hiddenNodeCount: sourceNodeCount - visibleSourceNodeCount,
    visibleSourceNodeCount,
    sourceNodeCount,
    hasCompressedEdges,
  };
}

type Measured = {
  node: PhraseDiagramNode;
  width: number;
  height: number;
  layoutDepth: number;
  subtreeWidth: number;
  children: Measured[];
};

/** Deterministic ordered-tree layout over renderer-measured HTML node sizes. */
export function layoutPhraseDiagram(
  root: PhraseDiagramNode,
  sizes: readonly PhraseDiagramNodeSize[],
  options: { direction?: "ltr" | "rtl"; horizontalGap?: number; verticalGap?: number } = {},
): PhraseDiagramLayout {
  const sizeById = new Map(sizes.map((size) => [size.id, size]));
  const horizontalGap = options.horizontalGap ?? 26;
  const verticalGap = options.verticalGap ?? 38;
  const margin = 16;
  const rowHeights: number[] = [];

  function deepestLevel(node: PhraseDiagramNode, depth: number): number {
    return node.children.reduce(
      (deepest, child) => Math.max(deepest, deepestLevel(child, depth + 1)),
      depth,
    );
  }
  const terminalDepth = deepestLevel(root, 0);

  function measure(node: PhraseDiagramNode, depth: number): Measured {
    const measured = sizeById.get(node.id);
    const width = Math.max(112, measured?.width ?? (node.kind === "summary" ? 142 : 168));
    const height = Math.max(44, measured?.height ?? (node.kind === "word" ? 72 : 60));
    // Constituency diagrams are much easier to scan when every terminal sits
    // on the same baseline. aria-level still carries the exact source depth.
    const layoutDepth = node.children.length ? depth : terminalDepth;
    rowHeights[layoutDepth] = Math.max(rowHeights[layoutDepth] ?? 0, height);
    const children = node.children.map((child) => measure(child, depth + 1));
    const childrenWidth =
      children.reduce((sum, child) => sum + child.subtreeWidth, 0) +
      horizontalGap * Math.max(0, children.length - 1);
    return {
      node,
      width,
      height,
      layoutDepth,
      subtreeWidth: Math.max(width, childrenWidth),
      children,
    };
  }

  const measuredRoot = measure(root, 0);
  const rowY: number[] = [margin];
  for (let depth = 1; depth < rowHeights.length; depth += 1) {
    rowY[depth] = rowY[depth - 1]! + rowHeights[depth - 1]! + verticalGap;
  }

  const nodes: LaidOutPhraseDiagramNode[] = [];
  function place(measured: Measured, left: number, depth: number): number {
    const childrenWidth =
      measured.children.reduce((sum, child) => sum + child.subtreeWidth, 0) +
      horizontalGap * Math.max(0, measured.children.length - 1);
    let childLeft = left + Math.max(0, (measured.subtreeWidth - childrenWidth) / 2);
    const childCenters: number[] = [];
    for (const child of measured.children) {
      childCenters.push(place(child, childLeft, depth + 1));
      childLeft += child.subtreeWidth + horizontalGap;
    }
    const center = childCenters.length
      ? (childCenters[0]! + childCenters[childCenters.length - 1]!) / 2
      : left + measured.subtreeWidth / 2;
    nodes.push({
      ...measured.node,
      x: center - measured.width / 2,
      y: rowY[measured.layoutDepth]!,
      width: measured.width,
      height: measured.height,
    });
    return center;
  }
  place(measuredRoot, margin, 0);

  const width = Math.ceil(measuredRoot.subtreeWidth + margin * 2);
  const lastDepth = rowHeights.length - 1;
  const height = Math.ceil(rowY[lastDepth]! + rowHeights[lastDepth]! + margin);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edges: PhraseDiagramEdge[] = [];
  for (const parent of nodes) {
    for (const child of parent.children) {
      const target = byId.get(child.id);
      if (!target) continue;
      const x1 = parent.x + parent.width / 2;
      const y1 = parent.y + parent.height;
      const x2 = target.x + target.width / 2;
      const y2 = target.y;
      edges.push({
        from: parent.id,
        to: target.id,
        x1,
        y1,
        x2,
        y2,
        midY: y1 + (y2 - y1) / 2,
        edgeKind: target.edgeKind,
        isFocusPath: target.containsFocus || target.isFocus,
      });
    }
  }

  if (options.direction === "rtl") {
    for (const node of nodes) node.x = width - node.x - node.width;
    for (const edge of edges) {
      edge.x1 = width - edge.x1;
      edge.x2 = width - edge.x2;
    }
  }
  return { width, height, nodes, edges };
}
