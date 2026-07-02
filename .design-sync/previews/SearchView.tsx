import { SearchView } from 'scripture-app';

// SearchView reads window.api.library.readAllNotes() when showAll is set.
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

if (typeof window !== 'undefined') {
  (window as any).api = {
    ...(window as any).api,
    library: {
      ...(((window as any).api || {}).library || {}),
      readAllNotes: async () => notes,
      search: async () => [],
    },
  };
}

const noop = () => {};

export const AllNotes = () => (
  <div style={{ width: 360, height: 480, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border-subtle)' }}>
    <SearchView onNavigate={noop} showAll />
  </div>
);

export const SearchBox = () => (
  <div style={{ width: 360, height: 480, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border-subtle)' }}>
    <SearchView onNavigate={noop} />
  </div>
);
