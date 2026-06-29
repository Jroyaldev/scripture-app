export type {
  BackboneData,
  BookCode,
  BookData,
  BookNameMap,
  CanonicalRef,
  CanonicalVerse,
  ScripturePackage,
  TokenNarrowing,
  VersificationMap,
  VersificationRule,
} from "./types.js";

export { BOOK_CODES } from "./types.js";

export {
  isValidBookCode,
  validateVerse,
  validateBackboneData,
} from "./backbone.js";

export type { BackboneValidationResult } from "./backbone.js";

export {
  parseBref,
  toBref,
  validateRef,
  compareVerses,
  toDisplayString,
  parseHumanRef,
  verseInRange,
  rangesOverlap,
} from "./parser.js";

export type { ParseResult } from "./parser.js";
