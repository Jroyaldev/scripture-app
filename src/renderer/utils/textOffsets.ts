/**
 * DOM node + node-relative offset for a character offset into an element's
 * text, walking all text nodes (robust to future markup splitting the span).
 */
export function locateTextOffset(
  root: HTMLElement,
  charOffset: number,
): { node: Node; offset: number } | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let consumed = 0;
  let node = walker.nextNode();
  while (node) {
    const length = node.textContent?.length ?? 0;
    if (consumed + length >= charOffset) return { node, offset: charOffset - consumed };
    consumed += length;
    node = walker.nextNode();
  }
  return null;
}
