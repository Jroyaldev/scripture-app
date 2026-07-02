import { LivingMargin } from 'scripture-app';

const bookNames = { ACT: ['Acts', 'Ac'] };

const noop = () => {};

const emptyMargin = { anchors: [], highlights: [], notes: [] };

const richMargin = {
  anchors: [],
  highlights: [
    { id: 'h1', book: 'ACT', chapter: 19, verse_start: 11, verse_end: 12, color: 'yellow', deleted: 0 },
    { id: 'h2', book: 'ACT', chapter: 19, verse_start: 19, verse_end: 19, color: 'green', deleted: 0 },
  ],
  notes: [
    {
      id: 'n1',
      title: 'The school of Tyrannus',
      body_text:
        'Paul departed from the synagogue and reasoned daily in the school of Tyrannus, so that all Asia heard the word of the Lord.',
    },
  ],
};

const semanticData = {
  semanticNotes: [
    { noteId: 'sn1', title: 'Miracles as attestation', snippet: 'Special miracles authenticated the apostolic message in Ephesus.', similarity: 0.82 },
  ],
  threads: [
    { id: 't1', label: 'Repentance made visible', noteIds: ['n1'], summary: 'Believers burned their books of magic — repentance with a public cost.', extractor: 'ai', created: '2024-03-01' },
  ],
  claims: [
    { id: 'c1', assertion: 'Ephesian believers publicly burned occult texts worth 50,000 pieces of silver', claimType: 'historical', confidence: 0.91, extractor: 'ai', created: '2024-03-01', status: 'open', anchors: [], sources: [] },
  ],
  overlays: [],
  suggestedCrossRefs: [
    { targetBref: 'DEU.18.10', targetDisplay: 'Deuteronomy 18:10', reason: 'Prohibition of sorcery', confidence: 0.77 },
  ],
};

const frame = (children: any) => (
  <div style={{ width: 340, height: 560, overflow: 'auto', background: 'var(--bg-sidebar)' }}>{children}</div>
);

export const WithNotesAndHighlights = () =>
  frame(
    <LivingMargin
      book="ACT"
      chapter={19}
      marginData={richMargin}
      crossRefs={['John 14:12', '1 Corinthians 2:4', 'Mark 16:20']}
      bookNames={bookNames}
      onDeleteHighlight={noop}
    />
  );

export const WithSemanticInsights = () =>
  frame(
    <LivingMargin
      book="ACT"
      chapter={19}
      marginData={richMargin}
      crossRefs={['John 14:12']}
      bookNames={bookNames}
      semanticData={semanticData as any}
      onPinClaim={noop}
      onDeleteHighlight={noop}
    />
  );

export const Empty = () =>
  frame(
    <LivingMargin
      book="ACT"
      chapter={19}
      marginData={emptyMargin}
      crossRefs={[]}
      bookNames={bookNames}
    />
  );
