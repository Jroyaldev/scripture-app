/**
 * Study-facing syntax model.
 *
 * MACULA's tree is intentionally lossless and therefore contains many parser
 * wrappers. The renderer needs a smaller, honest model: clauses, the
 * grammatical function of each direct phrase, and the words inside it.
 */

import type { SyntaxNode } from "./syntax-tree.js";

export type SyntaxStudyRole =
  | "subject"
  | "action"
  | "object"
  | "recipient"
  | "context"
  | "complement"
  | "connector"
  | "detail";

export type SyntaxStudyWord = {
  id: string;
  tokenId?: string;
  surface: string;
  gloss: string;
  isFocus: boolean;
};

export type SyntaxStudyPhraseNode = {
  id: string;
  kind: "phrase" | "word" | "clause";
  /** Relationship from the displayed parent after presentation compression. */
  edgeKind?: "source-child" | "compressed-member";
  /** Source ids represented by this displayed node, including collapsed wrappers. */
  sourceNodeIds?: string[];
  sourceRule?: string;
  compression?: "unary-wrapper" | "homogeneous-chain" | "recursive-spine";
  /** Grammatical category, never a semantic participant inference. */
  label: string;
  /** Plain-language rendering of a source rule when it is safely known. */
  relation?: string;
  surface: string;
  gloss: string;
  /** Exact selected leaf only. */
  isFocus: boolean;
  /** True for the selected leaf and each source ancestor that contains it. */
  containsFocus: boolean;
  wordCount: number;
  /** Exact source clause represented by an embedded-clause boundary. */
  targetClauseId?: string;
  children: SyntaxStudyPhraseNode[];
};

export type SyntaxStudyGroup = {
  id: string;
  role: SyntaxStudyRole;
  label: string;
  words: SyntaxStudyWord[];
  surface: string;
  gloss: string;
  isFocus: boolean;
  /** Present only when the source contains a real multi-word branch. */
  phrase: SyntaxStudyPhraseNode | null;
};

export type SyntaxStudyClause = {
  id: string;
  parentId?: string;
  depth: number;
  label: string;
  rule?: string;
  clType?: string;
  groups: SyntaxStudyGroup[];
  words: SyntaxStudyWord[];
  surface: string;
  gloss: string;
  isFocus: boolean;
};

export type SyntaxStudyModel = {
  clauses: SyntaxStudyClause[];
  focusClauseId: string | null;
  focusWord: SyntaxStudyWord | null;
  words: SyntaxStudyWord[];
  wordCount: number;
};

/** One real, drillable phrase branch in sentence source order. */
export type SyntaxStudyPhraseStop = {
  clauseId: string;
  groupId: string;
};

const ROLE_LABEL: Record<SyntaxStudyRole, string> = {
  subject: "Subject",
  action: "Verb",
  object: "Object",
  recipient: "Indirect object",
  context: "Modifier",
  complement: "Predicate",
  connector: "Connector",
  detail: "Phrase",
};

export function syntaxStudyRoleLabel(role: SyntaxStudyRole): string {
  return ROLE_LABEL[role];
}

function cat(node: SyntaxNode): string {
  return (node.cat ?? "").trim().toUpperCase();
}

function isClause(node: SyntaxNode): boolean {
  return cat(node) === "CL";
}

function isLeaf(node: SyntaxNode): boolean {
  return Boolean(node.tokenId) || (!node.children?.length && Boolean(node.surface || node.gloss));
}

function cleanSurface(value?: string): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function cleanGloss(value?: string): string {
  const cleaned = (value ?? "")
    .replace(/\[([^\]]+)]/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (/^(?:-|—)$/i.test(cleaned)) return "";
  if (/^\(?(?:et|obj\.?\s*marker)\)?$/i.test(cleaned)) return "obj. marker";
  return cleaned;
}

function wordFrom(node: SyntaxNode, focusTokenId: string): SyntaxStudyWord {
  return {
    id: node.tokenId ?? node.id,
    tokenId: node.tokenId,
    surface: cleanSurface(node.surface),
    gloss: cleanGloss(node.gloss),
    isFocus: node.tokenId === focusTokenId,
  };
}

/**
 * Read a phrase through its syntax rule instead of blindly concatenating leaf
 * glosses. Hebrew construct phrases arrive as NPofNP ("Spirit" + "God"); the
 * relationship is structural and therefore needs the small joining word that
 * is absent from the leaves. Greek genitives often already include "of" in
 * the second gloss, so do not add it twice.
 */
function phraseGloss(node: SyntaxNode): string {
  // A phrase's rough gloss must describe only its own visible words. Embedded
  // clauses receive their own rows and must never leak into the parent line.
  if (isClause(node)) return "";
  if (isLeaf(node)) {
    const gloss = cleanGloss(node.gloss);
    return gloss === "obj. marker" ? "" : gloss;
  }

  const parts = (node.children ?? [])
    .map((child) => phraseGloss(child))
    .filter(Boolean);
  if (!parts.length) return "";

  const nominal = (child: SyntaxNode): boolean => {
    if (isClause(child)) return false;
    if (isLeaf(child)) {
      return ["NOUN", "PRON", "NUM", "DET", "ART", "ADJ"].includes(cat(child));
    }
    return (child.children ?? []).length > 0 && (child.children ?? []).every(nominal);
  };
  if (
    /^NPofNP$/i.test(node.rule ?? "") &&
    parts.length >= 2 &&
    (node.children ?? []).every(nominal)
  ) {
    const [head, ...rest] = parts;
    const dependent = rest.join(" ");
    if (/^(?:of|from|to)\b/i.test(dependent)) return `${head} ${dependent}`;
    return `${head} of ${dependent}`;
  }

  return parts.join(" ");
}

/** Collect this phrase's words, but leave embedded clauses to their own rows. */
function ownWords(node: SyntaxNode, focusTokenId: string, root = true): SyntaxStudyWord[] {
  if (isLeaf(node)) {
    const word = wordFrom(node, focusTokenId);
    return word.surface ? [word] : [];
  }
  const words: SyntaxStudyWord[] = [];
  for (const child of node.children ?? []) {
    if (!root && isClause(child)) continue;
    if (isClause(child)) continue;
    words.push(...ownWords(child, focusTokenId, false));
  }
  return words;
}

function allWords(root: SyntaxNode, focusTokenId: string): SyntaxStudyWord[] {
  const words: SyntaxStudyWord[] = [];
  function walk(node: SyntaxNode): void {
    if (isLeaf(node)) {
      const word = wordFrom(node, focusTokenId);
      if (word.surface) words.push(word);
      return;
    }
    for (const child of node.children ?? []) walk(child);
  }
  walk(root);
  return dedupeWords(words);
}

function dedupeWords(words: SyntaxStudyWord[]): SyntaxStudyWord[] {
  const seen = new Set<string>();
  return words.filter((word) => {
    const key = word.tokenId ?? word.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function phraseCategoryLabel(node: SyntaxNode): string {
  if (isLeaf(node)) {
    switch ((node.cat ?? "").trim().toLowerCase()) {
      case "noun":
        return "Noun";
      case "verb":
        return "Verb";
      case "prep":
        return "Preposition";
      case "pron":
        return "Pronoun";
      case "det":
      case "art":
        return "Determiner";
      case "adj":
        return "Adjective";
      case "adv":
        return "Adverb";
      case "conj":
      case "cj":
        return "Conjunction";
      case "ptcl":
        return "Particle";
      case "om":
        return "Object marker";
      case "num":
        return "Number";
      case "rel":
        return "Relative marker";
      case "ij":
      case "intj":
        return "Interjection";
      case "x":
        return "Attached form";
      default:
        return "Word";
    }
  }

  switch (cat(node)) {
    case "NP":
      return "Noun phrase";
    case "VP":
      return "Verb phrase";
    case "PP":
      return "Prepositional phrase";
    case "ADJP":
      return "Adjective phrase";
    case "ADVP":
      return "Adverb phrase";
    case "NUMP":
      return "Number phrase";
    case "CJP":
      return "Coordination";
    case "RELP":
      return "Relative phrase";
    case "OMP":
      return "Object-marker phrase";
    case "IJP":
      return "Interjection phrase";
    case "S":
      return "Subject";
    case "V":
    case "VC":
      return "Verb";
    case "O":
      return "Object";
    case "O2":
      return "Second object";
    case "OC":
      return "Object complement";
    case "IO":
      return "Indirect object";
    case "ADV":
      return "Modifier";
    case "P":
    case "PRED":
      return "Predicate";
    default:
      return "Phrase";
  }
}

function phraseRuleLabel(rule?: string, childCount = 0): string | undefined {
  const sourceRule = (rule ?? "").toUpperCase();
  if (/^CONJ\d+NP$/.test(sourceRule)) return "Coordinated noun phrases";
  if (/^CONJ\d+VP$/.test(sourceRule)) return "Coordinated verb phrases";
  if (/^CONJ\d+PP$/.test(sourceRule)) return "Coordinated prepositional phrases";
  if (/^(?:EITHEROR|NEITHERNOR)$/.test(sourceRule)) return "Alternative coordination";

  switch (sourceRule) {
    case "PREPNP":
      return "Preposition + noun phrase";
    case "DETNP":
      return "Determiner + noun phrase";
    case "NPOFNP":
      return childCount > 2 ? "Head + dependent chain" : "Head + dependent";
    case "NPANP":
      return "Coordinated noun phrases";
    case "NP-APPOS":
      return "Apposition";
    case "NPADJP":
      return "Noun + adjective phrase";
    case "ADJPNP":
      return "Adjective + noun phrase";
    case "QUANNP":
    case "ALL-NP":
      return "Quantity + noun phrase";
    case "OBJMARKER":
      return "Object marker";
    case "OMPNP":
      return "Marker + noun phrase";
    case "PREPCL":
      return "Preposition + clause";
    case "NP-CL":
      return "Noun phrase + clause";
    case "DETCL":
      return "Determiner + clause";
    case "NPRELP":
      return "Noun + relative phrase";
    case "NPPP":
      return "Noun phrase + prepositional phrase";
    case "ADVPNP":
      return "Adverb + noun phrase";
    case "OFNPNP":
      return "Dependent noun + head";
    case "NP-DEMO":
      return "Noun phrase + demonstrative";
    case "DETADJ":
      return "Determiner + adjective";
    case "DETADJP":
      return "Determiner + adjective phrase";
    case "RELCL":
      return "Relative marker + clause";
    case "NUMPNP":
      return "Number phrase + noun phrase";
    case "NPNUMP":
      return "Noun + number phrase";
    case "NUMPNUMP":
      return "Compound number";
    case "PPANDPP":
      return "Coordinated prepositional phrases";
    case "PPPP":
      return "Prepositional phrase sequence";
    case "PPADVP":
      return "Preposition + adverb phrase";
    case "NPDET":
      return "Noun + determiner";
    case "NPDETADJ":
      return "Noun + described noun phrase";
    case "PRONNP":
      return "Pronoun + noun phrase";
    case "DEMO-NP":
      return "Demonstrative + noun phrase";
    case "BEVERB":
      return "Linking verb + predicate";
    case "CONJ2PP":
      return "Coordinated prepositional phrases";
    case "PREPRELP":
    case "PPRELP":
      return "Preposition + relative phrase";
    case "DETNUMP":
      return "Determiner + number phrase";
    case "NOUNX":
      return "Noun + attached form";
    case "VERBX":
      return "Verb + attached form";
    case "ADVX":
      return "Adverb + attached form";
    case "2ADVP_H1":
    case "2ADVP_H2":
      return "Adverb phrase sequence";
    case "ADJPAADJP":
      return "Coordinated adjective phrases";
    case "CONJ2NUMP":
      return "Coordinated number phrases";
    case "CJPCJP":
      return "Connector sequence";
    case "NUMPANDNUMP":
      return "Compound number";
    case "VPANDVP":
      return "Coordinated verb phrases";
    default:
      return undefined;
  }
}

/**
 * NPofNP is recursively right-nested in long source chains. Keeping every
 * same-rule wrapper turns a genealogy into a hundred-level staircase even
 * though each level repeats the same relationship. Flatten only that exact
 * source rule; coordination and every other attachment keep their hierarchy.
 */
function phraseSourceChildren(node: SyntaxNode): SyntaxNode[] {
  const children = node.children ?? [];
  if (!/^NPofNP$/i.test(node.rule ?? "")) return children;

  const flattened: SyntaxNode[] = [];
  function collect(child: SyntaxNode): void {
    if (
      !isLeaf(child) &&
      !isClause(child) &&
      cat(child) === cat(node) &&
      /^NPofNP$/i.test(child.rule ?? "")
    ) {
      for (const grandchild of child.children ?? []) collect(grandchild);
      return;
    }
    flattened.push(child);
  }
  for (const child of children) collect(child);
  return flattened;
}

const RECURSIVE_NOUN_RELATIONS = new Set([
  "Head + dependent",
  "Apposition",
  "Linked noun chain",
]);

/**
 * Some Greek genealogies alternate NPofNP and Np-Appos for every name. The
 * source relationship is useful, but rendering all wrappers produces a
 * 150-level staircase. Compress only a repeated two-child noun spine after at
 * least four links, preserving every child and exact source order.
 */
function collapseRecursiveNounSpine(node: SyntaxStudyPhraseNode): SyntaxStudyPhraseNode {
  type Expanded = { nodes: SyntaxStudyPhraseNode[]; links: number };
  function expand(current: SyntaxStudyPhraseNode): Expanded | null {
    if (current.kind !== "phrase" || !RECURSIVE_NOUN_RELATIONS.has(current.relation ?? "")) {
      return null;
    }
    if (current.relation === "Linked noun chain") {
      return { nodes: current.children, links: 4 };
    }

    const continuationIndexes = current.children
      .map((child, index) =>
        child.kind === "phrase" && RECURSIVE_NOUN_RELATIONS.has(child.relation ?? "")
          ? index
          : -1,
      )
      .filter((index) => index >= 0);
    if (current.children.length !== 2 || continuationIndexes.length !== 1) {
      return { nodes: current.children, links: 1 };
    }

    const continuationIndex = continuationIndexes[0]!;
    const nested = expand(current.children[continuationIndex]!);
    if (!nested) return { nodes: current.children, links: 1 };
    return {
      nodes: current.children.flatMap((child, index) =>
        index === continuationIndex ? nested.nodes : [child],
      ),
      links: nested.links + 1,
    };
  }

  const expanded = expand(node);
  if (!expanded || expanded.links < 4) return node;
  return {
    ...node,
    relation: "Linked noun chain",
    compression: "recursive-spine",
    children: expanded.nodes.map((child) => ({
      ...child,
      edgeKind: "compressed-member",
    })),
  };
}

/**
 * Convert one source phrase into a compact, study-facing tree. Unary parser
 * conversions (N2NP, V2VP, Vp2V, and similar) add no visible branch, so they
 * collapse. Multi-child phrase relationships and embedded-clause boundaries
 * remain exactly where the source places them.
 */
function phraseNodeFrom(
  node: SyntaxNode,
  focusTokenId: string,
): SyntaxStudyPhraseNode | null {
  if (isClause(node)) {
    return {
      id: `${node.id}:embedded`,
      kind: "clause",
      sourceNodeIds: [node.id],
      sourceRule: node.rule,
      label: "Embedded clause",
      surface: "",
      gloss: "",
      isFocus: false,
      containsFocus: false,
      wordCount: 0,
      targetClauseId: node.id,
      children: [],
    };
  }

  if (isLeaf(node)) {
    const word = wordFrom(node, focusTokenId);
    if (!word.surface) return null;
    return {
      id: node.tokenId ?? node.id,
      kind: "word",
      sourceNodeIds: [node.id],
      sourceRule: node.rule,
      label: phraseCategoryLabel(node),
      surface: word.surface,
      gloss: word.gloss,
      isFocus: word.isFocus,
      containsFocus: word.isFocus,
      wordCount: 1,
      children: [],
    };
  }

  const directChildIds = new Set((node.children ?? []).map((child) => child.id));
  const sourceChildren = phraseSourceChildren(node);
  const children: SyntaxStudyPhraseNode[] = [];
  for (const sourceChild of sourceChildren) {
    const child = phraseNodeFrom(sourceChild, focusTokenId);
    if (!child) continue;
    const direct = directChildIds.has(sourceChild.id);
    children.push({
      ...child,
      edgeKind:
        child.edgeKind === "compressed-member" || !direct
          ? "compressed-member"
          : "source-child",
    });
  }
  if (!children.length) return null;

  // A conversion wrapper with one child does not describe a branch. Keeping
  // it would recreate the noisy np > np > noun ladders the old Tree exposed.
  if (children.length === 1 && children[0]!.kind !== "clause") {
    const child = children[0]!;
    return {
      ...child,
      edgeKind: "compressed-member",
      sourceNodeIds: [node.id, ...(child.sourceNodeIds ?? [])],
      compression: child.compression ?? "unary-wrapper",
    };
  }

  const words = ownWords(node, focusTokenId);
  return collapseRecursiveNounSpine({
    id: node.id,
    kind: "phrase",
    sourceNodeIds: [node.id],
    sourceRule: node.rule,
    compression:
      sourceChildren.some((child) => !directChildIds.has(child.id))
        ? "homogeneous-chain"
        : undefined,
    label: phraseCategoryLabel(node),
    relation: phraseRuleLabel(node.rule, children.length),
    surface: words.map((word) => word.surface).join(" "),
    gloss: phraseGloss(node),
    isFocus: false,
    containsFocus: words.some((word) => word.isFocus),
    wordCount: children.reduce((sum, child) => sum + child.wordCount, 0),
    children,
  });
}

function phraseHasRealBranch(node: SyntaxStudyPhraseNode): boolean {
  if (node.kind === "phrase" && node.children.length > 1 && node.wordCount > 1) return true;
  return node.children.some(phraseHasRealBranch);
}

/** A direct child of CL has a grammatical function; S here means subject. */
function normalizedLemma(value?: string): string {
  return (value ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
}

function containsCopularVerb(node: SyntaxNode): boolean {
  const copular = new Set(["היה", "ειμι", "γινομαι"]);
  if (isLeaf(node) && copular.has(normalizedLemma(node.lemma))) return true;
  return (node.children ?? []).some(containsCopularVerb);
}

function containsPassiveDesignationVerb(node: SyntaxNode): boolean {
  if (isLeaf(node)) {
    const lemma = normalizedLemma(node.lemma);
    const surface = normalizedLemma(node.surface);
    // MACULA marks the complement of passive horizo as O. In constructions
    // such as "declared Son of God," that constituent predicates the role
    // assigned to the subject; it is not a patient of the verb. Keep this
    // correction deliberately lexical and voice-shaped rather than guessing
    // from an English gloss.
    return lemma === "οριζω" && /(?:θη|θεν)/u.test(surface);
  }
  return (node.children ?? []).some(containsPassiveDesignationVerb);
}

export function syntaxRoleForClauseChild(
  node: SyntaxNode,
  clause?: SyntaxNode,
): SyntaxStudyRole {
  switch (cat(node)) {
    case "S":
    case "SUBJ":
      return "subject";
    case "V":
    case "VC":
    case "VP":
    case "VERB":
      return "action";
    case "O":
    case "OBJ":
    case "DO":
      // MACULA normally means Object here. A narrow copular S-V-O pattern in
      // Hebrew (for example Genesis 1:2) uses O for a predicate expression;
      // prefer the conventional label only when the linking verb is explicit.
      if (clause && (clause.children ?? []).some(containsCopularVerb)) return "complement";
      if (clause && (clause.children ?? []).some(containsPassiveDesignationVerb)) {
        return "complement";
      }
      return "object";
    case "O2":
    case "OC":
      return "object";
    case "IO":
      return "recipient";
    case "ADV":
    case "ADVP":
    case "PP":
      return "context";
    case "P":
    case "PRED":
      return "complement";
    case "CONJ":
    case "C":
    case "CJ":
    case "CJP":
    case "SUB":
      return "connector";
    default:
      return "detail";
  }
}

function makeGroup(
  node: SyntaxNode,
  role: SyntaxStudyRole,
  words: SyntaxStudyWord[],
  focusTokenId: string,
  suffix = "",
  label?: string,
): SyntaxStudyGroup {
  const kept = dedupeWords(words);
  const phrase = phraseNodeFrom(node, focusTokenId);
  return {
    id: `${node.id}:${role}${suffix}`,
    role,
    label: label ?? syntaxStudyRoleLabel(role),
    words: kept,
    surface: kept.map((word) => word.surface).join(" "),
    gloss: phraseGloss(node),
    isFocus: kept.some((word) => word.isFocus),
    phrase: phrase && phraseHasRealBranch(phrase) ? phrase : null,
  };
}

function ownGroups(node: SyntaxNode, focusTokenId: string): SyntaxStudyGroup[] {
  const groups: SyntaxStudyGroup[] = [];
  for (const [index, child] of (node.children ?? []).entries()) {
    if (isClause(child)) continue;
    const words = ownWords(child, focusTokenId);
    if (!words.length) continue;
    const role = syntaxRoleForClauseChild(child, node);
    const sourceLabel =
      ["O", "OBJ", "DO"].includes(cat(child)) &&
      role === "complement" &&
      (node.children ?? []).some(containsPassiveDesignationVerb)
        ? "Predicate complement"
        : cat(child) === "O2"
        ? "Second object"
        : cat(child) === "OC"
          ? "Object complement"
          : role === "detail" && phraseCategoryLabel(child) !== "Phrase"
            ? phraseCategoryLabel(child)
            : undefined;
    groups.push(makeGroup(child, role, words, focusTokenId, `:${index}`, sourceLabel));
  }
  return groups;
}

/** Return only the nearest descendant clauses so a clause is visited once. */
function nearestClauses(node: SyntaxNode): SyntaxNode[] {
  const found: SyntaxNode[] = [];
  function walk(current: SyntaxNode): void {
    for (const child of current.children ?? []) {
      if (isClause(child)) found.push(child);
      else walk(child);
    }
  }
  walk(node);
  return found;
}

function isMeaningfulClause(node: SyntaxNode, groups: SyntaxStudyGroup[]): boolean {
  if (!groups.length) return false;
  const hasContent = groups.some((group) => group.role !== "connector");
  if (hasContent) return true;
  // Conj-CL, CLaCL, and similar containers are relationship wrappers. Their
  // connector is carried into the first real descendant clause instead.
  return nearestClauses(node).length === 0;
}

function clauseLabel(node: SyntaxNode, depth: number): string {
  if (depth === 0) return "Clause";
  if (/verb.?elided/i.test(node.clType ?? "")) return "Implied-verb clause";
  if (/verbless/i.test(node.clType ?? "")) return "Verbless clause";
  if (/minor/i.test(node.clType ?? "")) return "Minor clause";
  return "Embedded clause";
}

function flattenGroups(groups: SyntaxStudyGroup[]): SyntaxStudyWord[] {
  return dedupeWords(groups.flatMap((group) => group.words));
}

/** Preserve source order; these fragments are glosses, never a translation. */
export function syntaxStudyGroupsInSourceOrder(
  groups: readonly SyntaxStudyGroup[],
): SyntaxStudyGroup[] {
  return [...groups];
}

/**
 * Build the sentence-level reading sequence used by Phrase detail navigation.
 * Single-word groups are intentionally absent: they have no source branch to
 * diagram and must not become synthetic stops just to fill the navigator.
 */
export function syntaxStudyPhraseStops(
  study: Pick<SyntaxStudyModel, "clauses" | "words">,
): SyntaxStudyPhraseStop[] {
  const wordOrder = new Map(
    study.words.map((word, index) => [word.tokenId ?? word.id, index]),
  );
  return study.clauses
    .flatMap((clause, clauseIndex) =>
      syntaxStudyGroupsInSourceOrder(clause.groups)
        .filter((group) => group.phrase !== null)
        .map((group, groupIndex) => ({
          clauseId: clause.id,
          groupId: group.id,
          sourceIndex: Math.min(
            ...group.words.map((word) => wordOrder.get(word.tokenId ?? word.id) ?? Infinity),
          ),
          clauseIndex,
          groupIndex,
        })),
    )
    .sort(
      (left, right) =>
        left.sourceIndex - right.sourceIndex ||
        left.clauseIndex - right.clauseIndex ||
        left.groupIndex - right.groupIndex,
    )
    .map(({ clauseId, groupId }) => ({ clauseId, groupId }));
}

function roughSourceGloss(groups: SyntaxStudyGroup[]): string {
  const text = syntaxStudyGroupsInSourceOrder(groups)
    .filter((group) => Boolean(group.gloss))
    .map((group) => group.gloss)
    .join(" ")
    .trim();
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : "";
}

/**
 * Build the shared renderer model. Wrapper CL nodes are collapsed; a wrapper's
 * conjunction/subordinator is carried into its first meaningful child clause.
 */
export function buildSyntaxStudyModel(
  root: SyntaxNode,
  focusTokenId: string,
): SyntaxStudyModel {
  const clauses: SyntaxStudyClause[] = [];

  function visit(
    node: SyntaxNode,
    depth: number,
    parentId?: string,
    prefix: SyntaxStudyGroup[] = [],
  ): void {
    const groups = ownGroups(node, focusTokenId);
    const meaningful = isMeaningfulClause(node, groups);
    const nested = nearestClauses(node);

    if (meaningful) {
      const combined = [...prefix, ...groups];
      const words = flattenGroups(combined);
      const clause: SyntaxStudyClause = {
        id: node.id,
        parentId,
        depth,
        label: clauseLabel(node, depth),
        rule: node.rule,
        clType: node.clType,
        groups: combined,
        words,
        surface: words.map((word) => word.surface).join(" "),
        gloss: roughSourceGloss(combined),
        isFocus: words.some((word) => word.isFocus),
      };
      clauses.push(clause);
      for (const child of nested) visit(child, depth + 1, clause.id);
      return;
    }

    // Relationship-only wrappers (for example Conj-CL) become prefix groups
    // on the first content clause instead of empty standalone cards.
    let first = true;
    for (const child of nested) {
      visit(child, depth, parentId, first ? [...prefix, ...groups] : []);
      first = false;
    }
  }

  if (isClause(root)) {
    visit(root, 0);
  } else {
    // Sentence roots often keep conjunctions between their clauses. Preserve
    // those as a Connector on the clause they introduce instead of silently losing
    // them when we collect only descendant CL nodes.
    let pending: SyntaxStudyGroup[] = [];
    for (const [index, child] of (root.children ?? []).entries()) {
      if (isClause(child)) {
        visit(child, 0, undefined, pending);
        pending = [];
        continue;
      }

      const containedClauses = nearestClauses(child);
      if (containedClauses.length) {
        for (const [clauseIndex, clause] of containedClauses.entries()) {
          visit(clause, 0, undefined, clauseIndex === 0 ? pending : []);
        }
        pending = [];
        continue;
      }

      const words = ownWords(child, focusTokenId);
      if (words.length) {
        pending.push(
          makeGroup(
            child,
            syntaxRoleForClauseChild(child),
            words,
            focusTokenId,
            `:root:${index}`,
          ),
        );
      }
    }

    // Some source trees wrap every clause below another non-clause node and
    // provide no direct children usable above. Keep the former safe fallback.
    if (!clauses.length) {
      for (const clause of nearestClauses(root)) visit(clause, 0);
    }
  }

  const words = allWords(root, focusTokenId);
  const focusWord = words.find((word) => word.isFocus) ?? null;
  const focused = clauses
    .filter((clause) => clause.isFocus)
    .sort((a, b) => b.depth - a.depth)[0] ?? null;

  // Exact focus or no focus. A connector inside a collapsed wrapper is carried
  // into its descendant group above; an unknown token must never select an
  // unrelated first clause.
  const focusClauseId = focused?.id ?? null;

  // Embedded-clause placeholders are navigation, not dead-end annotations.
  // A relationship wrapper may collapse out of the study model, so resolve it
  // to the first visible descendant clause before handing the tree to the UI.
  const sourceById = new Map<string, SyntaxNode>();
  (function indexSource(node: SyntaxNode): void {
    sourceById.set(node.id, node);
    for (const child of node.children ?? []) indexSource(child);
  })(root);
  const visibleClauseIds = new Set(clauses.map((clause) => clause.id));
  function resolveClauseTarget(sourceId: string): string | undefined {
    if (visibleClauseIds.has(sourceId)) return sourceId;
    const source = sourceById.get(sourceId);
    if (!source) return undefined;
    const queue = [...(source.children ?? [])];
    while (queue.length) {
      const candidate = queue.shift()!;
      if (isClause(candidate) && visibleClauseIds.has(candidate.id)) return candidate.id;
      queue.push(...(candidate.children ?? []));
    }
    return undefined;
  }
  function resolvePhraseTargets(node: SyntaxStudyPhraseNode): boolean {
    if (node.kind === "clause" && node.targetClauseId) {
      node.targetClauseId = resolveClauseTarget(node.targetClauseId);
      // A handful of source trees contain empty CL conversion wrappers with
      // neither lexical content nor a visible descendant clause. They are
      // parser scaffolding, not useful navigation destinations.
      if (!node.targetClauseId) return false;
    }
    node.children = node.children.filter(resolvePhraseTargets);
    return true;
  }
  for (const clause of clauses) {
    for (const group of clause.groups) {
      if (group.phrase) {
        const resolved = resolvePhraseTargets(group.phrase);
        if (!resolved || !phraseHasRealBranch(group.phrase)) group.phrase = null;
      }
    }
  }

  return {
    clauses,
    focusClauseId,
    focusWord,
    words,
    wordCount: words.length,
  };
}
