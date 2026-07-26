import { ScripturePage } from 'scripture-app';

// ---------------------------------------------------------------------------
// Props drifted. What changed since the old preview:
//   • ScripturePage no longer owns its own passage state. It is driven by
//     `sessionEntry: PassageViewState` — { book, chapter, packageId, margin }
//     — plus `navigationHistory` and the two change callbacks. Omitting
//     sessionEntry is what threw "Cannot read properties of undefined
//     (reading 'book')".
//   • `navigateRef` gained ownerTabId / preapproved.
//   • The V2 study workspace (tabs and groups) is now REQUIRED:
//     studyWorkspace, activeWorkspaceKind, onRequestWorkspaceTransition,
//     workspacePersistenceStatus, onRetryWorkspacePersistence.
//   • The cross-reference call is getCrossRefsForPassage(book, chapter,
//     startVerse, endVerse, packageId) returning CrossReferenceResultData —
//     the old stub's getCrossRefsForChapter() returning string[] is gone.
//   • cfg.provider already wraps every preview in ToastProvider, so the old
//     hand-rolled <ToastProvider> wrapper is removed here.
// ---------------------------------------------------------------------------

// Acts has 28 chapters; Acts 19 has 41 verses.
const actChapters = [26, 47, 26, 37, 42, 15, 60, 40, 43, 48, 30, 25, 52, 28, 41, 40, 34, 28, 41, 38, 40, 30, 35, 27, 27, 32, 44, 31];
const backbone = {
  version: 'bsb',
  books: {
    ACT: { chapters: actChapters },
    MRK: { chapters: [45, 28, 35, 41, 43, 56, 37, 38, 50, 52, 33, 44, 37, 72, 47, 20] },
    HEB: { chapters: [14, 18, 19, 16, 14, 20, 28, 13, 28, 39, 40, 29, 25] },
    EPH: { chapters: [23, 22, 21, 32, 33, 24] },
  },
};

const bookNames: Record<string, string[]> = {
  ACT: ['Acts', 'Ac'],
  MRK: ['Mark', 'Mk'],
  HEB: ['Hebrews', 'Heb'],
  EPH: ['Ephesians', 'Eph'],
  LUK: ['Luke', 'Lk'],
  DEU: ['Deuteronomy', 'Dt'],
};

// Acts 19:8–20, KJV — a contiguous run, so the canvas reads as a passage
// rather than a sampler with holes in it.
const verses = [
  { verse: 8, text: 'And he went into the synagogue, and spake boldly for the space of three months, disputing and persuading the things concerning the kingdom of God.' },
  { verse: 9, text: 'But when divers were hardened, and believed not, but spake evil of that way before the multitude, he departed from them, and separated the disciples, disputing daily in the school of one Tyrannus.' },
  { verse: 10, text: 'And this continued by the space of two years; so that all they which dwelt in Asia heard the word of the Lord Jesus, both Jews and Greeks.' },
  { verse: 11, text: 'And God wrought special miracles by the hands of Paul:' },
  { verse: 12, text: 'So that from his body were brought unto the sick handkerchiefs or aprons, and the diseases departed from them, and the evil spirits went out of them.' },
  { verse: 13, text: 'Then certain of the vagabond Jews, exorcists, took upon them to call over them which had evil spirits the name of the Lord Jesus, saying, We adjure you by Jesus whom Paul preacheth.' },
  { verse: 14, text: 'And there were seven sons of one Sceva, a Jew, and chief of the priests, which did so.' },
  { verse: 15, text: 'And the evil spirit answered and said, Jesus I know, and Paul I know; but who are ye?' },
  { verse: 16, text: 'And the man in whom the evil spirit was leaped on them, and overcame them, and prevailed against them, so that they fled out of that house naked and wounded.' },
  { verse: 17, text: 'And this was known to all the Jews and Greeks also dwelling at Ephesus; and fear fell on them all, and the name of the Lord Jesus was magnified.' },
  { verse: 18, text: 'And many that believed came, and confessed, and shewed their deeds.' },
  { verse: 19, text: 'Many of them also which used curious arts brought their books together, and burned them before all men: and they counted the price of them, and found it fifty thousand pieces of silver.' },
  { verse: 20, text: 'So mightily grew the word of God and prevailed.' },
];

const notes = [
  {
    id: 'n-tyrannus',
    title: 'The school of Tyrannus',
    body_text: 'Paul leaves the synagogue after three months and reasons daily in a lecture hall instead. Two years of that, and all Asia hears the word.',
    created: '2024-02-28',
    modified: '2024-03-02',
  },
];

const marginData = {
  anchors: [
    { id: 1, entity_id: 'a1', note_id: 'n-tyrannus', book: 'ACT', chapter: 19, verse_start: 9, verse_end: 10 },
  ],
  highlights: [
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
  ],
  connections: [],
  notes,
};

const crossRefs = {
  scope: 'passage' as const,
  sourceBref: 'ACT.19.11',
  totalCount: 41,
  items: [
    {
      sourceId: 'openbible-crossrefs', sourceName: 'OpenBible Cross References',
      targetKey: 'ACT.5.15', targetBref: 'ACT.5.15', targetDisplay: 'Acts 5:15',
      score: 0.94, rankScore: 0.94, supportingSourceCount: 4, supportingSourceBrefs: [],
      relationshipKinds: ['parallel' as const],
      preview: 'Insomuch that they brought forth the sick into the streets, and laid them on beds and couches, that at the least the shadow of Peter passing by might overshadow some of them.',
    },
    {
      sourceId: 'openbible-crossrefs', sourceName: 'OpenBible Cross References',
      targetKey: 'MRK.16.20', targetBref: 'MRK.16.20', targetDisplay: 'Mark 16:20',
      score: 0.88, rankScore: 0.88, supportingSourceCount: 3, supportingSourceBrefs: [],
      relationshipKinds: ['theme' as const],
      preview: 'And they went forth, and preached every where, the Lord working with them, and confirming the word with signs following.',
    },
    {
      sourceId: 'openbible-crossrefs', sourceName: 'OpenBible Cross References',
      targetKey: 'HEB.2.4', targetBref: 'HEB.2.4', targetDisplay: 'Hebrews 2:4',
      score: 0.79, rankScore: 0.79, supportingSourceCount: 2, supportingSourceBrefs: [],
      relationshipKinds: ['theme' as const],
      preview: 'God also bearing them witness, both with signs and wonders, and with divers miracles, and gifts of the Holy Ghost, according to his own will.',
    },
  ],
  attribution: {
    id: 'openbible-crossrefs',
    name: 'OpenBible Cross References',
    sourceUrl: 'https://www.openbible.info/labs/cross-references/',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    attribution: 'OpenBible.info Cross References',
    snapshotDate: '2024-11-02',
  },
};

const settings = {
  theme: 'porcelain',
  material: 'solid',
  markingSurface: 'palette',
  sidebarCollapsed: false,
  marginVisible: true,
  readingSize: 'm',
  verseNumbers: 'faint',
  recentPassages: [
    { book: 'ACT', chapter: 19, packageId: 'bsb', visitedAt: 1709300000000 },
    { book: 'EPH', chapter: 1, packageId: 'bsb', visitedAt: 1709200000000 },
  ],
  lastRead: { book: 'ACT', chapter: 19, packageId: 'bsb' },
  studyWorkspace: null,
};

// ScripturePage calls all of these in mount effects — stub BEFORE render.
if (typeof window !== 'undefined') {
  const api = ((window as any).api ||= {});
  api.scripture = {
    ...api.scripture,
    getBackbone: async () => backbone,
    getBookNames: async () => bookNames,
    getChapterText: async () => ({ verses }),
    getCrossRefsForPassage: async () => crossRefs,
    search: async () => [],
  };
  api.library = {
    ...api.library,
    queryRange: async () => marginData,
    queryVerse: async () => marginData,
    readAllNotes: async () => [],
    projectConnections: async () => ({ ok: true, packageId: 'bsb', projections: [] }),
  };
  api.ai = { ...api.ai, semanticMargin: async () => null, pinClaim: async () => ({ ok: true }) };
  api.settings = {
    ...api.settings,
    get: async () => settings,
    set: async () => settings,
  };
  api.language = {
    ...api.language,
    listPackages: async () => [],
    getEntitiesForRange: async () => ({
      entities: [],
      attribution: { name: 'STEPBible TIPNR', license: 'CC BY 4.0' },
    }),
    getEntityResearch: async () => null,
    hasReverseIndex: async () => false,
    getVerseTokens: async () => null,
  };
  api.trustedResources = {
    ...api.trustedResources,
    query: async () => ({ ok: true, resources: [] }),
    openOfficial: async () => ({ ok: true }),
  };
  api.ref = {
    ...api.ref,
    resolve: async () => ({ ok: false, error: 'not resolved in preview' }),
  };
}

const noop = () => {};
const asyncTrue = async () => true;

const sessionEntry = {
  book: 'ACT',
  chapter: 19,
  packageId: 'bsb',
  margin: {
    activeTab: 'overview',
    scope: null,
    scrollTopByTab: {},
    wordsFollowingReading: true,
  },
};

// Mirrors createStudyWorkspace(): one group holding one passage tab.
const studyWorkspace = {
  version: 2,
  groups: [{
    id: 'group-1',
    homePassageTabId: 'passage-1',
    tabIds: ['passage-1'],
    lastActiveTabId: 'passage-1',
    collapsed: false,
    label: { kind: 'automatic' },
  }],
  tabsById: {
    'passage-1': {
      kind: 'passage',
      id: 'passage-1',
      groupId: 'group-1',
      session: { current: sessionEntry, history: { back: [], forward: [] } },
    },
  },
  activeTabId: 'passage-1',
  activationOrder: ['passage-1'],
  recentlyClosed: [],
};

const base = {
  backbone,
  bookNames,
  navigateRef: null,
  sessionOwnerTabId: 'passage-1',
  sessionEntry,
  navigationHistory: { back: [], forward: [] },
  onNavigationHistoryChange: noop,
  onSessionEntryChange: noop,
  onCreateNote: noop,
  studyWorkspace,
  activeWorkspaceKind: 'passage' as const,
  onRequestWorkspaceTransition: async (_reason: string, commit: () => void | Promise<void>) => {
    await commit();
    return true;
  },
  workspacePersistenceStatus: { phase: 'idle' as const, acknowledgedRevision: 1, pendingRevision: null },
  onRetryWorkspacePersistence: asyncTrue,
  readingSize: 'm' as const,
  verseNumbers: 'faint' as const,
  material: 'solid' as const,
  markingSurface: 'palette' as const,
};

// The capture viewport is 900x700 with 24px of body padding, so 852x652 is the
// largest frame that is not cropped. (A declared card viewport would let this
// surface be shot at true desk width — reported in the learnings file.)
const frame = (children: any, theme = 'theme-porcelain') => (
  <div className={`app-shell ${theme}`} style={{ width: 852, height: 652, display: 'flex', overflow: 'hidden' }}>
    {children}
  </div>
);

// NOTE ON LAYOUT: the shell picks its arrangement from
// window.matchMedia("(max-width: 979px)") against the VIEWPORT, which the
// capture fixes at 900px. So the Living Margin stacks BENEATH the canvas in
// these cells rather than sitting beside it at 380px. That is the real narrow
// shell, not a broken render — but the side-by-side desk needs the card to
// declare a viewport of at least 1004px. Reported in the learnings file.

/** Reading canvas with the Living Margin open. */
export const ReadingWithMargin = () =>
  frame(<ScripturePage {...base} marginVisible theme="porcelain" />);

/** Margin closed — the reading measure alone, which is what the canvas has to
 *  hold up on its own. */
export const MarginClosed = () =>
  frame(<ScripturePage {...base} marginVisible={false} theme="porcelain" />);

/** Focus mode: the same passage with the chrome stood down. */
export const FocusMode = () =>
  frame(<ScripturePage {...base} marginVisible={false} focusMode theme="porcelain" />);

/** The Onyx atmosphere, so the reading colours are graded in the dark too. */
export const OnyxAtmosphere = () =>
  frame(<ScripturePage {...base} marginVisible theme="onyx" />, 'theme-onyx dark');
