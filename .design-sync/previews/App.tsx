import { App } from 'scripture-app';

// App is the full shell: it loads backbone/bookNames/path, then renders the
// sidebar nav + the active view (ScripturePage by default). Stub the union of
// window.api calls the shell + default view make on mount.
const actChapters = [26, 47, 26, 37, 42, 15, 60, 40, 43, 48, 30, 25, 52, 28, 41, 40, 34, 28, 41, 38, 40, 30, 35, 27, 27, 32, 44, 31];
const backbone = { version: 'web', books: { ACT: { chapters: actChapters } } };
const bookNames: Record<string, string[]> = { ACT: ['Acts', 'Ac'], GEN: ['Genesis'], PSA: ['Psalms'], JHN: ['John'], ROM: ['Romans'] };

const verses = [
  { verse: 8, text: 'And he went into the synagogue, and spake boldly for the space of three months, disputing and persuading the things concerning the kingdom of God.' },
  { verse: 9, text: 'But when divers were hardened, and believed not, but spake evil of that way before the multitude, he departed from them, and separated the disciples, disputing daily in the school of one Tyrannus.' },
  { verse: 10, text: 'And this continued by the space of two years; so that all they which dwelt in Asia heard the word of the Lord Jesus, both Jews and Greeks.' },
  { verse: 11, text: 'And God wrought special miracles by the hands of Paul:' },
  { verse: 12, text: 'So that from his body were brought unto the sick handkerchiefs or aprons, and the diseases departed from them.' },
];

const marginData = {
  anchors: [],
  highlights: [{ id: 'h1', book: 'ACT', chapter: 19, verse_start: 11, verse_end: 12, color: 'yellow', deleted: 0 }],
  notes: [{ id: 'n1', title: 'The school of Tyrannus', body_text: 'Paul reasoned daily for two years, so that all Asia heard the word.' }],
};

if (typeof window !== 'undefined') {
  const ok = <T,>(value: T) => Promise.resolve(value);
  (window as any).api = {
    scripture: {
      getBackbone: () => ok(backbone),
      getBookNames: () => ok(bookNames),
      getChapterText: () => ok({ verses }),
      getCrossRefsForChapter: () => ok(['John 14:12', '1 Corinthians 2:4', 'Mark 16:20']),
    },
    library: {
      getPath: () => ok('/Users/jonny/Documents/Scripture Library'),
      queryRange: () => ok(marginData),
    },
    ai: {
      semanticMargin: () => ok(null),
    },
  };
}

export const FullShell = () => (
  <div style={{ height: 720, display: 'flex' }}>
    <App />
  </div>
);
