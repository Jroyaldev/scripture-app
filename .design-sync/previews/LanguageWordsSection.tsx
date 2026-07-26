import { LanguageWordsSection } from 'scripture-app';
import { useEffect, useRef } from 'react';

/**
 * Acts 24:1 — "And after five days Ananias the high priest descended with the
 * elders, and with a certain orator named Tertullus, who informed the governor
 * against Paul." Nestle 1904 word order; every lemma, Strong's key and gloss
 * below is the real one for this verse.
 */

const DATASET = 'macula-greek-nestle1904';

const tok = (
  position: number,
  surface: string,
  lemma: string | undefined,
  strong: string | undefined,
  morphCode: string | undefined,
  morph: Record<string, string>,
  displayGloss: string | undefined,
) => ({
  id: `n1904-ACT-24-1-${position}`,
  datasetId: DATASET,
  book: 'ACT',
  chapter: 24,
  verse: 1,
  position,
  surface,
  lemma,
  strong,
  strongPrefixed: strong ? `G${strong}` : undefined,
  morphCode,
  morph,
  gloss: displayGloss,
  displayGloss,
  wordClass: morph.pos,
  order: position,
});

const acts24_1 = [
  tok(1, 'Μετὰ', 'μετά', '3326', 'PREP', { pos: 'prep' }, 'after'),
  tok(2, 'δὲ', 'δέ', '1161', 'CONJ', { pos: 'conj' }, 'and'),
  tok(3, 'πέντε', 'πέντε', '4002', 'A-APF', { pos: 'adj', case: 'accusative', number: 'plural', gender: 'feminine' }, 'five'),
  tok(4, 'ἡμέρας', 'ἡμέρα', '2250', 'N-APF', { pos: 'noun', case: 'accusative', number: 'plural', gender: 'feminine' }, 'days'),
  tok(5, 'κατέβη', 'καταβαίνω', '2597', 'V-2AAI-3S', { pos: 'verb', tense: 'aorist', voice: 'active', mood: 'indicative', person: 'third', number: 'singular' }, 'came down'),
  tok(6, 'ὁ', 'ὁ', '3588', 'T-NSM', { pos: 'art', case: 'nominative', number: 'singular', gender: 'masculine' }, 'the'),
  tok(7, 'ἀρχιερεὺς', 'ἀρχιερεύς', '749', 'N-NSM', { pos: 'noun', case: 'nominative', number: 'singular', gender: 'masculine' }, 'high priest'),
  tok(8, 'Ἀνανίας', 'Ἀνανίας', '367', 'N-NSM', { pos: 'noun', case: 'nominative', number: 'singular', gender: 'masculine' }, 'Ananias'),
  tok(9, 'μετὰ', 'μετά', '3326', 'PREP', { pos: 'prep' }, 'with'),
  tok(10, 'πρεσβυτέρων', 'πρεσβύτερος', '4245', 'A-GPM', { pos: 'adj', case: 'genitive', number: 'plural', gender: 'masculine' }, 'elders'),
  tok(11, 'τινῶν', 'τις', '5100', 'X-GPM', { pos: 'pron', case: 'genitive', number: 'plural', gender: 'masculine' }, 'certain'),
  tok(12, 'καὶ', 'καί', '2532', 'CONJ', { pos: 'conj' }, 'and'),
  tok(13, 'ῥήτορος', 'ῥήτωρ', '4489', 'N-GSM', { pos: 'noun', case: 'genitive', number: 'singular', gender: 'masculine' }, 'orator'),
  tok(14, 'Τερτύλλου', 'Τέρτυλλος', '5061', 'N-GSM', { pos: 'noun', case: 'genitive', number: 'singular', gender: 'masculine' }, 'Tertullus'),
  tok(15, 'τινός', 'τις', '5100', 'X-GSM', { pos: 'pron', case: 'genitive', number: 'singular', gender: 'masculine' }, 'a certain'),
  tok(16, 'οἵτινες', 'ὅστις', '3748', 'R-NPM', { pos: 'pron', case: 'nominative', number: 'plural', gender: 'masculine' }, 'who'),
  tok(17, 'ἐνεφάνισαν', 'ἐμφανίζω', '1718', 'V-AAI-3P', { pos: 'verb', tense: 'aorist', voice: 'active', mood: 'indicative', person: 'third', number: 'plural' }, 'laid charges'),
  tok(18, 'τῷ', 'ὁ', '3588', 'T-DSM', { pos: 'art', case: 'dative', number: 'singular', gender: 'masculine' }, 'the'),
  tok(19, 'ἡγεμόνι', 'ἡγεμών', '2232', 'N-DSM', { pos: 'noun', case: 'dative', number: 'singular', gender: 'masculine' }, 'governor'),
  tok(20, 'κατὰ', 'κατά', '2596', 'PREP', { pos: 'prep' }, 'against'),
  tok(21, 'τοῦ', 'ὁ', '3588', 'T-GSM', { pos: 'art', case: 'genitive', number: 'singular', gender: 'masculine' }, 'the'),
  tok(22, 'Παύλου', 'Παῦλος', '3972', 'N-GSM', { pos: 'noun', case: 'genitive', number: 'singular', gender: 'masculine' }, 'Paul'),
];

const byId = new Map(acts24_1.map((t) => [t.id, t]));

/** ἀρχιερεύς occurs 22× in Acts; these are the real chapters and verses. */
const archiereusInActs = [
  [4, 6], [5, 17], [5, 21], [5, 24], [5, 27], [7, 1], [9, 1], [9, 14], [9, 21],
  [19, 14], [22, 5], [22, 30], [23, 2], [23, 4], [23, 5], [23, 14], [24, 1],
  [25, 2], [25, 15], [26, 10], [26, 12], [9, 2],
].map(([chapter, verse], i) => ({
  id: i === 16 ? 'n1904-ACT-24-1-7' : `n1904-ACT-${chapter}-${verse}-a`,
  datasetId: DATASET,
  book: 'ACT',
  chapter,
  verse,
  position: 1,
  surface: chapter === 24 ? 'ἀρχιερεὺς' : 'ἀρχιερεύς',
  lemma: 'ἀρχιερεύς',
  strong: '749',
  strongPrefixed: 'G749',
  morph: { pos: 'noun' },
}));

const morphNoun = (caseName: string, number: string, gender: string) => [
  { label: 'noun', meaning: 'names a person, place, or thing', kind: 'pos' },
  { label: caseName, meaning: caseName === 'nominative' ? 'the subject of the verb' : caseName === 'genitive' ? 'of — source, possession, or kind' : 'the naming case', kind: 'case' },
  { label: number, meaning: number === 'singular' ? 'one' : 'more than one', kind: 'number' },
  { label: gender, meaning: 'grammatically masculine', kind: 'gender' },
];

/** ἀρχιερεύς — the owner's worked example. */
const archiereusCard = {
  token: byId.get('n1904-ACT-24-1-7'),
  displaySurface: 'ἀρχιερεὺς',
  gloss: 'high-priest',
  glossSource: 'package',
  morphLabels: ['nominative', 'singular', 'masculine'],
  morphExplain: {
    code: 'N-NSM',
    language: 'greek',
    summary: 'Noun · nominative singular masculine',
    parts: morphNoun('nominative', 'singular', 'masculine'),
  },
  stepMorph: {
    code: 'N-NSM',
    phrase: 'Noun, nominative, singular, masculine',
    explanation: 'The nominative marks the word that is doing the verb — here, the one who came down.',
    example: 'κατέβη ὁ ἀρχιερεὺς Ἀνανίας — “the high priest Ananias came down”.',
    source: 'STEPBible TEGMC',
  },
  nameEntity: null,
  definition: {
    firstSense: 'a high-priest, chief-priest',
    full: 'from ἀρχή and ἱερεύς; the high-priest (literally of the Jews, typically Christ); by extension a chief priest.',
    xlit: 'archiereus',
    pronunciation: 'ar-khee-er-yooce',
    source: "Strong's",
    id: 'G749',
    deeper: {
      firstSense: 'chief priest, high priest',
      full: 'chief priest, high priest. He above all others was honoured with the title of priest; the chief of the priests, who alone entered the Holy of Holies once a year.',
      source: 'Thayer',
      id: 'G749',
    },
  },
  renderingOrbit: {
    lemma: 'ἀρχιερεύς',
    strongPrefixed: 'G749',
    total: 122,
    lemmaCount: 122,
    source: 'package-gloss',
    kind: 'content',
    segments: [
      { label: 'high priest', count: 64, share: 64 / 122, isCurrent: true },
      { label: 'chief priests', count: 47, share: 47 / 122 },
      { label: 'chief priest', count: 11, share: 11 / 122 },
    ],
  },
  semanticSenses: {
    source: 'MACULA / MARBLE',
    total: 2,
    hiddenCount: 0,
    taggedOccurrences: 118,
    totalOccurrences: 122,
    senses: [
      { rank: 1, ids: ['G749'], label: 'high priest', domain: 'Religious Activities', count: 96, current: true, examples: ['Acts 24:1', 'Matthew 26:3'] },
      { rank: 2, ids: ['G749'], label: 'chief priests', domain: 'Groups and Classes of Persons', count: 22, current: false, examples: ['Acts 4:23', 'Mark 14:1'] },
    ],
  },
  reverseOrbit: {
    englishWord: 'high priest',
    key: 'high priest',
    total: 161,
    packageId: 'bsb',
    source: 'alignments',
    scopeHint: 'whole Bible · BSB',
    segments: [
      { label: 'ἀρχιερεύς', count: 122, share: 122 / 161, isCurrent: true, strongs: 'G749' },
      { label: 'כֹּהֵן', count: 31, share: 31 / 161, strongs: 'H3548' },
      { label: 'ἱερεύς', count: 8, share: 8 / 161, strongs: 'G2409' },
    ],
  },
  lemmaFreq: { corpus: 122, book: 22, chapter: 1 },
  neighborhood: { before: [], after: [] },
  occurrencesInBook: archiereusInActs,
  marks: [],
};

/**
 * πρεσβύτερος — the same Greek word split by sense: G4245G is the office,
 * G4245H is the age. The sense outline is the only word map this lemma has.
 */
const presbuterosCard = {
  token: { ...byId.get('n1904-ACT-24-1-10'), strongPrefixed: 'G4245G' },
  displaySurface: 'πρεσβυτέρων',
  gloss: 'elder — the office, not the age',
  glossSource: 'package',
  morphLabels: ['genitive', 'plural', 'masculine'],
  morphExplain: {
    code: 'A-GPM',
    language: 'greek',
    summary: 'Adjective · genitive plural masculine',
    parts: [
      { label: 'adjective', meaning: 'describes a noun; here it stands on its own as one', kind: 'pos' },
      { label: 'genitive', meaning: 'of — source, possession, or kind', kind: 'case' },
      { label: 'plural', meaning: 'more than one', kind: 'number' },
      { label: 'masculine', meaning: 'grammatically masculine', kind: 'gender' },
    ],
  },
  stepMorph: {
    code: 'A-GPM',
    phrase: 'Adjective, genitive, plural, masculine',
    explanation: 'After μετά the genitive means accompaniment — the people he came down with.',
    example: 'μετὰ πρεσβυτέρων τινῶν — “with certain elders”.',
    source: 'STEPBible TEGMC',
  },
  nameEntity: null,
  definition: {
    firstSense: 'elder, senior; an elder of the Sanhedrin or of the church',
    full: 'comparative of πρέσβυς; older; as a noun, an elder — a member of the Jewish Sanhedrin, or a presbyter of the Christian church.',
    xlit: 'presbuteros',
    pronunciation: 'pres-boo-ter-os',
    source: "Strong's",
    id: 'G4245G',
    deeper: null,
  },
  renderingOrbit: null,
  reverseOrbit: null,
  semanticSenses: {
    source: 'MACULA / MARBLE',
    total: 2,
    hiddenCount: 0,
    taggedOccurrences: 66,
    totalOccurrences: 66,
    senses: [
      { rank: 1, ids: ['G4245G'], label: 'elder: Elder', domain: 'Groups and Classes of Persons', count: 48, current: true, examples: ['Acts 24:1', 'Acts 15:2'] },
      { rank: 2, ids: ['G4245H'], label: 'elder: old', domain: 'Age', count: 18, current: false, examples: ['Luke 15:25', '1 Timothy 5:1'] },
    ],
  },
  lemmaFreq: { corpus: 66, book: 18, chapter: 1 },
  neighborhood: { before: [], after: [] },
  occurrencesInBook: [
    { id: 'n1904-ACT-11-30-p', datasetId: DATASET, book: 'ACT', chapter: 11, verse: 30, position: 1, surface: 'πρεσβυτέρους', lemma: 'πρεσβύτερος', strong: '4245', morph: { pos: 'adj' } },
    { id: 'n1904-ACT-14-23-p', datasetId: DATASET, book: 'ACT', chapter: 14, verse: 23, position: 1, surface: 'πρεσβυτέρους', lemma: 'πρεσβύτερος', strong: '4245', morph: { pos: 'adj' } },
    { id: 'n1904-ACT-15-2-p', datasetId: DATASET, book: 'ACT', chapter: 15, verse: 2, position: 1, surface: 'πρεσβυτέρους', lemma: 'πρεσβύτερος', strong: '4245', morph: { pos: 'adj' } },
    { id: 'n1904-ACT-20-17-p', datasetId: DATASET, book: 'ACT', chapter: 20, verse: 17, position: 1, surface: 'πρεσβυτέρους', lemma: 'πρεσβύτερος', strong: '4245', morph: { pos: 'adj' } },
    { id: 'n1904-ACT-24-1-10', datasetId: DATASET, book: 'ACT', chapter: 24, verse: 1, position: 10, surface: 'πρεσβυτέρων', lemma: 'πρεσβύτερος', strong: '4245', morph: { pos: 'adj' } },
    { id: 'n1904-ACT-25-15-p', datasetId: DATASET, book: 'ACT', chapter: 25, verse: 15, position: 1, surface: 'πρεσβύτεροι', lemma: 'πρεσβύτερος', strong: '4245', morph: { pos: 'adj' } },
  ],
  marks: [],
};

const tipnrLicence = {
  siglum: 'TIPNR',
  name: 'STEPBible TIPNR',
  license: 'CC BY 4.0',
  href: 'https://github.com/STEPBible/STEPBible-Data',
};

/** Ἀνανίας — three men of that name in Acts; TIPNR keeps them apart. */
const ananiasCard = {
  token: byId.get('n1904-ACT-24-1-8'),
  displaySurface: 'Ἀνανίας',
  gloss: 'Ananias',
  glossSource: 'package',
  morphLabels: ['nominative', 'singular', 'masculine'],
  morphExplain: {
    code: 'N-NSM',
    language: 'greek',
    summary: 'Noun · nominative singular masculine',
    parts: morphNoun('nominative', 'singular', 'masculine'),
  },
  stepMorph: null,
  nameEntity: {
    match: 'ref+strong',
    licensed: tipnrLicence,
    entity: {
      id: 'Ananias@Act.23.2-=G0367I',
      kind: 'person',
      displayName: 'Ananias',
      brief: 'High priest who presided over Paul’s trial',
      uStrong: 'G0367I',
      baseStrong: 'G367',
      firstRef: 'ACT.23.2',
      refs: ['ACT.23.2', 'ACT.24.1'],
      refCount: 2,
      gender: 'Male',
    },
    alternatives: [
      {
        id: 'Ananias@Act.5.1-=G0367G',
        kind: 'person',
        displayName: 'Ananias',
        brief: 'Kept back part of the price of the land',
        uStrong: 'G0367G',
        baseStrong: 'G367',
        firstRef: 'ACT.5.1',
        refs: ['ACT.5.1', 'ACT.5.3', 'ACT.5.5'],
        refCount: 3,
        gender: 'Male',
      },
      {
        id: 'Ananias@Act.9.10-=G0367H',
        kind: 'person',
        displayName: 'Ananias',
        brief: 'Disciple at Damascus sent to Saul',
        uStrong: 'G0367H',
        baseStrong: 'G367',
        firstRef: 'ACT.9.10',
        refs: ['ACT.9.10', 'ACT.9.17', 'ACT.22.12'],
        refCount: 3,
        gender: 'Male',
      },
    ],
  },
  definition: {
    firstSense: 'Ananias, the name of three Israelites',
    full: 'of Hebrew origin (חֲנַנְיָה, “the Lord has been gracious”); Ananias, the name of three Israelites.',
    xlit: 'Ananias',
    pronunciation: 'an-an-ee-as',
    source: "Strong's",
    id: 'G367',
    deeper: null,
  },
  renderingOrbit: null,
  reverseOrbit: null,
  semanticSenses: null,
  lemmaFreq: { corpus: 11, book: 11, chapter: 1 },
  neighborhood: { before: [], after: [] },
  occurrencesInBook: [
    { id: 'n1904-ACT-5-1-a', datasetId: DATASET, book: 'ACT', chapter: 5, verse: 1, position: 1, surface: 'Ἁνανίας', lemma: 'Ἀνανίας', strong: '367', morph: { pos: 'noun' } },
    { id: 'n1904-ACT-9-10-a', datasetId: DATASET, book: 'ACT', chapter: 9, verse: 10, position: 1, surface: 'Ἁνανίας', lemma: 'Ἀνανίας', strong: '367', morph: { pos: 'noun' } },
    { id: 'n1904-ACT-23-2-a', datasetId: DATASET, book: 'ACT', chapter: 23, verse: 2, position: 1, surface: 'Ἁνανίας', lemma: 'Ἀνανίας', strong: '367', morph: { pos: 'noun' } },
    { id: 'n1904-ACT-24-1-8', datasetId: DATASET, book: 'ACT', chapter: 24, verse: 1, position: 8, surface: 'Ἀνανίας', lemma: 'Ἀνανίας', strong: '367', morph: { pos: 'noun' } },
  ],
  marks: [],
};

/** μετά — what the panel lands on before the reader picks a word. */
const metaCard = {
  token: byId.get('n1904-ACT-24-1-1'),
  displaySurface: 'Μετὰ',
  gloss: 'after',
  glossSource: 'package',
  morphLabels: [],
  morphExplain: {
    code: 'PREP',
    language: 'greek',
    summary: 'Preposition',
    parts: [{ label: 'preposition', meaning: 'joins a phrase to what it modifies', kind: 'pos' }],
  },
  stepMorph: null,
  nameEntity: null,
  definition: {
    firstSense: 'with, after, behind',
    full: 'a primary preposition; properly denoting accompaniment — “amid”; with the accusative, after.',
    xlit: 'meta',
    pronunciation: 'met-ah',
    source: "Strong's",
    id: 'G3326',
    deeper: null,
  },
  renderingOrbit: null,
  reverseOrbit: null,
  semanticSenses: null,
  lemmaFreq: { corpus: 469, book: 66, chapter: 2 },
  neighborhood: { before: [], after: [] },
  occurrencesInBook: [],
  marks: [],
};

const cards: Record<string, any> = {
  'n1904-ACT-24-1-1': metaCard,
  'n1904-ACT-24-1-7': archiereusCard,
  'n1904-ACT-24-1-8': ananiasCard,
  'n1904-ACT-24-1-10': presbuterosCard,
};

const greekPackage = {
  id: 'macula-greek-nestle1904',
  name: 'MACULA Greek · Nestle 1904',
  language: 'grc',
  type: 'interlinear-data',
  edition: 'Nestle 1904',
  family: 'macula-greek',
  datasetVersion: '2024.05',
  tokenCount: 137779,
  books: ['ACT'],
  path: '/Library/language/macula-greek-nestle1904',
  loaded: true,
};

if (typeof window !== 'undefined') {
  const ok = <T,>(value: T) => Promise.resolve(value);
  const w = window as any;
  w.api = {
    ...(w.api ?? {}),
    language: {
      ...((w.api ?? {}).language ?? {}),
      listPackages: () => ok([greekPackage]),
      loadPackage: (packageId: string) => ok({ ok: true, packageId, loaded: true }),
      getVerseTokens: (_p: string, book: string, chapter: number, verse: number) =>
        ok(book === 'ACT' && chapter === 24 && verse === 1 ? acts24_1 : []),
      getToken: (_p: string, tokenId: string) => ok(byId.get(tokenId) ?? null),
      getTokenCard: (_p: string, tokenId: string) => ok(cards[tokenId] ?? metaCard),
      hasReverseIndex: () => ok(true),
      getVerseMarks: () => ok([]),
      getLemmaInBook: () => ok([]),
      getSyntaxForToken: () => ok(null),
    },
  };
}

const bookNames = { ACT: ['Acts', 'Ac'], LUK: ['Luke'], MAT: ['Matthew'], MRK: ['Mark'] };

const noop = () => {};

/**
 * Preview setup, not reimplementation: the panel opens on the verse's first
 * content word, so a story that wants the reader's second pick drives the
 * section's own chip button once the strip exists.
 */
function usePickedWord(form: string) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root || !form) return;
    let settled = false;
    const attempt = () => {
      if (settled) return;
      const chip = Array.from(root.querySelectorAll('button.lang-word')).find(
        (node) => (node.querySelector('.lang-word-form')?.textContent ?? '').trim() === form,
      ) as HTMLButtonElement | undefined;
      if (!chip) return;
      settled = true;
      observer.disconnect();
      chip.click();
    };
    const observer = new MutationObserver(attempt);
    observer.observe(root, { childList: true, subtree: true });
    attempt();
    return () => observer.disconnect();
  }, [form]);
  return ref;
}

/**
 * The real shell and the real 380px study panel. Acts 24:1 is a 22-token verse,
 * so the whole panel is ~900px tall and the 900x700 capture viewport cannot
 * hold it; the panel is laid out at its true width and photographed at 0.78 so
 * the card is graded whole rather than cropped. Layout, wrapping and line
 * breaks are identical to the shipped 380px panel — only the photograph is
 * smaller. See .design-sync/learnings/word-card.md for the config fix.
 */
const SCALE = 1; // was 0.63 — cfg.overrides.LanguageWordsSection.viewport is now 900x1120, so the card no longer needs shrinking to fit the photograph
const VIEW_H = 700;

const frame = (ref: any, children: any) => (
  <div
    className="app-shell theme-porcelain"
    style={{ margin: -24, height: VIEW_H, alignItems: 'flex-start', justifyContent: 'center' }}
  >
    <div style={{ width: 380 * SCALE, height: VIEW_H, margin: '0 auto', overflow: 'hidden' }}>
      <div
        ref={ref}
        className="living-margin"
        style={{
          margin: 0,
          width: 380,
          height: VIEW_H / SCALE,
          overflow: 'hidden',
          padding: '14px 20px',
          transform: `scale(${SCALE})`,
          transformOrigin: 'top left',
        }}
      >
        {children}
      </div>
    </div>
  </div>
);

/** The word the owner works from: ἀρχιερεύς at Acts 24:1, following the reading. */
export const HighPriestAtActs24 = () => {
  const ref = usePickedWord('ἀρχιερεὺς');
  return frame(
    ref,
    <LanguageWordsSection
      sessionOwnerTabId="tab-reading"
      book="ACT"
      bookDisplayName="Acts"
      bookNames={bookNames}
      chapter={24}
      verse={1}
      readingPackageId="bsb"
      freezeOnEngage
      wordsFollowingReading
      onWordsStateChange={noop}
      onStudyEngage={noop}
      onCapture={noop}
    />,
  );
};

/**
 * Pinned: the eye-line has moved on to Acts 24:5, but the study verse is held
 * at 24:1 until the reader releases it. πρεσβύτερος is the same Greek word in
 * two Strong's entries — G4245G the office, G4245H the age.
 */
export const PinnedToStudyVerse = () => {
  const ref = usePickedWord('πρεσβυτέρων');
  return frame(
    ref,
    <LanguageWordsSection
      sessionOwnerTabId="tab-reading"
      book="ACT"
      bookDisplayName="Acts"
      bookNames={bookNames}
      chapter={24}
      verse={5}
      readingPackageId="bsb"
      freezeOnEngage
      wordsVerse={1}
      wordsFollowingReading={false}
      onWordsStateChange={noop}
      onStudyEngage={noop}
      onCapture={noop}
    />,
  );
};

/** A name in the verse: three men called Ananias in Acts, kept apart by TIPNR. */
export const NamedPersonInTheVerse = () => {
  const ref = usePickedWord('Ἀνανίας');
  return frame(
    ref,
    <LanguageWordsSection
      sessionOwnerTabId="tab-reading"
      book="ACT"
      bookDisplayName="Acts"
      bookNames={bookNames}
      chapter={24}
      verse={1}
      readingPackageId="bsb"
      wordsFollowingReading
      onWordsStateChange={noop}
      onCapture={noop}
    />,
  );
};
