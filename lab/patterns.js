// Pattern records — prototype payloads for a future annotations/shape-marks.jsonl.
// Coordinates are translation-free canonical refs (INV-5). Phrase keys anchor marks
// to exact words; char offsets are computed per translation at render, never stored.
// kind vocabulary is closed: series | mirror | link:parallel | link:contrast | link:echo | hinge

const PATTERNS = {

  psa: [
    {
      id: "psa1-two-ways",
      kind: "link:contrast",
      label: "The two ways",
      members: [
        { role: "righteous", range: ["PSA.1.1", "PSA.1.3"], key: { ref: "PSA.1.1", phrase: "Blessed is the man" } },
        { role: "wicked",    range: ["PSA.1.4", "PSA.1.5"], key: { ref: "PSA.1.4", phrase: "The wicked are not so" } },
      ],
    },
    {
      id: "psa1-frame",
      kind: "link:echo",
      label: "“the wicked” frames the psalm",
      members: [
        { role: "A",  key: { ref: "PSA.1.1", phrase: "the counsel of the wicked" } },
        { role: "A′", key: { ref: "PSA.1.6", phrase: "the way of the wicked" } },
      ],
    },
    {
      id: "psa1-hinge",
      kind: "hinge",
      label: "Two ways, weighed",
      members: [
        { role: "A", key: { ref: "PSA.1.6", phrase: "the way of the righteous" } },
        { role: "B", key: { ref: "PSA.1.6", phrase: "the way of the wicked" } },
      ],
    },
  ],

  gen: [
    {
      id: "gen1-form-fill",
      kind: "mirror",
      label: "Forming ↔ filling",
      rails: [
        { role: "forming", range: ["GEN.1.3", "GEN.1.13"] },
        { role: "filling", range: ["GEN.1.14", "GEN.1.31"] },
      ],
      pairs: [
        { a: { ref: "GEN.1.3", phrase: "Let there be light" },
          b: { ref: "GEN.1.14", phrase: "Let there be lights" }, label: "day 1 · 4 — light / luminaries" },
        { a: { ref: "GEN.1.6", phrase: "divide the waters from the waters" },
          b: { ref: "GEN.1.20", phrase: "Let the waters abound with living creatures" }, label: "day 2 · 5 — waters / sea & sky life" },
        { a: { ref: "GEN.1.9", phrase: "let the dry land appear" },
          b: { ref: "GEN.1.24", phrase: "Let the earth produce living creatures" }, label: "day 3 · 6 — land / land life" },
      ],
    },
    {
      id: "gen1-refrain",
      kind: "series",
      label: "“God saw that it was good” — the goodness refrain",
      members: [
        { role: "1", key: { ref: "GEN.1.10", phrase: "God saw that it was good" } },
        { role: "2", key: { ref: "GEN.1.12", phrase: "God saw that it was good" } },
        { role: "3", key: { ref: "GEN.1.18", phrase: "God saw that it was good" } },
        { role: "4", key: { ref: "GEN.1.21", phrase: "God saw that it was good" } },
        { role: "5", key: { ref: "GEN.1.25", phrase: "God saw that it was good" } },
        { role: "6 · very", key: { ref: "GEN.1.31", phrase: "very good" } },
      ],
    },
  ],

  rev: [
    {
      id: "rev23-letters",
      kind: "series",
      label: "One letter, seven times",
      elementSchema: ["address", "know", "commend", "rebuke", "exhort", "promise", "ear"],
      members: [
        { role: "Ephesus",     range: ["REV.2.1",  "REV.2.7"],
          keys: { address: { ref: "REV.2.1", phrase: "To the angel of the assembly in Ephesus write" },
                  know:    { ref: "REV.2.2", phrase: "I know your works" },
                  promise: { ref: "REV.2.7", phrase: "To him who overcomes" },
                  ear:     { ref: "REV.2.7", phrase: "He who has an ear" } },
          elements: { address: ["REV.2.1"], know: ["REV.2.2"], commend: ["REV.2.2", "REV.2.3"], rebuke: ["REV.2.4"], exhort: ["REV.2.5"], promise: ["REV.2.7"], ear: ["REV.2.7"] }, earPos: "pre" },
        { role: "Smyrna",      range: ["REV.2.8",  "REV.2.11"],
          keys: { address: { ref: "REV.2.8", phrase: "To the angel of the assembly in Smyrna write" },
                  know:    { ref: "REV.2.9", phrase: "I know your works" },
                  promise: { ref: "REV.2.11", phrase: "He who overcomes" },
                  ear:     { ref: "REV.2.11", phrase: "He who has an ear" } },
          elements: { address: ["REV.2.8"], know: ["REV.2.9"], commend: ["REV.2.9", "REV.2.10"], rebuke: null, exhort: ["REV.2.10"], promise: ["REV.2.11"], ear: ["REV.2.11"] }, earPos: "pre" },
        { role: "Pergamum",    range: ["REV.2.12", "REV.2.17"],
          keys: { address: { ref: "REV.2.12", phrase: "To the angel of the assembly in Pergamum write" },
                  know:    { ref: "REV.2.13", phrase: "I know your works" },
                  promise: { ref: "REV.2.17", phrase: "To him who overcomes" },
                  ear:     { ref: "REV.2.17", phrase: "He who has an ear" } },
          elements: { address: ["REV.2.12"], know: ["REV.2.13"], commend: ["REV.2.13"], rebuke: ["REV.2.14", "REV.2.15"], exhort: ["REV.2.16"], promise: ["REV.2.17"], ear: ["REV.2.17"] }, earPos: "pre" },
        { role: "Thyatira",    range: ["REV.2.18", "REV.2.29"],
          keys: { address: { ref: "REV.2.18", phrase: "To the angel of the assembly in Thyatira write" },
                  know:    { ref: "REV.2.19", phrase: "I know your works" },
                  promise: { ref: "REV.2.26", phrase: "He who overcomes" },
                  ear:     { ref: "REV.2.29", phrase: "He who has an ear" } },
          elements: { address: ["REV.2.18"], know: ["REV.2.19"], commend: ["REV.2.19"], rebuke: ["REV.2.20", "REV.2.21"], exhort: ["REV.2.24", "REV.2.25"], promise: ["REV.2.26", "REV.2.28"], ear: ["REV.2.29"] }, earPos: "post" },
        { role: "Sardis",      range: ["REV.3.1",  "REV.3.6"],
          keys: { address: { ref: "REV.3.1", phrase: "to the angel of the assembly in Sardis write" },
                  know:    { ref: "REV.3.1", phrase: "I know your works" },
                  promise: { ref: "REV.3.5", phrase: "He who overcomes" },
                  ear:     { ref: "REV.3.6", phrase: "He who has an ear" } },
          elements: { address: ["REV.3.1"], know: ["REV.3.1"], commend: ["REV.3.4"], rebuke: ["REV.3.1", "REV.3.2"], exhort: ["REV.3.2", "REV.3.3"], promise: ["REV.3.5"], ear: ["REV.3.6"] }, earPos: "post", partial: ["commend"] },
        { role: "Philadelphia",range: ["REV.3.7",  "REV.3.13"],
          keys: { address: { ref: "REV.3.7", phrase: "To the angel of the assembly in Philadelphia write" },
                  know:    { ref: "REV.3.8", phrase: "I know your works" },
                  promise: { ref: "REV.3.12", phrase: "He who overcomes" },
                  ear:     { ref: "REV.3.13", phrase: "He who has an ear" } },
          elements: { address: ["REV.3.7"], know: ["REV.3.8"], commend: ["REV.3.8", "REV.3.10"], rebuke: null, exhort: ["REV.3.11"], promise: ["REV.3.12"], ear: ["REV.3.13"] }, earPos: "post" },
        { role: "Laodicea",    range: ["REV.3.14", "REV.3.22"],
          keys: { address: { ref: "REV.3.14", phrase: "To the angel of the assembly in Laodicea write" },
                  know:    { ref: "REV.3.15", phrase: "I know your works" },
                  promise: { ref: "REV.3.21", phrase: "He who overcomes" },
                  ear:     { ref: "REV.3.22", phrase: "He who has an ear" } },
          elements: { address: ["REV.3.14"], know: ["REV.3.15"], commend: null, rebuke: ["REV.3.15", "REV.3.17"], exhort: ["REV.3.18", "REV.3.19"], promise: ["REV.3.20", "REV.3.21"], ear: ["REV.3.22"] }, earPos: "post" },
      ],
    },
  ],
};

// Short, honest excerpts for panel cells (first words of the range, real WEB text).
function excerpt(refStart, words) {
  const [book, ch, v] = refStart.split(".");
  const chKey = `${book}.${ch}`;
  const row = (VERSES[chKey] || []).find((r) => r.verse === Number(v));
  if (!row) return "";
  const parts = row.text.split(/\s+/);
  return parts.slice(0, words).join(" ") + (parts.length > words ? " …" : "");
}
