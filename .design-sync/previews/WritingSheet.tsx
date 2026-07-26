import { WritingSheet } from 'scripture-app';

// Props drifted: WritingSheet is now a CONTROLLED editor. The old preview
// passed `prefillBody`; the sheet now takes `draft: { title, body }` plus
// `onDraftChange`, because App owns the draft so moving between Read, Notes
// and Search cannot silently discard it. Passing no draft is what threw
// "Cannot read properties of undefined (reading 'body')" — draft.body is read
// on the first render for the character/word count.

// window.api is only touched on explicit save / echo enrichment, never on
// mount. Stubbed anyway so a clicked Save in the live card fails politely
// instead of throwing.
if (typeof window !== 'undefined') {
  const api = ((window as any).api ||= {});
  api.library = {
    ...api.library,
    createNote: async () => ({ ok: true, noteId: 'n-acts-19-10' }),
  };
  api.ai = {
    ...api.ai,
    enrichNote: async () => ({ ok: true, enriched: false, noScriptureIntent: true, suggestions: [] }),
    enrichmentFeedback: async () => ({ ok: true }),
    unanchorRef: async () => ({ ok: true }),
  };
}

const noop = () => {};

const frame = (children: any) => (
  <div className="app-shell theme-porcelain" style={{ width: 720, height: 560, display: 'block', overflow: 'auto' }}>
    <div style={{ width: '100%', height: 560, display: 'flex', flexDirection: 'column' }}>{children}</div>
  </div>
);

export const BlankSheet = () =>
  frame(
    <WritingSheet
      draft={{ title: '', body: '' }}
      onDraftChange={noop}
      onSaved={noop}
    />
  );

export const EphesusDraft = () =>
  frame(
    <WritingSheet
      draft={{
        title: 'Two years in the school of Tyrannus',
        body:
          '> "And this continued by the space of two years; so that all they which dwelt in Asia heard the word of the Lord Jesus, both Jews and Greeks." — Acts 19:10\n\n' +
          'Paul leaves the synagogue after three months of open argument and takes a lecture hall instead. The whole province hears the word — not because he travelled it, but because Ephesus was the place everything in Asia passed through.\n\n' +
          'The daily reasoning is the method. Two years of it is the cost.',
      }}
      onDraftChange={noop}
      onSaved={noop}
    />
  );

export const HighPriestWordStudy = () =>
  frame(
    <WritingSheet
      draft={{
        title: 'ἀρχιερεύς at Acts 24:1 — the office, not the man',
        body:
          'Acts 24:1 — "And after five days Ananias the high priest descended with the elders, and with a certain orator named Tertullus."\n\n' +
          'ἀρχιερεύς / archiereus, Mounce: "a high-priest, chief-priest". 122 occurrences in the New Testament, 22 of them in Acts alone.\n\n' +
          'The elders beside him are πρεσβύτερος / presbuteros — and the lexicon splits that word by sense, not by spelling: "elder: Elder" is the office, "elder: old" is the age. Luke means the office here. Same Greek, two entries.\n\n' +
          'ῥήτωρ / rhētōr, the hired orator, occurs exactly once in the whole New Testament.',
      }}
      onDraftChange={noop}
      onSaved={noop}
    />
  );
