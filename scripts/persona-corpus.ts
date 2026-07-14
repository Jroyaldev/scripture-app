/**
 * Shared simulated-persona corpus (B3.6) — realistic ref-free quick notes
 * with golden expectations. Used by eval-personas (retrieval gap study /
 * Q1 gate) and smoke-enrich (enrichment quality hand-check).
 */

export type PersonaNote = {
  id: string;
  persona: "quick" | "sermon" | "journal";
  title: string;
  body: string;
  /** The passage a deep Bible student would expect this note to resurface for. */
  expect: { book: string; chapter: number; from: number; to: number; label: string };
};

// Deliberately ref-free, colloquial, short — the way people actually capture.
export const PERSONA_NOTES: PersonaNote[] = [
  // --- Persona: Quick Capturer (phone, 5-15 words, zero citations) ---
  { id: "01PERSONANOTE0000000000001", persona: "quick", title: "grace",
    body: "grace > performance. stop trying to earn it.",
    expect: { book: "EPH", chapter: 2, from: 1, to: 10, label: "Eph 2:1-10 (by grace through faith)" } },
  { id: "01PERSONANOTE0000000000002", persona: "quick", title: "waiting",
    body: "Waiting on God isn't wasted time. He works in the delay.",
    expect: { book: "PSA", chapter: 13, from: 1, to: 6, label: "Psalm 13 (how long, O LORD)" } },
  { id: "01PERSONANOTE0000000000003", persona: "quick", title: "silence",
    body: "why does God feel silent sometimes??",
    expect: { book: "PSA", chapter: 13, from: 1, to: 6, label: "Psalm 13 (how long, O LORD)" } },
  { id: "01PERSONANOTE0000000000004", persona: "quick", title: "shepherd",
    body: "The shepherd knows my name.",
    expect: { book: "PSA", chapter: 23, from: 1, to: 6, label: "Psalm 23 (the LORD is my shepherd)" } },
  { id: "01PERSONANOTE0000000000005", persona: "quick", title: "baptism thought",
    body: "Baptism means belonging, not magic.",
    expect: { book: "ACT", chapter: 19, from: 1, to: 7, label: "Acts 19:1-7 (re-baptized at Ephesus)" } },
  { id: "01PERSONANOTE0000000000006", persona: "quick", title: "whispers",
    body: "God speaks in whispers, not earthquakes.",
    expect: { book: "1KI", chapter: 19, from: 9, to: 13, label: "1 Kings 19 (still small voice)" } },

  // --- Persona: Sermon Sketcher (thematic ideas, illustrations, no refs) ---
  { id: "01PERSONANOTE0000000000007", persona: "sermon", title: "Series idea: wilderness",
    body: "Wilderness seasons: God shapes people in deserts before he uses them. Testing comes before commissioning.",
    expect: { book: "MAT", chapter: 4, from: 1, to: 11, label: "Matt 4:1-11 (temptation in the wilderness)" } },
  { id: "01PERSONANOTE0000000000008", persona: "sermon", title: "Big idea: the table",
    body: "The table is where outsiders become family. Who is not at our table yet?",
    expect: { book: "LUK", chapter: 14, from: 12, to: 24, label: "Luke 14:12-24 (invite the poor; great banquet)" } },
  { id: "01PERSONANOTE0000000000009", persona: "sermon", title: "Communion angle",
    body: "Remembrance is more than memory. When we eat together the past event becomes present reality.",
    expect: { book: "LUK", chapter: 22, from: 14, to: 23, label: "Luke 22:14-23 (do this in remembrance)" } },
  { id: "01PERSONANOTE0000000000010", persona: "sermon", title: "Illustration: lamps",
    body: "Illustration: the lighthouse keeper who trims the lamp every single night. Small faithfulness, big rescue.",
    expect: { book: "MAT", chapter: 25, from: 1, to: 13, label: "Matt 25:1-13 (ten virgins, lamps)" } },

  // --- Persona: Devotional Journaler (first person, emotional, no refs) ---
  { id: "01PERSONANOTE0000000000011", persona: "journal", title: "today",
    body: "Felt overwhelmed today. Prayed in the car. Reminded that he carries what I can't.",
    expect: { book: "MAT", chapter: 11, from: 25, to: 30, label: "Matt 11:28-30 (come to me, weary)" } },
  { id: "01PERSONANOTE0000000000012", persona: "journal", title: "trust",
    body: "Anxious about the diagnosis. Choosing to trust even when I can't see the path ahead.",
    expect: { book: "PRO", chapter: 3, from: 1, to: 8, label: "Prov 3:5-6 (trust, lean not)" } },
  { id: "01PERSONANOTE0000000000013", persona: "journal", title: "forgiveness",
    body: "Forgave Dad today. Ten years of weight, gone. Why did I carry it so long? Free.",
    expect: { book: "MAT", chapter: 18, from: 21, to: 35, label: "Matt 18:21-35 (seventy times seven)" } },

  // --- Slang-ref quick notes (Gate E0: these should ANCHOR deterministically) ---
  { id: "01PERSONANOTE0000000000014", persona: "quick", title: "ps23",
    body: "ps23 vibes today. he restores.",
    expect: { book: "PSA", chapter: 23, from: 1, to: 6, label: "Psalm 23 (slang ref → anchored)" } },
  { id: "01PERSONANOTE0000000000015", persona: "quick", title: "youth group",
    body: "jn3 tonight with the youth group. born again convo went deep.",
    expect: { book: "JHN", chapter: 3, from: 1, to: 21, label: "John 3 (slang ref → anchored)" } },
];
