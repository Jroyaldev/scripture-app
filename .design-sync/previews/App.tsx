import { App } from 'scripture-app';

// ---------------------------------------------------------------------------
// App takes NO props — the failure here was never prop drift. It was the stub:
// "Cannot read properties of undefined (reading 'onCloseRequested')" is
// window.api.appWindow being absent when App registers its close-request
// listener on mount. That listener's return value is a useEffect cleanup, so
// the stub has to hand back an unsubscribe function, not undefined.
//
// The stub below is the UNION of what the shell, ScripturePage and the Living
// Margin all reach for on mount — App renders the whole desk, so a gap in any
// one of them empties the root. Calls that drifted since the old preview:
//   • scripture.getCrossRefsForChapter() → getCrossRefsForPassage(book,
//     chapter, startVerse, endVerse, packageId), returning
//     CrossReferenceResultData rather than string[].
//   • library.getInfo / settings.get / appWindow.* did not exist in it at all.
// Theme, sidebar state and reading prefs all come from settings.get(), which
// is how the real shell decides them — so each story swaps the settings record
// rather than passing props App does not have.
// ---------------------------------------------------------------------------

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
};

// Acts 19:8–20, KJV.
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

const LIBRARY_PATH = '/Users/jonny/Documents/Scripture Library';

const baseSettings = {
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

// Swapped per story before render — the shell reads theme and rail state from
// settings, exactly as it does in the product.
let currentSettings: any = baseSettings;

// App holds its splash for a deliberate minimum of 2400ms
// (`const splashHold = new Promise(r => setTimeout(r, 2400))` in loadData).
// The capture harness settles on fonts and images only — it never waits that
// long — so every App cell screenshotted as "Loading library…". Collapsing
// long timers lets the shell reach its loaded state within the shot. Only
// timers of a second or more are touched, so ordinary UI timing is untouched.
if (typeof window !== 'undefined') {
  const realSetTimeout = window.setTimeout.bind(window);
  (window as any).setTimeout = (fn: any, delay?: number, ...args: any[]) =>
    realSetTimeout(fn, (delay ?? 0) >= 1000 ? 0 : delay, ...args);
}

if (typeof window !== 'undefined') {
  (window as any).api = {
    appWindow: {
      // MUST return an unsubscribe: App uses the return value as its effect
      // cleanup. Returning undefined here is the original crash.
      onCloseRequested: () => () => {},
      requestClose: () => {},
      resolveCloseRequest: () => {},
    },
    settings: {
      get: async () => currentSettings,
      set: async (partial: any) => { currentSettings = { ...currentSettings, ...partial }; return currentSettings; },
    },
    dialog: { openDirectory: async () => null },
    system: { openExternalResearchUrl: async () => ({ ok: true }) },
    library: {
      getPath: async () => LIBRARY_PATH,
      getInfo: async () => ({ path: LIBRARY_PATH, hasLibrary: true }),
      init: async () => ({ ok: true }),
      revealInFinder: async () => ({ ok: true }),
      rebuild: async () => ({ ok: true, hash: 'a19e5b2' }),
      getSummary: async () => ({ notesFound: 1, anchorsFound: 1, highlightsFound: 2, errors: [] }),
      queryRange: async () => marginData,
      queryVerse: async () => marginData,
      readAllNotes: async () => [],
      search: async () => [],
      projectConnections: async () => ({ ok: true, packageId: 'bsb', projections: [] }),
    },
    scripture: {
      getBackbone: async () => backbone,
      getBookNames: async () => bookNames,
      getChapterText: async () => ({ verses }),
      getCrossRefsForPassage: async () => crossRefs,
      search: async () => [],
    },
    ref: { resolve: async () => ({ ok: false, error: 'not resolved in preview' }) },
    ai: {
      semanticMargin: async () => null,
      pinClaim: async () => ({ ok: true }),
      getBudgetEnvelope: async () => null,
      getJobs: async () => [],
      getFacts: async () => [],
    },
    language: {
      listPackages: async () => [],
      getEntitiesForRange: async () => ({
        entities: [],
        attribution: { name: 'STEPBible TIPNR', license: 'CC BY 4.0' },
      }),
      getEntityResearch: async () => null,
      hasReverseIndex: async () => false,
      getVerseTokens: async () => null,
    },
    trustedResources: {
      query: async () => ({ ok: true, resources: [] }),
      openOfficial: async () => ({ ok: true }),
    },
  };
}

// App renders its OWN .app-shell at height:100vh. The capture viewport is
// 900x700 with 24px body padding, so that shell would overhang the card by the
// padding. This rule pins it to the frame instead — framing only; nothing
// about the shell's composition changes.
const fitShell = '.ds-app-frame > .app-shell { height: 100% !important; }';

const frame = (children: any) => (
  <>
    <style>{fitShell}</style>
    <div className="ds-app-frame" style={{ width: 852, height: 652, display: 'block', overflow: 'hidden' }}>
      {children}
    </div>
  </>
);

// NOTE ON LAYOUT: App picks its shell with
// window.matchMedia("(max-width: 979px)"), against the VIEWPORT — not against
// this frame. The capture viewport is 900px, so these cells all render the
// NARROW shell: passage register, canvas, margin stacked beneath, and the
// bottom tab bar, with no left nav rail. That is a real shipped state, but it
// means the desktop desk cannot be photographed until the card declares a
// viewport of at least 1004px. Reported in the learnings file — it is a
// config change, not something a preview can work around (a CSS transform
// would not move matchMedia, and faking matchMedia would leave the CSS media
// queries still in their narrow branch).
// The story names below describe PROP STATE, not layout, so they stay true at
// whatever width the card is eventually captured.

/** Reading Acts 19 in Porcelain with the Living Margin open. */
export const ReadingPorcelain = () => {
  currentSettings = { ...baseSettings };
  return frame(<App />);
};

/** The same reading state in Onyx, so the colours are graded in the dark too. */
export const ReadingOnyx = () => {
  currentSettings = { ...baseSettings, theme: 'onyx' };
  return frame(<App />);
};

/** Margin closed — the reading measure carrying the shell on its own. */
export const MarginClosed = () => {
  currentSettings = { ...baseSettings, marginVisible: false, sidebarCollapsed: true };
  return frame(<App />);
};
