import { WritingSheet } from 'scripture-app';

const noop = () => {};

export const Blank = () => (
  <div style={{ maxWidth: 720, height: 480, display: 'flex', flexDirection: 'column' }}>
    <WritingSheet onSaved={noop} />
  </div>
);

export const Prefilled = () => (
  <div style={{ maxWidth: 720, height: 480, display: 'flex', flexDirection: 'column' }}>
    <WritingSheet
      prefillBody={
        '> "And this continued by the space of two years; so that all they which dwelt in Asia heard the word." — Acts 19:10\n\nPaul\'s Ephesian ministry radiated outward from a single lecture hall.'
      }
      onSaved={noop}
    />
  </div>
);
