import { SearchView } from 'scripture-app';

// SearchView reads window.api.library.readAllNotes() in the "notes" workspace.
//
// NOTE 2026-07-26: this preview used to pass `showAll`, which NO LONGER EXISTS.
// The component now takes a required `mode: "notes" | "search"` plus a required
// `onWrite`. Passing the retired prop meant both cells fell back to the same
// empty search state — which is exactly why validate reported "variants render
// identically". That warning was a true signal of prop drift, not a harness quirk.
const notes = [
  {
    frontmatter: { id: 'n1', title: 'Ephesus & the word of the Lord', created: '2024-03-01', modified: '2024-03-02' },
    body: 'Paul reasoned daily in the school of Tyrannus for two years.',
    scriptureRefs: [{ raw: 'Acts 19:9', bref: 'ACT.19.9' }],
  },
  {
    frontmatter: { id: 'n2', title: 'The sons of Sceva', created: '2024-02-18', modified: '2024-02-20' },
    body: 'An account of exorcists who invoked the name of Jesus without knowing him.',
    scriptureRefs: [{ raw: 'Acts 19:13-16', bref: 'ACT.19.13' }],
  },
  {
    frontmatter: { id: 'n3', title: 'Burning the books of magic', created: '2024-02-05', modified: '2024-02-05' },
    body: 'Fifty thousand pieces of silver — the price of repentance made visible.',
    scriptureRefs: [{ raw: 'Acts 19:19', bref: 'ACT.19.19' }],
  },
];

const verseHits = [
  { book: 'ACT', chapter: 19, verse: 9, bref: 'ACT.19.9', text: 'he withdrew from them and took the disciples with him, reasoning daily in the hall of Tyrannus.' },
  { book: 'ACT', chapter: 19, verse: 10, bref: 'ACT.19.10', text: 'This continued for two years, so that all the residents of Asia heard the word of the Lord.' },
  { book: 'ACT', chapter: 19, verse: 20, bref: 'ACT.19.20', text: 'So the word of the Lord continued to increase and prevail mightily.' },
];

if (typeof window !== 'undefined') {
  (window as any).api = {
    ...(window as any).api,
    library: {
      ...(((window as any).api || {}).library || {}),
      readAllNotes: async () => notes,
      search: async () => verseHits,
      searchNotes: async () => notes,
    },
  };
}

const noop = () => {};

const frame = (children: any) => (
  <div style={{ width: 360, height: 480, display: 'flex', flexDirection: 'column' }}>{children}</div>
);

/** The notes workspace — the reader's own writing, not the edition. */
export const NotesWorkspace = () => frame(<SearchView mode="notes" onNavigate={noop} onWrite={noop} />);

/** The search workspace at rest, before a phrase has been entered. */
export const SearchAtRest = () => frame(<SearchView mode="search" onNavigate={noop} onWrite={noop} />);

/** Search carrying an opening query, so the lens and the phrase are both visible. */
export const SearchWithQuery = () =>
  frame(<SearchView mode="search" onNavigate={noop} onWrite={noop} initialQuery="word of the Lord" intentNonce={1} />);
