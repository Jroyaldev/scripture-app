import { LivingMargin } from 'scripture-app';

// ---------------------------------------------------------------------------
// Props drifted hard. What changed since the old preview:
//   • crossRefs is CrossReferenceResultData | null — an object with .items and
//     a licensed .attribution — NOT string[]. The old `['John 14:12', …]` was
//     the wrong type outright.
//   • packageId, sessionOwnerTabId, sessionRestoreNonce, marginSession and
//     onMarginSessionChange are all REQUIRED now. Omitting marginSession is
//     what threw "Cannot read properties of undefined (reading 'activeTab')".
//   • marginData is a full QueryResult — it carries `connections` as well as
//     anchors/highlights/notes.
//   • marginData.anchors is load-bearing: studyNoteEntries() joins notes to
//     verses THROUGH the anchors, so a note with no anchor never renders. The
//     old preview passed anchors: [] and could never have shown a note.
// The panel has three scope states, selected by pinnedRange / nearVerse:
// chapter (neither), ambient reading (nearVerse), and selection (pinnedRange).
// ---------------------------------------------------------------------------

const bookNames = {
  ACT: ['Acts', 'Ac'],
  MRK: ['Mark', 'Mk'],
  HEB: ['Hebrews', 'Heb'],
  DEU: ['Deuteronomy', 'Dt'],
  EPH: ['Ephesians', 'Eph'],
  LUK: ['Luke', 'Lk'],
};

const noop = () => {};
const asyncTrue = async () => true;

// Real licensing rows, verbatim from the shipped datasets.
const OPENBIBLE = {
  id: 'openbible-crossrefs',
  name: 'OpenBible Cross References',
  sourceUrl: 'https://www.openbible.info/labs/cross-references/',
  license: 'CC BY 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  attribution: 'OpenBible.info Cross References',
  snapshotDate: '2024-11-02',
};

const xref = (
  bref: string,
  display: string,
  preview: string,
  kinds: Array<'quotation' | 'parallel' | 'theme' | 'prophecy'>,
  score: number,
  supporting: number,
) => ({
  sourceId: 'openbible-crossrefs',
  sourceName: 'OpenBible Cross References',
  targetKey: bref,
  targetBref: bref,
  targetDisplay: display,
  score,
  rankScore: score,
  supportingSourceCount: supporting,
  supportingSourceBrefs: [],
  relationshipKinds: kinds,
  preview,
});

// Genuine cross-references for the "special miracles by the hands of Paul"
// passage, Acts 19:11–12.
const miracleCrossRefs = {
  scope: 'passage' as const,
  sourceBref: 'ACT.19.11',
  totalCount: 41,
  items: [
    xref(
      'ACT.5.15',
      'Acts 5:15',
      'Insomuch that they brought forth the sick into the streets, and laid them on beds and couches, that at the least the shadow of Peter passing by might overshadow some of them.',
      ['parallel'],
      0.94,
      4,
    ),
    xref(
      'MRK.16.20',
      'Mark 16:20',
      'And they went forth, and preached every where, the Lord working with them, and confirming the word with signs following.',
      ['theme'],
      0.88,
      3,
    ),
    xref(
      'ACT.14.3',
      'Acts 14:3',
      'Long time therefore abode they speaking boldly in the Lord, which gave testimony unto the word of his grace, and granted signs and wonders to be done by their hands.',
      ['parallel'],
      0.86,
      3,
    ),
    xref(
      'HEB.2.4',
      'Hebrews 2:4',
      'God also bearing them witness, both with signs and wonders, and with divers miracles, and gifts of the Holy Ghost, according to his own will.',
      ['theme'],
      0.79,
      2,
    ),
  ],
  attribution: OPENBIBLE,
};

// Acts 24:1 — Ananias comes down with the elders and the orator Tertullus.
const trialCrossRefs = {
  scope: 'verse' as const,
  sourceBref: 'ACT.24.1',
  totalCount: 12,
  items: [
    xref(
      'ACT.23.2',
      'Acts 23:2',
      'And the high priest Ananias commanded them that stood by him to smite him on the mouth.',
      ['parallel'],
      0.96,
      4,
    ),
    xref(
      'ACT.25.2',
      'Acts 25:2',
      'Then the high priest and the chief of the Jews informed him against Paul, and besought him.',
      ['parallel'],
      0.9,
      3,
    ),
    xref(
      'LUK.23.1',
      'Luke 23:1',
      'And the whole multitude of them arose, and led him unto Pilate.',
      ['theme'],
      0.72,
      2,
    ),
  ],
  attribution: OPENBIBLE,
};

const notes = [
  {
    id: 'n-tyrannus',
    title: 'The school of Tyrannus',
    body_text:
      'Paul leaves the synagogue after three months and reasons daily in a lecture hall instead. Two years of that, and all Asia hears the word — not because he travelled the province, but because Ephesus was what the province passed through.',
    created: '2024-02-28',
    modified: '2024-03-02',
  },
  {
    id: 'n-books',
    title: 'Fifty thousand pieces of silver',
    body_text:
      'They burned the books rather than sell them. Repentance that costs nothing leaves the inventory intact — this one is measured in silver, in public, in front of the people who had bought from them.',
    created: '2024-02-20',
    modified: '2024-02-21',
  },
];

const anchors = [
  { id: 1, entity_id: 'a1', note_id: 'n-tyrannus', book: 'ACT', chapter: 19, verse_start: 9, verse_end: 10 },
  { id: 2, entity_id: 'a2', note_id: 'n-books', book: 'ACT', chapter: 19, verse_start: 19, verse_end: 19 },
];

const highlights = [
  {
    id: 'h1', book: 'ACT', chapter: 19, verse_start: 11, verse_end: 12,
    package: 'bsb', char_start: null, char_end: null,
    color: 'yellow', kind: 'visual', note_id: null, deleted: 0,
  },
  {
    id: 'h2', book: 'ACT', chapter: 19, verse_start: 19, verse_end: 19,
    package: 'bsb', char_start: null, char_end: null,
    color: 'green', kind: 'visual', note_id: null, deleted: 0,
  },
];

// Legacy-shape (v1) passage anchors — the reader-facing list only needs
// book/chapter/verse identity, and canonicalConnectionAnchors accepts both.
const connections = [
  {
    id: 'c-word-grew',
    format_version: 1,
    kind: 'link:echo',
    label: 'So mightily grew the word',
    observation:
      'Luke closes each Ephesian movement the same way — the word grows, and he says so in the same breath as the cost that bought it.',
    anchors: [
      { book: 'ACT', chapter: 19, verse_start: 20, verse_end: 20 },
      { book: 'ACT', chapter: 6, verse_start: 7, verse_end: 7 },
      { book: 'ACT', chapter: 12, verse_start: 24, verse_end: 24 },
    ],
    activeEventId: 'evt-01HQ2',
    createdAt: '2024-02-19',
    updatedAt: '2024-03-01',
  },
  {
    id: 'c-magic',
    format_version: 1,
    kind: 'link:contrast',
    label: 'Curious arts against the word',
    observation: 'The books go into the fire in the verse before the word is said to prevail.',
    anchors: [
      { book: 'ACT', chapter: 19, verse_start: 19, verse_end: 19 },
      { book: 'DEU', chapter: 18, verse_start: 10, verse_end: 12 },
    ],
    activeEventId: 'evt-01HQ7',
    createdAt: '2024-02-22',
    updatedAt: '2024-02-22',
  },
];

// Index-aligned with each connection's AUTHORED anchor array (the panel looks
// up paintAnchors[authored.indexOf(anchor)]), so a member can quote its own
// wording instead of falling back to "Not in this translation".
const paint = (connectionId: string, eventId: string, quotes: Array<[string, number, number, string]>) => ({
  connectionId,
  sourceActiveEventId: eventId,
  packageId: 'bsb',
  status: 'exact' as const,
  anchors: quotes.map(([book, chapter, verse, quote]) => ({
    book,
    chapter,
    verse_start: verse,
    verse_end: verse,
    fragments: [{ verse, char_start: 0, char_end: quote.length, quote }],
  })),
});

const connectionPaintProjections = new Map<string, any>([
  ['c-word-grew', paint('c-word-grew', 'evt-01HQ2', [
    ['ACT', 19, 20, 'So mightily grew the word of God and prevailed'],
    ['ACT', 6, 7, 'And the word of God increased'],
    ['ACT', 12, 24, 'But the word of God grew and multiplied'],
  ])],
  ['c-magic', paint('c-magic', 'evt-01HQ7', [
    ['ACT', 19, 19, 'brought their books together, and burned them before all men'],
    ['DEU', 18, 10, 'There shall not be found among you any one that useth divination'],
  ])],
]);

// Real KJV text for the Acts 19 verses these cards touch. This is NOT
// decorative: contextEndVerse falls back to max(chapterVerseText.keys()), so
// WITHOUT this prop the chapter scope collapses to verse 1 and every authored
// connection is reported as "Elsewhere in this chapter".
const acts19Text = new Map<number, string>([
  [8, 'And he went into the synagogue, and spake boldly for the space of three months, disputing and persuading the things concerning the kingdom of God.'],
  [9, 'But when divers were hardened, and believed not, but spake evil of that way before the multitude, he departed from them, and separated the disciples, disputing daily in the school of one Tyrannus.'],
  [10, 'And this continued by the space of two years; so that all they which dwelt in Asia heard the word of the Lord Jesus, both Jews and Greeks.'],
  [11, 'And God wrought special miracles by the hands of Paul:'],
  [12, 'So that from his body were brought unto the sick handkerchiefs or aprons, and the diseases departed from them, and the evil spirits went out of them.'],
  [19, 'Many of them also which used curious arts brought their books together, and burned them before all men: and they counted the price of them, and found it fifty thousand pieces of silver.'],
  [20, 'So mightily grew the word of God and prevailed.'],
  [41, 'And when he had thus spoken, he dismissed the assembly.'],
]);

const acts24Text = new Map<number, string>([
  [1, 'And after five days Ananias the high priest descended with the elders, and with a certain orator named Tertullus, who informed the governor against Paul.'],
]);

const marginData = { anchors, highlights, connections, notes };
const emptyMarginData = { anchors: [], highlights: [], connections: [], notes: [] };

const semanticData = {
  semanticNotes: [
    {
      noteId: 'n-books',
      title: 'Fifty thousand pieces of silver',
      snippet: 'Repentance that costs nothing leaves the inventory intact.',
      similarity: 0.82,
    },
  ],
  threads: [
    {
      id: 'th-repentance',
      label: 'Repentance made visible',
      noteIds: ['n-books'],
      summary: 'Believers burned their books of magic — repentance with a public price.',
      extractor: 'ai',
      created: '2024-03-01',
    },
    {
      id: 'th-word-grows',
      label: 'The word grows',
      noteIds: ['n-tyrannus'],
      summary: "Luke's recurring summary line for the progress of the gospel.",
      extractor: 'ai',
      created: '2024-03-01',
    },
  ],
  claims: [
    {
      id: 'cl-books',
      assertion: 'Ephesian believers publicly burned occult texts valued at fifty thousand pieces of silver',
      claimType: 'historical',
      confidence: 0.91,
      extractor: 'ai',
      created: '2024-03-01',
      status: 'active',
      anchors: [{ book: 'ACT', chapter: 19, verse: 19 }],
      sources: [],
    },
  ],
  overlays: [],
  suggestedCrossRefs: [
    {
      targetBref: 'DEU.18.10',
      targetDisplay: 'Deuteronomy 18:10',
      reason: 'The prohibition of sorcery the burned books stood under',
      confidence: 0.77,
    },
  ],
};

// Real STEPBible TIPNR records, with their real reference counts.
const trialEntities = {
  entities: [
    {
      id: 'Ananias@Act.23.2-=G0367I',
      kind: 'person' as const,
      displayName: 'Ananias',
      brief: "High priest during Paul's trial",
      short: "Ananias, the high priest, presided over Paul's trial and ordered him to be struck on the mouth for his defense.",
      uStrong: 'G0367I',
      baseStrong: 'G367',
      firstRef: 'ACT.23.2',
      refs: ['ACT.23.2', 'ACT.24.1'],
      refCount: 2,
      gender: 'Male',
    },
  ],
  attribution: { name: 'STEPBible TIPNR', license: 'CC BY 4.0' },
  licensed: {
    siglum: 'TIPNR',
    name: 'STEPBible TIPNR',
    license: 'CC BY 4.0',
    href: 'https://github.com/STEPBible/STEPBible-Data',
  },
};

const noEntities = {
  entities: [],
  attribution: { name: 'STEPBible TIPNR', license: 'CC BY 4.0' },
};

// LivingMargin calls these in effects on mount — stub BEFORE render.
// `entitiesFor` is swapped per story so one card can show the identity block
// and another can honestly show it absent.
let entitiesFor: any = noEntities;

if (typeof window !== 'undefined') {
  const api = ((window as any).api ||= {});
  api.language = {
    ...api.language,
    getEntitiesForRange: async () => entitiesFor,
    getEntityResearch: async () => null,
  };
  api.library = {
    ...api.library,
    readAllNotes: async () => [],
  };
  api.ai = { ...api.ai, semanticMargin: async () => null };
  api.trustedResources = {
    ...api.trustedResources,
    query: async () => ({ ok: true, resources: [] }),
    openOfficial: async () => ({ ok: true }),
  };
  api.system = { ...api.system, openExternalResearchUrl: async () => ({ ok: true }) };
}

const session = (activeTab: string, scope: any = null) => ({
  activeTab,
  scope,
  scrollTopByTab: {},
  wordsFollowingReading: true,
});

// The Living Margin panel is 380px wide in the real app. The app-shell /
// theme-porcelain ancestors are what the panel's own descendant selectors and
// theme tokens expect. The frame paints paper rather than shell ground because
// in the real shell this panel is full height; a short card would otherwise
// end in a stray band of canvas that reads as a broken render.
const frame = (children: any) => (
  <div
    className="app-shell theme-porcelain"
    style={{
      width: 380,
      height: 620,
      display: 'flex',
      overflow: 'hidden',
      background: 'var(--bg-reading)',
    }}
  >
    {children}
  </div>
);

const base = {
  book: 'ACT',
  chapter: 19,
  packageId: 'bsb',
  bookNames,
  chapterVerseText: acts19Text,
  sessionOwnerTabId: 'passage-1',
  sessionRestoreNonce: 0,
  onMarginSessionChange: noop,
  onNavigateToRef: noop,
  onCreateNote: noop,
  onStudyVerse: noop,
  onOpenPassageTab: asyncTrue,
  onKeepReference: noop,
  onClearSelection: noop,
  onRemoveHighlights: noop,
};

/** Chapter scope — no selection, no eye-line verse. The edition's own
 *  cross-references lead; the reader's notes sit under their own head. */
export const ChapterOverview = () => {
  entitiesFor = noEntities;
  return frame(
    <LivingMargin
      {...base}
      marginData={marginData}
      crossRefs={miracleCrossRefs}
      semanticData={semanticData as any}
      marginSession={session('overview') as any}
    />
  );
};

/** The reader's own notes for Acts 19, joined to their verses through
 *  marginData.anchors. */
export const ChapterNotes = () => {
  entitiesFor = noEntities;
  return frame(
    <LivingMargin
      {...base}
      marginData={marginData}
      crossRefs={miracleCrossRefs}
      semanticData={semanticData as any}
      marginSession={session('notes') as any}
    />
  );
};

/** Authored relationships — the reader's hand, kept apart from the edition's
 *  cross-references. */
export const ChapterConnections = () => {
  entitiesFor = noEntities;
  return frame(
    <LivingMargin
      {...base}
      marginData={marginData}
      crossRefs={miracleCrossRefs}
      authoredConnections={connections as any}
      connectionPaintProjections={connectionPaintProjections}
      marginSession={session('connections') as any}
    />
  );
};

/** Selection scope: verses 11–12 pinned on the canvas. */
export const SelectionOverview = () => {
  entitiesFor = noEntities;
  return frame(
    <LivingMargin
      {...base}
      marginData={marginData}
      crossRefs={miracleCrossRefs}
      semanticData={semanticData as any}
      pinnedRange={{ start: 11, end: 12 }}
      marginSession={session('overview', { kind: 'selection', start: 11, end: 12 }) as any}
      onPinClaim={asyncTrue}
    />
  );
};

/** Acts 24:1 — the identity block, carrying a real TIPNR record and its
 *  licence. Ananias appears in exactly two verses in the whole Bible. */
export const TrialIdentity = () => {
  entitiesFor = trialEntities;
  return frame(
    <LivingMargin
      {...base}
      chapter={24}
      chapterVerseText={acts24Text}
      marginData={emptyMarginData}
      crossRefs={trialCrossRefs}
      nearVerse={1}
      marginSession={session('overview') as any}
    />
  );
};

/** Nothing gathered yet — empty is never blank. */
export const EmptyChapter = () => {
  entitiesFor = noEntities;
  return frame(
    <LivingMargin
      {...base}
      marginData={emptyMarginData}
      crossRefs={null}
      marginSession={session('notes') as any}
    />
  );
};
