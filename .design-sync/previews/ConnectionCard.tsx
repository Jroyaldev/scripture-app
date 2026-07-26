import { ConnectionCard } from 'scripture-app';

const bookNames = { ACT: ['Acts', 'Ac'], JHN: ['John'], LUK: ['Luke'] };

const noop = () => {};
/** In a preview every mutation is a no-op that resolves as a clean commit. */
const settled = async () => 'complete' as const;

const exact = (verse: number, positions: number[]) => ({
  format_version: 1,
  layer: 'backbone-token:v1',
  occurrences: positions.map((position) => ({ verse, position })),
});

/**
 * Acts 19:2 / 19:6 — the Spirit asked after, then given. Two phrases, one
 * parallel, exactly as the library holds it.
 */
const parallel = {
  id: 'cx-acts19-spirit',
  format_version: 2,
  kind: 'link:parallel',
  label: 'Parallelism · Acts 19:2 / Acts 19:6',
  observation:
    'The question of verse 2 is answered in verse 6 — not by argument but by event. Luke lets the narrative do the arguing.',
  anchors: [
    { book: 'ACT', chapter: 19, verse_start: 2, verse_end: 2, exact: exact(2, [4, 5, 6, 7, 8, 9]) },
    { book: 'ACT', chapter: 19, verse_start: 6, verse_end: 6, exact: exact(6, [7, 8, 9, 10, 11]) },
  ],
  activeEventId: 'evt-9f21c4',
  createdAt: '2024-04-02T09:12:00.000Z',
  updatedAt: '2024-05-14T16:38:00.000Z',
};

const parallelPaint = [
  {
    book: 'ACT',
    chapter: 19,
    verse_start: 2,
    verse_end: 2,
    fragments: [{ verse: 2, char_start: 0, char_end: 52, quote: 'Did you receive the Holy Spirit when you believed?' }],
  },
  {
    book: 'ACT',
    chapter: 19,
    verse_start: 6,
    verse_end: 6,
    fragments: [{ verse: 6, char_start: 24, char_end: 60, quote: 'the Holy Spirit came upon them' }],
  },
];

/** Luke's growth refrain: 6:7, 12:24, 19:20 — a series held across the book. */
const series = {
  id: 'cx-acts-word-grew',
  format_version: 2,
  kind: 'series',
  label: 'Series · The word of God kept spreading',
  observation:
    'Luke closes each panel of Acts the same way. The refrain is the outline: whatever the chapter narrates, the word is what grows.',
  anchors: [
    { book: 'ACT', chapter: 6, verse_start: 7, verse_end: 7, exact: exact(7, [1, 2, 3, 4, 5]) },
    { book: 'ACT', chapter: 12, verse_start: 24, verse_end: 24, exact: exact(24, [2, 3, 4, 5, 6, 7]) },
    { book: 'ACT', chapter: 19, verse_start: 20, verse_end: 20, exact: exact(20, [2, 3, 4, 5, 6, 7, 8, 9]) },
  ],
  activeEventId: 'evt-3b07ae',
  createdAt: '2024-03-18T11:04:00.000Z',
  updatedAt: '2024-05-15T08:20:00.000Z',
};

const seriesPaint = [
  {
    book: 'ACT',
    chapter: 6,
    verse_start: 7,
    verse_end: 7,
    fragments: [{ verse: 7, char_start: 0, char_end: 26, quote: 'the word of God spread' }],
  },
  {
    book: 'ACT',
    chapter: 12,
    verse_start: 24,
    verse_end: 24,
    fragments: [{ verse: 24, char_start: 4, char_end: 52, quote: 'the word of God continued to spread and multiply' }],
  },
  {
    book: 'ACT',
    chapter: 19,
    verse_start: 20,
    verse_end: 20,
    fragments: [{ verse: 20, char_start: 3, char_end: 66, quote: 'the word of the Lord powerfully continued to spread and prevail' }],
  },
];

/**
 * The same Acts 19 parallel as the library first wrote it: passage anchors
 * with no exact selector. It stays readable and stays uneditable.
 */
const legacy = {
  id: 'cx-acts19-spirit-v1',
  format_version: 1,
  kind: 'link:parallel',
  label: 'Parallelism · Acts 19:2 / Acts 19:6',
  anchors: [
    { book: 'ACT', chapter: 19, verse_start: 2, verse_end: 2 },
    { book: 'ACT', chapter: 19, verse_start: 6, verse_end: 6 },
  ],
  activeEventId: 'evt-1104fa',
  createdAt: '2023-11-09T14:47:00.000Z',
  updatedAt: '2023-11-09T14:47:00.000Z',
};

const handlers = {
  bookNames,
  packageId: 'bsb',
  onDismiss: noop,
  onClose: noop,
  onJump: noop,
  onNote: noop,
  onExtend: noop,
  onUpdate: settled,
  onDelete: settled,
  onRefresh: noop,
  recovery: null,
  onRecoveryChange: noop,
  onMutationStateChange: noop,
  onExitControllerChange: noop,
};

/** The real shell, the real 380px study panel, edge to edge. */
const frame = (children: any) => (
  <div
    className="app-shell theme-porcelain"
    style={{ margin: -24, height: 700, alignItems: 'flex-start', justifyContent: 'center' }}
  >
    <div
      className="living-margin"
      style={{ margin: '0 auto', width: 380, height: 700, overflow: 'auto', padding: '16px 20px' }}
    >
      {children}
    </div>
  </div>
);

/** Two phrases, held on the chapter they both live in. */
export const ParallelismInActs19 = () =>
  frame(
    <ConnectionCard
      {...(handlers as any)}
      connection={parallel as any}
      paintAnchors={parallelPaint as any}
      book="ACT"
      chapter={19}
      otherHeldCount={0}
    />,
  );

/** Three phrases across the book, with two more connections still held. */
export const SeriesAcrossActs = () =>
  frame(
    <ConnectionCard
      {...(handlers as any)}
      connection={series as any}
      paintAnchors={seriesPaint as any}
      book="ACT"
      chapter={19}
      otherHeldCount={2}
    />,
  );

/** A pre-exact-anchor record: readable, but not editable until it is replaced. */
export const LegacyPassageConnection = () =>
  frame(
    <ConnectionCard
      {...(handlers as any)}
      connection={legacy as any}
      paintAnchors={parallelPaint as any}
      book="ACT"
      chapter={19}
      otherHeldCount={0}
    />,
  );
