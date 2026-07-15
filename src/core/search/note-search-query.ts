/** Convert a user-entered phrase into a literal FTS5 AND query. */
export function toFts5PlainQuery(query: string): string {
  const tokens = query
    .normalize("NFKC")
    .match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)
    ?.map((token) => token.replace(/’/g, "'").replace(/"/g, '""'))
    .filter(Boolean) ?? [];
  return [...new Set(tokens)].map((token) => `"${token}"`).join(" AND ");
}
