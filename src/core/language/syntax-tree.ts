/**
 * Syntax art — MACULA sentence trees as layout-ready graphs.
 * Linguistic structure comes from MACULA (CC BY 4.0); drawing is ours.
 */

export type SyntaxNode = {
  id: string;
  /** MACULA Cat: S, CL, np, VP, noun, verb, … */
  cat: string;
  rule?: string;
  clType?: string;
  /** Leaf word */
  tokenId?: string;
  surface?: string;
  gloss?: string;
  lemma?: string;
  /** Strong’s digits when present (esp. Hebrew MACULA StrongNumberX). */
  strong?: string;
  children?: SyntaxNode[];
};

export type SyntaxSentence = {
  id: string;
  /** e.g. MAT 1:1 */
  refLabel: string;
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd: number;
  tokenIds: string[];
  root: SyntaxNode;
};

export type SyntaxPackageIndex = {
  version: 1;
  source: string;
  license: string;
  language: "grc" | "hbo";
  book: string;
  sentenceCount: number;
  sentences: SyntaxSentence[];
  /** token id → sentence index */
  byTokenId: Record<string, number>;
};

export type LayoutPoint = { x: number; y: number };

export type LaidOutNode = {
  id: string;
  cat: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isLeaf: boolean;
  isFocus: boolean;
  surface?: string;
  gloss?: string;
  tokenId?: string;
  childrenIds: string[];
};

export type SyntaxLayout = {
  width: number;
  height: number;
  nodes: LaidOutNode[];
  edges: { from: string; to: string; x1: number; y1: number; x2: number; y2: number }[];
};

export type SyntaxLeafMatchContext = {
  strong?: string | null;
  surface?: string | null;
  /** 1-based orthographic word position within the verse. */
  position?: number | null;
};

function normalizeSyntaxSurface(value?: string | null): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .toLocaleLowerCase();
}

/** MACULA ids end with a three-digit word number plus morpheme number. */
function maculaWordPosition(tokenId?: string): number | null {
  const match = tokenId?.match(/(\d{3})\d$/);
  return match ? Number(match[1]) : null;
}

/**
 * Resolve a leaf when the interlinear package uses different token ids.
 * Position is the strongest discriminator for OSHB ↔ MACULA Hebrew; Strong's
 * and normalized surface are useful fallbacks. This avoids focusing the first
 * occurrence when a word repeats in the same verse.
 */
export function findLeafTokenIdByContext(
  root: SyntaxNode,
  context: SyntaxLeafMatchContext,
): string | null {
  const leaves: SyntaxNode[] = [];
  function walk(node: SyntaxNode): void {
    if (node.tokenId) leaves.push(node);
    for (const child of node.children ?? []) walk(child);
  }
  walk(root);

  const strong = String(context.strong ?? "").replace(/^[GH]/i, "");
  let candidates = strong
    ? leaves.filter(
        (leaf) => String(leaf.strong ?? "").replace(/^[GH]/i, "") === strong,
      )
    : leaves;
  if (!candidates.length) return null;

  if (context.position != null) {
    const byPosition = candidates.filter(
      (leaf) => maculaWordPosition(leaf.tokenId) === context.position,
    );
    if (byPosition.length === 1) return byPosition[0]!.tokenId ?? null;
    if (byPosition.length > 1) candidates = byPosition;
  }

  const surface = normalizeSyntaxSurface(context.surface);
  if (surface) {
    const bySurface = candidates.filter((leaf) => {
      const leafSurface = normalizeSyntaxSurface(leaf.surface);
      return leafSurface === surface || surface.endsWith(leafSurface);
    });
    if (bySurface.length === 1) return bySurface[0]!.tokenId ?? null;
    if (bySurface.length > 1) candidates = bySurface;
  }

  return candidates.length === 1 ? candidates[0]!.tokenId ?? null : null;
}

/** Human labels for phrase cats (compact UI). */
export function catLabel(cat: string): string {
  const c = cat.toUpperCase();
  const map: Record<string, string> = {
    S: "sentence",
    CL: "clause",
    NP: "noun phrase",
    VP: "verb phrase",
    PP: "prep. phrase",
    ADJP: "adj. phrase",
    ADVP: "adv. phrase",
    P: "predicate",
    SUBJ: "subject",
    OBJ: "object",
    IO: "ind. object",
    ADV: "adverbial",
  };
  if (map[c]) return map[c];
  if (c === "NP" || cat === "np") return "noun phrase";
  if (cat.length <= 4) return cat.toLowerCase();
  return cat.toLowerCase();
}

/** Collapse unary non-leaf chains that only wrap a single child of same “kind”. */
export function simplifyTree(node: SyntaxNode, depth = 0): SyntaxNode {
  let n = node;
  // Flatten long unary np wrappers
  while (
    n.children?.length === 1 &&
    !n.tokenId &&
    n.children[0] &&
    !n.children[0].tokenId &&
    depth < 12 &&
    /^(np|N2NP|NPofNP)$/i.test(n.cat) &&
    /^(np)/i.test(n.children[0].cat)
  ) {
    n = { ...n.children[0], cat: n.children[0].cat };
    depth += 1;
  }
  if (n.children?.length) {
    return {
      ...n,
      children: n.children.map((c) => simplifyTree(c, depth + 1)),
    };
  }
  return n;
}

const LEAF_W = 56;
const LEAF_H = 36;
const PHRASE_W = 48;
const PHRASE_H = 22;
const H_GAP = 10;
const V_GAP = 36;

/**
 * Simple tidy-ish top-down layout. Leaves spaced by measured width;
 * parents centered over children.
 */
export function layoutSyntaxTree(
  root: SyntaxNode,
  focusTokenId?: string | null,
  opts?: { maxWidth?: number },
): SyntaxLayout {
  const maxWidth = opts?.maxWidth ?? 320;
  type Meas = { node: SyntaxNode; width: number; children: Meas[] };
  function measure(n: SyntaxNode): Meas {
    if (!n.children?.length || n.tokenId) {
      const w = n.tokenId ? LEAF_W : PHRASE_W;
      return { node: n, width: w, children: [] };
    }
    const children = n.children.map(measure);
    const inner = children.reduce((s, c) => s + c.width, 0) + H_GAP * Math.max(0, children.length - 1);
    return { node: n, width: Math.max(PHRASE_W, inner), children };
  }

  const measured = measure(root);
  // Scale down if too wide
  const scale = measured.width > maxWidth ? maxWidth / measured.width : 1;

  const laid: LaidOutNode[] = [];
  const edges: SyntaxLayout["edges"] = [];

  function place(m: Meas, left: number, depth: number): { cx: number; y: number } {
    const y = 12 + depth * V_GAP;
    const isLeaf = Boolean(m.node.tokenId) || !m.children.length;
    const w = (isLeaf ? (m.node.tokenId ? LEAF_W : PHRASE_W) : PHRASE_W) * (scale < 1 ? Math.max(scale, 0.75) : 1);
    const h = isLeaf && m.node.tokenId ? LEAF_H : PHRASE_H;

    let cx: number;
    if (m.children.length === 0) {
      cx = left + (m.width * scale) / 2;
    } else {
      let x = left;
      const childCenters: number[] = [];
      for (const ch of m.children) {
        const c = place(ch, x, depth + 1);
        childCenters.push(c.cx);
        x += ch.width * scale + H_GAP * scale;
      }
      cx = (Math.min(...childCenters) + Math.max(...childCenters)) / 2;
    }

    const id = m.node.id;
    const focus = Boolean(focusTokenId && m.node.tokenId === focusTokenId);
    laid.push({
      id,
      cat: m.node.cat,
      x: cx - w / 2,
      y,
      width: w,
      height: h,
      isLeaf: Boolean(m.node.tokenId),
      isFocus: focus,
      surface: m.node.surface,
      gloss: m.node.gloss,
      tokenId: m.node.tokenId,
      childrenIds: m.children.map((c) => c.node.id),
    });

    for (const ch of m.children) {
      const childLaid = laid.find((l) => l.id === ch.node.id);
      if (childLaid) {
        edges.push({
          from: id,
          to: ch.node.id,
          x1: cx,
          y1: y + h,
          x2: childLaid.x + childLaid.width / 2,
          y2: childLaid.y,
        });
      }
    }
    return { cx, y };
  }

  place(measured, 8, 0);

  const maxX = Math.max(...laid.map((n) => n.x + n.width), 100);
  const maxY = Math.max(...laid.map((n) => n.y + n.height), 80);
  return {
    width: Math.ceil(maxX + 12),
    height: Math.ceil(maxY + 16),
    nodes: laid,
    edges,
  };
}

/**
 * Greek: MAT 1:1!1-1:1!8 or MAT 5:3!1-5:4!12
 * Hebrew: GEN 1:1 or GEN 1:1-2
 */
export function parseMaculaSentenceRef(ref: string): {
  chapter: number;
  verseStart: number;
  verseEnd: number;
} {
  // GEN 1:1-3 or GEN 1:1
  const plain = ref.match(/(?:^|\s)(\d+):(\d+)(?:-(\d+)(?::(\d+))?)?/);
  if (plain) {
    const chapter = Number(plain[1]);
    const verseStart = Number(plain[2]);
    // GEN 1:1-3 → plain[3]=3; MAT 1:1!1-1:2!x → handled below
    if (plain[4]) {
      return { chapter, verseStart, verseEnd: Number(plain[4]) };
    }
    if (plain[3] && !ref.includes("!")) {
      return { chapter, verseStart, verseEnd: Number(plain[3]) };
    }
  }
  const m = ref.match(/(\d+):(\d+)!?\d*(?:-(\d+):(\d+))?/);
  if (!m) return { chapter: 1, verseStart: 1, verseEnd: 1 };
  const chapter = Number(m[1]);
  const verseStart = Number(m[2]);
  const verseEnd = m[4] ? Number(m[4]) : verseStart;
  return { chapter, verseStart, verseEnd };
}

export function buildSyntaxBookIndex(
  book: string,
  sentences: SyntaxSentence[],
  meta?: { source?: string; language?: "grc" | "hbo" },
): SyntaxPackageIndex {
  const byTokenId: Record<string, number> = {};
  sentences.forEach((s, i) => {
    for (const id of s.tokenIds) {
      if (byTokenId[id] === undefined) byTokenId[id] = i;
    }
  });
  return {
    version: 1,
    source: meta?.source ?? "MACULA Greek Nestle1904 nodes",
    license: "CC BY 4.0",
    language: meta?.language ?? "grc",
    book,
    sentenceCount: sentences.length,
    sentences,
    byTokenId,
  };
}

export function sentenceForToken(
  index: SyntaxPackageIndex,
  tokenId: string,
): SyntaxSentence | null {
  const i = index.byTokenId[tokenId];
  if (i === undefined) return null;
  return index.sentences[i] ?? null;
}
