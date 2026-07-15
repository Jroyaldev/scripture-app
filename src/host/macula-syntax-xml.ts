/**
 * Build-time MACULA Node XML parser.
 *
 * XML parsing belongs in the host/import layer, not platform-agnostic core.
 * The source contains both paired and self-closing <m> elements; using a DOM
 * parser prevents a self-closing morpheme from consuming later sibling XML.
 */

import { DOMParser } from "@xmldom/xmldom";
import {
  parseMaculaSentenceRef,
  simplifyTree,
  type SyntaxNode,
  type SyntaxSentence,
} from "../core/language/syntax-tree.js";

function directChildren(element: Element, name?: string): Element[] {
  const children: Element[] = [];
  for (let index = 0; index < element.childNodes.length; index += 1) {
    const child = element.childNodes.item(index);
    if (child?.nodeType !== 1) continue;
    const childElement = child as Element;
    if (!name || childElement.tagName === name) children.push(childElement);
  }
  return children;
}

function firstDirectChild(element: Element, name: string): Element | null {
  return directChildren(element, name)[0] ?? null;
}

function attribute(element: Element, name: string): string | undefined {
  const value = element.getAttribute(name);
  return value == null || value === "" ? undefined : value;
}

function normalizeStrong(value?: string): string | undefined {
  if (!value) return undefined;
  return value.replace(/[a-zA-Z]+$/g, "").replace(/^0+/, "") || value;
}

function nodeFromElement(element: Element, path: readonly number[] = [0]): SyntaxNode {
  const morpheme = firstDirectChild(element, "m");
  const greekId = attribute(element, "xml:id");
  const hebrewId = attribute(element, "n") ?? attribute(element, "morphId");
  const morphemeId = morpheme ? attribute(morpheme, "xml:id") : undefined;
  const tokenId = greekId?.startsWith("n")
    ? greekId
    : hebrewId?.startsWith("o")
      ? hebrewId
      : morphemeId;
  const unicode = attribute(element, "Unicode") ?? attribute(element, "NormalizedForm");
  const morphemeText = morpheme?.textContent?.trim() || undefined;

  const node: SyntaxNode = {
    id:
      attribute(element, "nodeId") ??
      greekId ??
      attribute(element, "n") ??
      attribute(element, "morphId") ??
      `node-${path.join("-")}`,
    cat: attribute(element, "Cat") ?? "?",
    rule: attribute(element, "Rule"),
    clType: attribute(element, "ClType"),
  };

  if (tokenId) {
    node.tokenId = tokenId;
    node.surface = unicode ?? morphemeText;
    node.gloss =
      attribute(element, "Gloss") ??
      (morpheme ? attribute(morpheme, "english") ?? attribute(morpheme, "gloss") : undefined);
    node.lemma =
      attribute(element, "UnicodeLemma") ??
      (morpheme ? attribute(morpheme, "lemma") : undefined);
    node.strong = normalizeStrong(
      attribute(element, "StrongNumber") ?? attribute(element, "StrongNumberX"),
    );
  }

  const children = directChildren(element, "Node").map((child, index) =>
    nodeFromElement(child, [...path, index]),
  );
  if (children.length) node.children = children;
  return node;
}

function collectTokenIds(node: SyntaxNode, out: string[]): void {
  if (node.tokenId) out.push(node.tokenId);
  for (const child of node.children ?? []) collectTokenIds(child, out);
}

/** Parse MACULA nodes book/chapter XML into compact, deterministic sentences. */
export function parseMaculaNodesXml(xml: string, bookCode: string): SyntaxSentence[] {
  const errors: string[] = [];
  const document = new DOMParser({
    errorHandler: {
      warning: () => undefined,
      error: (message) => errors.push(String(message)),
      fatalError: (message) => errors.push(String(message)),
    },
  }).parseFromString(xml, "application/xml");
  if (errors.length) {
    throw new Error(`Malformed MACULA XML: ${errors[0]}`);
  }

  const sentences: SyntaxSentence[] = [];
  const sentenceElements = Array.from(document.getElementsByTagName("Sentence"));
  for (const [sentenceIndex, sentenceElement] of sentenceElements.entries()) {
    const refRaw =
      attribute(sentenceElement, "ref") ?? attribute(sentenceElement, "verse") ?? "";
    const tree = sentenceElement.getElementsByTagName("Tree").item(0);
    const rootElement = tree ? firstDirectChild(tree, "Node") : null;
    if (!rootElement) continue;

    const root = simplifyTree(nodeFromElement(rootElement));
    const tokenIds: string[] = [];
    collectTokenIds(root, tokenIds);
    if (!tokenIds.length) continue;

    const { chapter, verseStart, verseEnd } = parseMaculaSentenceRef(refRaw);
    const refLabel =
      verseStart === verseEnd
        ? `${bookCode} ${chapter}:${verseStart}`
        : `${bookCode} ${chapter}:${verseStart}–${verseEnd}`;
    sentences.push({
      id: `${bookCode}.${chapter}.${verseStart}.${sentenceIndex}`,
      refLabel,
      book: bookCode,
      chapter,
      verseStart,
      verseEnd,
      tokenIds,
      root,
    });
  }
  return sentences;
}
