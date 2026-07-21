import type { BookNameData } from "../api.js";

/**
 * One display form for canonical coordinates everywhere: "ACT.19.2" becomes
 * "Acts 19:2" when the book-name table is available, never a raw code in
 * one card and a friendly name in the next.
 */
export function formatCanonicalRef(value: string, bookNames?: BookNameData): string {
  const match = /^([1-3A-Z]{3})\.(\d+)\.(\d+)$/.exec(value);
  if (!match) return value;
  const code = match[1]!;
  const name = bookNames?.[code]?.[0] ?? code;
  return `${name} ${Number(match[2])}:${Number(match[3])}`;
}
