/**
 * Original-language data layer (tokens, morph labels, MACULA Greek import, indexes).
 */

export type {
  MorphFeatures,
  ParseMaculaGreekResult,
  TokenDatasetMeta,
  TokenIndex,
  TokenMark,
  TokenMarkKind,
  TokenRecord,
} from "./types.js";

export {
  mergeMorphFeatures,
  morphFeatureLabels,
  parseMorphCode,
} from "./morph-labels.js";

export {
  MACULA_GREEK_NESTLE1904_META,
  MACULA_GREEK_SBLGNT_META,
  buildColumnIndex,
  parseMaculaGreekTsv,
  parseMaculaGreekTsvLine,
  parseMaculaRef,
  splitTsvLine,
  type ColumnIndex,
  type ParseMaculaGreekOptions,
} from "./macula-greek-tsv.js";

export {
  bookLemmaKey,
  buildTokenIndex,
  chapterLemmaKey,
  compareReadingOrder,
  lemmaOccurrencesInBook,
  marksForVerse,
  tokenNeighborhood,
  tokensForVerse,
  verseKey,
  type MarkOptions,
} from "./indexes.js";

export {
  coerceTokenRecord,
  parseLanguagePackageManifest,
  parseTokensJsonl,
  type LanguagePackageManifest,
  type ParseTokensJsonlResult,
} from "./jsonl.js";

export {
  hebrewMorphFeatureLabels,
  parseHebrewMorphCode,
} from "./hebrew-morph-labels.js";

export {
  OSHB_WLC_META,
  osisBookIds,
  parseOshbLemma,
  parseOshbOsisBook,
  parseOshbOsisBooks,
  parseOsisVerseId,
  type ParseOshbOptions,
  type ParseOshbResult,
} from "./oshb-osis.js";

export {
  explainMorphCode,
  kindForMorphLabel,
  orderMorphParts,
  visibleMorphParts,
  MORPH_CHIP_VISIBLE_MAX,
  type MorphExplanation,
  type MorphPartExplain,
  type MorphPartKind,
} from "./morph-explain.js";

export {
  StepMorphIndex,
  getSharedStepMorphIndex,
  setSharedStepMorphIndex,
  parseStepFullTable,
  stepLookupCandidates,
  type StepMorphOverlay,
} from "./step-morph.js";

export {
  TipnrIndex,
  getSharedTipnrIndex,
  setSharedTipnrIndex,
  tokenLooksLikeProperName,
  formatTipnrDisplayName,
  type TipnrEntity,
  type TipnrIndexFile,
  type NameResolveQuery,
  type NameResolveHit,
} from "./tipnr.js";

export {
  buildRenderingOrbit,
  normalizeOrbitGloss,
  formatOrbitLabel,
  donutSegmentPath,
  ORBIT_PALETTE,
  type OrbitSegment,
  type RenderingOrbit,
} from "./rendering-orbit.js";

export {
  layoutSyntaxTree,
  simplifyTree,
  parseMaculaNodesXml,
  buildSyntaxBookIndex,
  sentenceForToken,
  catLabel,
  type SyntaxNode,
  type SyntaxSentence,
  type SyntaxPackageIndex,
  type SyntaxLayout,
  type LaidOutNode,
} from "./syntax-tree.js";

export {
  lookupStrongGloss,
  normalizeStrongNumber,
  parseStrongGlossJson,
  shortGlossLabel,
  type StrongGlossEntry,
} from "./lexicon.js";
