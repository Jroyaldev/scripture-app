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
  stemEnglishToken,
  isFunctionWordForOrbit,
  donutSegmentPath,
  ORBIT_PALETTE,
  type OrbitSegment,
  type RenderingOrbit,
} from "./rendering-orbit.js";

export {
  buildGreekSemanticSenseOutline,
  parseMaculaSdbgSenseGlosses,
  semanticSenseLookupKey,
  semanticSenseTagsForToken,
  type GreekSemanticSenseItem,
  type GreekSemanticSenseOutline,
  type GreekSemanticSenseParseResult,
  type GreekSemanticSenseTag,
} from "./greek-senses.js";

export {
  normalizeEnglishWord,
  accumulateReverseIndex,
  finalizeReverseIndex,
  buildReverseOrbitDetailed,
  englishKeysFromGloss,
  topWords,
  resolveReverseIndexPackage,
  reverseSourceLabel,
  type ReverseIndexFile,
  type ReverseStrongCount,
  type ReverseOrbit,
  type ReverseOrbitSegment,
} from "./reverse-index.js";

export {
  HebrewOrbitIndex,
  getSharedHebrewOrbitIndex,
  setSharedHebrewOrbitIndex,
  type HebrewOrbitFile,
} from "./hebrew-orbit-index.js";

export {
  layoutSyntaxTree,
  simplifyTree,
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
  buildSyntaxStudyModel,
  syntaxStudyGroupsInSourceOrder,
  syntaxStudyPhraseStops,
  syntaxRoleForClauseChild,
  syntaxStudyRoleLabel,
  type SyntaxStudyClause,
  type SyntaxStudyGroup,
  type SyntaxStudyModel,
  type SyntaxStudyPhraseStop,
  type SyntaxStudyPhraseNode,
  type SyntaxStudyRole,
  type SyntaxStudyWord,
} from "./syntax-study.js";
export {
  buildPhraseDiagramProjection,
  layoutPhraseDiagram,
  phraseDiagramPolicy,
  phraseDiagramShape,
  type LaidOutPhraseDiagramNode,
  type PhraseDiagramEdge,
  type PhraseDiagramLayout,
  type PhraseDiagramNode,
  type PhraseDiagramNodeSize,
  type PhraseDiagramPolicy,
  type PhraseDiagramProjection,
  type PhraseDiagramShape,
  type PhraseDiagramView,
} from "./syntax-diagram.js";

export {
  lookupStrongGloss,
  normalizeStrongNumber,
  parseStrongGlossJson,
  shortGlossLabel,
  type StrongGlossEntry,
} from "./lexicon.js";
