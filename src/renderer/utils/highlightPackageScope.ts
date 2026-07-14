/**
 * Character offsets are translation-specific. A highlight created against
 * WEB must never be projected onto KJV text just because the canonical verse
 * coordinates match. Keep package scoping explicit at the shared renderer
 * read boundary so every visual/selection consumer receives the same layer.
 */
export function scopeHighlightsToPackage<T extends { package: string }>(
  highlights: readonly T[],
  packageId: string,
): T[] {
  return highlights.filter((highlight) => highlight.package === packageId);
}
