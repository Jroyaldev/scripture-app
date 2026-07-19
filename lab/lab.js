/* Pattern shapes lab · v3 — "the text awakens".
 * At rest the page is almost plain scripture: keyed phrases carry only a
 * whisper of a dotted hint. Touch one and its whole pattern wakes — sibling
 * phrases ink in, a connector draws itself through the gutter, the rest of
 * the page recedes, and a small whisper names the shape. Click pins it.
 * No dialect switcher, no chrome at rest: one opinionated language.
 * Both views route with the Loom engine (route-engine.js) — the same planner
 * as route.html; the Reading/Traces toggle changes only the page's set, never
 * the connector grammar. One connection card serves both views: it appears
 * only while a connection is held and shows exactly the focused one. */
import { planRoute, rankCompanions } from "./route-engine.js";
import { _internals as routeInternals } from "./route-engine.js";

const hovered = new Set(); // gids under the cursor
const pinned = new Set();  // gids pinned by click
const REDUCED_MOTION = matchMedia("(prefers-reduced-motion: reduce)").matches;
const TG = globalThis.TraceGeometry;
if (!TG) throw new Error("trace-geometry.js must load before lab.js");

const KIND_HUE = {
  "link:parallel": "var(--k-parallel)",
  "link:contrast": "var(--k-contrast)",
  "link:echo": "var(--k-echo)",
  hinge: "var(--k-parallel)",
  mirror: "var(--k-mirror)",
  series: "var(--k-series)",
};
const KIND_LABEL = {
  "link:parallel": "parallelism", "link:contrast": "contrast", "link:echo": "echo",
  hinge: "hinge", mirror: "mirror", series: "series",
};

const SVGNS = "http://www.w3.org/2000/svg";
function S(tag, attrs = {}, parent) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (parent) parent.appendChild(el);
  return el;
}

/* glyphs — used only by the Revelation matrix panel */
const GLYPH_PATHS = {
  address: "M7 3.4 A3.6 3.6 0 1 1 6.9 3.4 Z",
  know:    "M7 2.4 L11.6 7 L7 11.6 L2.4 7 Z",
  commend: "M7 2.8 L11.6 10.6 L2.4 10.6 Z",
  rebuke:  "M7 11.2 L2.4 3.4 L11.6 3.4 Z",
  exhort:  "M4.2 2.8 L9.8 7 L4.2 11.2",
  promise: "M7 1.8 C7.9 5.1 8.9 6.1 12.2 7 C8.9 7.9 7.9 8.9 7 12.2 C6.1 8.9 5.1 7.9 1.8 7 C5.1 6.1 6.1 5.1 7 1.8 Z",
  ear:     "M4.6 10.6 A4.4 4.4 0 1 1 10.4 8.6",
};

/* ── sheets ──────────────────────────────────────────────── */
const SHEETS = {
  psa: { title: "Psalm 1", ref: "PSA.1.1–6 · WEB", chapters: [{ head: null, key: "PSA.1" }] },
  gen: { title: "The creation week", ref: "GEN.1.1 – 2.3 · WEB", chapters: [{ head: "Genesis 1", key: "GEN.1" }, { head: "Genesis 2", key: "GEN.2" }] },
  rev: { title: "Letters to the seven assemblies", ref: "REV.2.1 – 3.22 · WEB", chapters: [{ head: "Revelation 2", key: "REV.2" }, { head: "Revelation 3", key: "REV.3" }] },
  qa: { title: "Line-angle proof", ref: "MIDDLE → RIGHT / SAME · +1 LINE · +MANY LINES", chapters: [{ head: null, key: "QA.1" }] },
};
const TRUNCATE = { rev: 190 };

/* A fixed-width, lab-only proof matrix. Every case lives in one synthetic row;
 * preserved newlines create the rendered-line distance, so verse boundaries
 * cannot make the result look better than the actual route. */
const GEOMETRY_KINDS = [
  { kind: "link:parallel", slug: "parallel", label: "Parallelism" },
  { kind: "link:contrast", slug: "contrast", label: "Contrast" },
  { kind: "link:echo", slug: "echo", label: "Echo" },
  { kind: "hinge", slug: "hinge", label: "Hinge" },
  { kind: "mirror", slug: "mirror", label: "Mirror" },
  { kind: "series", slug: "series", label: "Series" },
];
function geometryFixture() {
  const verses = [];
  const patterns = [];
  let verse = 1;
  const push = (lines) => {
    const current = verse++;
    const qaLines = lines.map((line) => typeof line === "string" ? { text: line, align: "left" } : line);
    verses.push({ verse: current, text: qaLines.map((line) => line.text).join("\n"), qaLines });
    return `QA.1.${current}`;
  };
  for (const entry of GEOMETRY_KINDS) {
    const middle = `${entry.label} middle`;
    const edge = `${entry.label} edge`;
    const middleLine = `Opening words · ${middle} · continue onward.`;
    const edgeLine = `The line continues across until · ${edge}`;

    const sameRef = push([{ text: `Opening words · ${middle} · continue until · ${edge}`, align: "right" }]);
    patterns.push({
      id: `qa-${entry.slug}-same`, kind: entry.kind, label: `${entry.label} · middle to right · same rendered line`,
      qaDistance: "same", qaPlacement: "middle-right",
      members: [{ ref: sameRef, phrase: middle }, { ref: sameRef, phrase: edge }],
    });

    const adjacentRef = push([
      { text: middleLine, align: "middle" },
      { text: edgeLine, align: "right" },
    ]);
    patterns.push({
      id: `qa-${entry.slug}-adjacent`, kind: entry.kind, label: `${entry.label} · middle to right · one rendered line apart`,
      qaDistance: "adjacent", qaPlacement: "middle-right",
      members: [{ ref: adjacentRef, phrase: middle }, { ref: adjacentRef, phrase: edge }],
    });

    const farRef = push([
      { text: middleLine, align: "middle" },
      ...Array.from({ length: 5 }, (_, gap) => ({ text: `Clear line ${gap + 1} preserves the marginal corridor.`, align: "left" })),
      { text: edgeLine, align: "right" },
    ]);
    patterns.push({
      id: `qa-${entry.slug}-far`, kind: entry.kind, label: `${entry.label} · middle to right · many rendered lines apart`,
      qaDistance: "far", qaPlacement: "middle-right",
      members: [{ ref: farRef, phrase: middle }, { ref: farRef, phrase: edge }],
    });
  }
  return { verses, patterns };
}
const GEOMETRY_FIXTURE = geometryFixture();
VERSES["QA.1"] = GEOMETRY_FIXTURE.verses;

/* ── awaken groups (gids) ────────────────────────────────── */
/* A gid is one touchable pattern instance: hover any of its phrases and
 * every member wakes together. Derived from PATTERNS, never stored. */
const GIDS = {};
function addGid(gid, study, kind, label, keys, conn, meta = {}) {
  GIDS[gid] = { gid, study, kind, hue: KIND_HUE[kind], label, keys: keys.filter(Boolean), conn, spans: [], anchors: [], ...meta };
}

/* user-authored marks — same record shape, persisted locally */
const USER_KEY = "shape-marks-user";
let USER = [];
try { USER = JSON.parse(localStorage.getItem(USER_KEY) || "[]"); } catch { USER = []; }
function saveUser() { localStorage.setItem(USER_KEY, JSON.stringify(USER)); }
/* The store carries two record species: patterns ({kind, members}) and
 * highlights ({type:"highlight", color, key}). Untyped records are
 * patterns, so pre-highlight stores load unchanged. */
const userPatterns = () => USER.filter((r) => r.type !== "highlight");
const userHighlights = () => USER.filter((r) => r.type === "highlight");
const recStudy = (r) => refStudy(r.type === "highlight" ? r.key.ref : r.members[0].ref);

/* A reversible density fixture. Three marks flatter almost any margin; these
 * eleven additional, overlapping relationships make the design answer to a
 * real studied page (14 traces total) without contaminating pattern records. */
let DENSITY_MODE = false;
let ANGLE_MODE = false;
const DENSITY_PATTERNS = [
  { id: "stress-standing", kind: "link:echo", label: "standing at the two outcomes", members: [
    { ref: "PSA.1.1", phrase: "stand on the path of sinners" },
    { ref: "PSA.1.5", phrase: "stand in the judgment" },
  ] },
  { id: "stress-seats", kind: "link:contrast", label: "seat and congregation", members: [
    { ref: "PSA.1.1", phrase: "sit in the seat of scoffers" },
    { ref: "PSA.1.5", phrase: "congregation of the righteous" },
  ] },
  { id: "stress-tree-chaff", kind: "link:contrast", label: "rooted and driven", members: [
    { ref: "PSA.1.3", phrase: "a tree planted by the streams of water" },
    { ref: "PSA.1.4", phrase: "the chaff which the wind drives away" },
  ] },
  { id: "stress-law", kind: "link:echo", label: "the law repeated", members: [
    { ref: "PSA.1.2", phrase: "Yahweh’s law" },
    { ref: "PSA.1.2", phrase: "his law" },
  ] },
  { id: "stress-wicked", kind: "series", label: "the wicked ×4", members: [
    { ref: "PSA.1.1", phrase: "the wicked" },
    { ref: "PSA.1.4", phrase: "The wicked" },
    { ref: "PSA.1.5", phrase: "the wicked" },
    { ref: "PSA.1.6", phrase: "the wicked" },
  ] },
  { id: "stress-righteous", kind: "link:echo", label: "the righteous named twice", members: [
    { ref: "PSA.1.5", phrase: "the righteous" },
    { ref: "PSA.1.6", phrase: "the righteous" },
  ] },
  { id: "stress-fruit", kind: "link:parallel", label: "meditation becomes fruit", members: [
    { ref: "PSA.1.2", phrase: "meditates day and night" },
    { ref: "PSA.1.3", phrase: "produces its fruit in its season" },
  ] },
  { id: "stress-endings", kind: "link:contrast", label: "does not wither / shall perish", members: [
    { ref: "PSA.1.3", phrase: "does not wither" },
    { ref: "PSA.1.6", phrase: "shall perish" },
  ] },
  { id: "stress-path-way", kind: "mirror", label: "path and way", members: [
    { ref: "PSA.1.1", phrase: "the path of sinners" },
    { ref: "PSA.1.6", phrase: "the way of the righteous" },
  ] },
  { id: "stress-delight-meditation", kind: "hinge", label: "delight turns to meditation", members: [
    { ref: "PSA.1.2", phrase: "his delight is in Yahweh’s law" },
    { ref: "PSA.1.2", phrase: "On his law he meditates" },
  ] },
  { id: "stress-opening-ending", kind: "mirror", label: "blessing and perishing", members: [
    { ref: "PSA.1.1", phrase: "Blessed is the man" },
    { ref: "PSA.1.6", phrase: "the wicked shall perish" },
  ] },
];

/* The short Psalm fixture tests overlap. This separate long-passage fixture
 * tests distance, recurrence, and a margin with enough held traces to need
 * real navigation. Revelation stays complete while this mode is on: none of its
 * 51 source verses are visually truncated. */
let LONG_MODE = false;
const LONG_PATTERNS = [
  { id: "revstress-speaker-portraits", kind: "series", label: "the speaker names himself seven ways", members: [
    { ref: "REV.2.1", phrase: "He who holds the seven stars in his right hand" },
    { ref: "REV.2.8", phrase: "The first and the last, who was dead, and has come to life" },
    { ref: "REV.2.12", phrase: "He who has the sharp two-edged sword" },
    { ref: "REV.2.18", phrase: "The Son of God, who has his eyes like a flame of fire, and his feet are like burnished brass" },
    { ref: "REV.3.1", phrase: "He who has the seven Spirits of God, and the seven stars" },
    { ref: "REV.3.7", phrase: "He who is holy, he who is true, he who has the key of David" },
    { ref: "REV.3.14", phrase: "The Amen, the Faithful and True Witness, the Beginning of God’s creation" },
  ] },
  { id: "revstress-repent", kind: "series", label: "the call to repent", members: [
    { ref: "REV.2.5", phrase: "repent" },
    { ref: "REV.2.5", phrase: "repent", occ: 1 },
    { ref: "REV.2.16", phrase: "Repent" },
    { ref: "REV.2.21", phrase: "repent" },
    { ref: "REV.2.21", phrase: "repent", occ: 1 },
    { ref: "REV.2.22", phrase: "repent" },
    { ref: "REV.3.3", phrase: "repent" },
    { ref: "REV.3.19", phrase: "repent" },
  ] },
  { id: "revstress-coming", kind: "series", label: "the coming refrain", members: [
    { ref: "REV.2.5", phrase: "I am coming to you swiftly" },
    { ref: "REV.2.16", phrase: "I am coming to you quickly" },
    { ref: "REV.2.25", phrase: "until I come" },
    { ref: "REV.3.3", phrase: "I will come as a thief" },
    { ref: "REV.3.3", phrase: "I will come upon you" },
    { ref: "REV.3.11", phrase: "I am coming quickly" },
    { ref: "REV.3.20", phrase: "I will come in to him" },
  ] },
  { id: "revstress-hold-keep", kind: "series", label: "hold, keep, endure", members: [
    { ref: "REV.2.13", phrase: "You hold firmly to my name" },
    { ref: "REV.2.15", phrase: "hold to the teaching of the Nicolaitans" },
    { ref: "REV.2.25", phrase: "hold that which you have firmly" },
    { ref: "REV.2.26", phrase: "keeps my works to the end" },
    { ref: "REV.3.2", phrase: "keep the things that remain" },
    { ref: "REV.3.3", phrase: "Keep it and repent" },
    { ref: "REV.3.8", phrase: "kept my word" },
    { ref: "REV.3.10", phrase: "kept my command to endure" },
    { ref: "REV.3.10", phrase: "I also will keep you" },
    { ref: "REV.3.11", phrase: "Hold firmly that which you have" },
  ] },
  { id: "revstress-life-death", kind: "series", label: "life and death trade places", members: [
    { ref: "REV.2.7", phrase: "tree of life" },
    { ref: "REV.2.8", phrase: "was dead, and has come to life" },
    { ref: "REV.2.10", phrase: "Be faithful to death" },
    { ref: "REV.2.10", phrase: "crown of life" },
    { ref: "REV.2.11", phrase: "second death" },
    { ref: "REV.2.23", phrase: "I will kill her children with Death" },
    { ref: "REV.3.1", phrase: "reputation of being alive, but you are dead" },
    { ref: "REV.3.5", phrase: "book of life" },
  ] },
  { id: "revstress-names", kind: "series", label: "names kept, confessed, and given", members: [
    { ref: "REV.2.3", phrase: "my name’s sake" },
    { ref: "REV.2.13", phrase: "my name" },
    { ref: "REV.2.17", phrase: "a new name written" },
    { ref: "REV.3.4", phrase: "a few names in Sardis" },
    { ref: "REV.3.5", phrase: "his name" },
    { ref: "REV.3.5", phrase: "his name", occ: 1 },
    { ref: "REV.3.8", phrase: "my name" },
    { ref: "REV.3.12", phrase: "the name of my God" },
    { ref: "REV.3.12", phrase: "the name of the city of my God" },
    { ref: "REV.3.12", phrase: "my own new name" },
  ] },
  { id: "revstress-white", kind: "series", label: "white stone and white garments", members: [
    { ref: "REV.2.17", phrase: "a white stone" },
    { ref: "REV.3.4", phrase: "walk with me in white" },
    { ref: "REV.3.5", phrase: "white garments" },
    { ref: "REV.3.18", phrase: "white garments" },
  ] },
  { id: "revstress-testing", kind: "series", label: "testing the testers", members: [
    { ref: "REV.2.2", phrase: "have tested those who call themselves apostles" },
    { ref: "REV.2.10", phrase: "that you may be tested" },
    { ref: "REV.3.10", phrase: "the hour of testing" },
    { ref: "REV.3.10", phrase: "to test those who dwell on the earth" },
  ] },
  { id: "revstress-false-claims", kind: "link:parallel", label: "claimed identity versus revealed condition", members: [
    { ref: "REV.2.2", phrase: "call themselves apostles, and they are not" },
    { ref: "REV.2.9", phrase: "say they are Jews, and they are not" },
    { ref: "REV.3.1", phrase: "a reputation of being alive, but you are dead" },
    { ref: "REV.3.9", phrase: "say they are Jews, and they are not" },
    { ref: "REV.3.17", phrase: "you say, ‘I am rich, and have gotten riches, and have need of nothing;’" },
  ] },
  { id: "revstress-satan", kind: "series", label: "Satan named by place and claim", members: [
    { ref: "REV.2.9", phrase: "a synagogue of Satan" },
    { ref: "REV.2.13", phrase: "where Satan’s throne is" },
    { ref: "REV.2.13", phrase: "where Satan dwells" },
    { ref: "REV.2.24", phrase: "the deep things of Satan" },
    { ref: "REV.3.9", phrase: "the synagogue of Satan" },
  ] },
  { id: "revstress-rich-poor", kind: "link:contrast", label: "poor yet rich; rich yet poor", members: [
    { ref: "REV.2.9", phrase: "your poverty (but you are rich)" },
    { ref: "REV.3.17", phrase: "you are the wretched one, miserable, poor, blind, and naked" },
  ] },
  { id: "revstress-open-shut", kind: "mirror", label: "open and shut", members: [
    { ref: "REV.3.7", phrase: "he who opens and no one can shut" },
    { ref: "REV.3.7", phrase: "who shuts and no one opens" },
  ] },
  { id: "revstress-doors", kind: "link:echo", label: "the open door and the knocking door", members: [
    { ref: "REV.3.8", phrase: "an open door, which no one can shut" },
    { ref: "REV.3.20", phrase: "I stand at the door and knock" },
  ] },
  { id: "revstress-crowns", kind: "link:echo", label: "a crown given and guarded", members: [
    { ref: "REV.2.10", phrase: "I will give you the crown of life" },
    { ref: "REV.3.11", phrase: "so that no one takes your crown" },
  ] },
  { id: "revstress-thrones", kind: "link:contrast", label: "Satan’s throne and Christ’s throne", members: [
    { ref: "REV.2.13", phrase: "Satan’s throne" },
    { ref: "REV.3.21", phrase: "my throne" },
  ] },
  { id: "revstress-promise-gifts", kind: "series", label: "seven gifts to the one who overcomes", members: [
    { ref: "REV.2.7", phrase: "eat from the tree of life" },
    { ref: "REV.2.10", phrase: "the crown of life" },
    { ref: "REV.2.17", phrase: "the hidden manna" },
    { ref: "REV.2.28", phrase: "the morning star" },
    { ref: "REV.3.5", phrase: "arrayed in white garments" },
    { ref: "REV.3.12", phrase: "a pillar in the temple of my God" },
    { ref: "REV.3.21", phrase: "sit down with me on my throne" },
  ] },
  { id: "revstress-sardis-philadelphia", kind: "link:contrast", label: "Sardis nearly loses; Philadelphia keeps", members: [
    { ref: "REV.3.1", phrase: "I know your works" },
    { ref: "REV.3.2", phrase: "you were about to throw away" },
    { ref: "REV.3.3", phrase: "Keep it and repent" },
    { ref: "REV.3.8", phrase: "I know your works" },
    { ref: "REV.3.10", phrase: "Because you kept my command to endure" },
    { ref: "REV.3.11", phrase: "I am coming quickly" },
  ] },
  { id: "revstress-fire-eyes", kind: "link:parallel", label: "eyes and fire", members: [
    { ref: "REV.2.18", phrase: "eyes like a flame of fire" },
    { ref: "REV.3.18", phrase: "gold refined by fire" },
    { ref: "REV.3.18", phrase: "eye salve to anoint your eyes" },
  ] },
];

/* notes — observations attach to any pattern, yours or built-in */
const NOTES_KEY = "shape-marks-notes";
let NOTES = {};
try { NOTES = JSON.parse(localStorage.getItem(NOTES_KEY) || "{}"); } catch { NOTES = {}; }
function getNote(gid) {
  if (gid.startsWith("u-")) return USER.find((p) => p.id === gid)?.note || "";
  return NOTES[gid] || "";
}
function setNote(gid, text) {
  const empty = !text.trim();
  if (gid.startsWith("u-")) {
    const rec = USER.find((p) => p.id === gid);
    if (rec) { if (!empty) rec.note = text; else delete rec.note; saveUser(); }
  } else {
    if (!empty) NOTES[gid] = text; else delete NOTES[gid];
    localStorage.setItem(NOTES_KEY, JSON.stringify(NOTES));
  }
}
function renameUser(gid, label) {
  const rec = USER.find((p) => p.id === gid);
  if (!rec || !label.trim()) return;
  rec.label = label.trim();
  rec.custom = true; // a chosen name survives membership edits
  saveUser();
  const G = GIDS[gid];
  if (G) G.label = `${KIND_LABEL[G.kind]} · ${rec.label}`;
}
/* undo — destructive edits keep a six-second door open */
const toast = document.createElement("div");
toast.className = "toast";
document.body.appendChild(toast);
let undoTimer = 0;
function offerUndo(msg, snapshot, gidToRestore) {
  toast.innerHTML = "";
  const span = document.createElement("span"); span.textContent = msg;
  const btn = document.createElement("button"); btn.textContent = "undo";
  btn.addEventListener("click", () => {
    USER = JSON.parse(snapshot);
    saveUser();
    rebuildAll();
    if (gidToRestore) pinned.add(gidToRestore);
    applyActive();
    clearTimeout(undoTimer);
    toast.classList.remove("on");
  });
  toast.append(span, btn);
  toast.classList.add("on");
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => toast.classList.remove("on"), 6000);
}

function removeMember(gid, ref, phrase, occ = 0) {
  const rec = USER.find((p) => p.id === gid);
  if (!rec) return;
  const snap = JSON.stringify(USER);
  rec.members = rec.members.filter((m) => !(m.ref === ref && m.phrase === phrase && (m.occ || 0) === occ));
  if (rec.members.length < 2) {
    USER = USER.filter((p) => p.id !== gid);
    saveUser();
    pinned.delete(gid); hovered.delete(gid);
    rebuildAll(); applyActive();
    offerUndo("mark deleted — a pattern needs two members", snap, gid);
    return;
  }
  if (!rec.custom) rec.label = userLabel(rec.kind, rec.members);
  saveUser();
  rebuildAll();
  applyActive();
  offerUndo("words removed", snap, gid);
}
function refStudy(ref) {
  const chKey = ref.split(".").slice(0, 2).join(".");
  for (const [sid, cfg] of Object.entries(SHEETS))
    if (cfg.chapters.some((c) => c.key === chKey)) return sid;
  return null;
}
function shortQuote(s, n = 24) { return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s; }
/* contrast, hinge, and mirror are two-sided by nature; parallelism,
 * echo, and series may run as long as the text does */
const BINARY_KINDS = new Set(["link:contrast", "hinge", "mirror"]);
function userLabel(kind, members) {
  if (members.length > 2 || kind === "series") return `“${shortQuote(members[0].phrase)}” ×${members.length}`;
  return `“${shortQuote(members[0].phrase, 18)}” ↔ “${shortQuote(members[1].phrase, 18)}”`;
}

function buildGids() {
  for (const k of Object.keys(GIDS)) delete GIDS[k];
  for (const p of PATTERNS.psa) {
    addGid(p.id, "psa", p.kind, `${KIND_LABEL[p.kind]} · ${p.label}`, p.members.map((m) => m.key), "arc");
  }
  PATTERNS.gen[0].pairs.forEach((pair, i) => {
    addGid(`gen1-form-fill:${i}`, "gen", "mirror", `mirror · ${pair.label}`, [pair.a, pair.b], "arc");
  });
  addGid("gen1-refrain", "gen", "series", "series · “God saw that it was good” ×7",
    PATTERNS.gen[1].members.map((m) => m.key), "thread");
  const R = PATTERNS.rev[0];
  const ELEMS = {
    address: "“To the angel … write” ×7",
    know: "“I know your works” ×7",
    promise: "“he who overcomes” ×7",
    ear: "“he who has an ear” ×7",
  };
  for (const el of Object.keys(ELEMS)) {
    addGid(`rev23:${el}`, "rev", "series", `series · ${ELEMS[el]}`, R.members.map((m) => m.keys[el]), "thread");
  }
  if (DENSITY_MODE) {
    for (const p of DENSITY_PATTERNS) {
      addGid(p.id, "psa", p.kind, `${KIND_LABEL[p.kind]} · ${p.label}`, p.members, p.members.length > 2 ? "thread" : "arc");
    }
  }
  if (LONG_MODE) {
    for (const p of LONG_PATTERNS) {
      addGid(p.id, "rev", p.kind, `${KIND_LABEL[p.kind]} · ${p.label}`, p.members, p.members.length > 2 ? "thread" : "arc");
    }
  }
  if (ANGLE_MODE) {
    for (const p of GEOMETRY_FIXTURE.patterns) {
      addGid(p.id, "qa", p.kind, `${KIND_LABEL[p.kind]} · ${p.label}`, p.members, "arc", {
        qaKind: p.kind,
        qaDistance: p.qaDistance,
        qaPlacement: p.qaPlacement,
      });
    }
  }
  for (const p of userPatterns()) {
    const study = refStudy(p.members[0].ref);
    if (!study) continue;
    addGid(p.id, study, p.kind, `${KIND_LABEL[p.kind]} · ${p.label}`,
      p.members.map((m) => ({ ref: m.ref, phrase: m.phrase, occ: m.occ })),
      p.members.length > 2 ? "thread" : "arc");
  }
}

const LEGEND = {
  psa: () => PATTERNS.psa.map((p) => ({ label: `${KIND_LABEL[p.kind]} · ${p.label}`, kind: p.kind, gids: [p.id] })),
  gen: () => [
    { label: "mirror · forming ↔ filling", kind: "mirror", gids: ["gen1-form-fill:0", "gen1-form-fill:1", "gen1-form-fill:2"] },
    { label: "series · the goodness refrain", kind: "series", gids: ["gen1-refrain"] },
  ],
  rev: () => [
    { label: "the address", kind: "series", gids: ["rev23:address"] },
    { label: "“I know your works”", kind: "series", gids: ["rev23:know"] },
    { label: "the overcomer promise", kind: "series", gids: ["rev23:promise"] },
    { label: "“he who has an ear”", kind: "series", gids: ["rev23:ear"] },
  ],
  qa: () => ANGLE_MODE
    ? GEOMETRY_FIXTURE.patterns.map((p) => ({ label: `${KIND_LABEL[p.kind]} · ${p.label}`, kind: p.kind, gids: [p.id] }))
    : [],
};

/* Revelation's seven letters are declared source structure, not a visual
 * guess.  Keep the range, chapter provenance, and a stable routing id
 * together so reflow can change geometry without changing topology. */
const refTuple = (ref) => {
  const [book, chapter, verse] = String(ref || "").split(".");
  return { book, chapter: Number(chapter), verse: Number(verse) };
};
const refWithin = (ref, firstRef, lastRef) => {
  const value = refTuple(ref), first = refTuple(firstRef), last = refTuple(lastRef);
  if (!value.book || value.book !== first.book || first.book !== last.book) return false;
  const n = value.chapter * 1000 + value.verse;
  return n >= first.chapter * 1000 + first.verse && n <= last.chapter * 1000 + last.verse;
};
const sectionSlug = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const REVELATION_SECTIONS = PATTERNS.rev[0].members.map((member, order) => ({
  id: `rev23:${sectionSlug(member.role)}`,
  label: member.role,
  order,
  firstRef: member.range[0],
  lastRef: member.range[1],
  firstChapterId: member.range[0].split(".").slice(0, 2).join("."),
  lastChapterId: member.range[1].split(".").slice(0, 2).join("."),
}));
const REVELATION_SECTION_STARTS = new Map(REVELATION_SECTIONS.map((section) => [section.firstRef, section]));
const routingSectionFor = (study, ref) => study === "rev"
  ? REVELATION_SECTIONS.find((section) => refWithin(ref, section.firstRef, section.lastRef)) || null
  : null;

/* ── build: verses with phrase spans woven in ────────────── */
function versePlan(study, ref, text) {
  const ranges = [];
  for (const gid in GIDS) {
    const G = GIDS[gid];
    if (G.study !== study) continue;
    for (const k of G.keys) {
      if (k.ref !== ref) continue;
      // k.occ picks the nth occurrence — "law" the second time, not the first
      let idx = -1;
      for (let n = 0; n <= (k.occ || 0); n++) idx = text.indexOf(k.phrase, idx + 1);
      if (idx < 0) { console.warn("phrase missing", ref, k.phrase); continue; }
      ranges.push({ start: idx, end: idx + k.phrase.length, gid, ref, phrase: k.phrase, occ: k.occ || 0 });
    }
  }
  return ranges;
}

function appendSegments(container, text, ranges) {
  const pts = new Set([0, text.length]);
  const pieces = new Map(ranges.map((range) => [range, []]));
  ranges.forEach((r) => { pts.add(r.start); pts.add(r.end); });
  const cuts = [...pts].sort((a, b) => a - b);
  for (let i = 0; i < cuts.length - 1; i++) {
    const s = cuts[i], e = cuts[i + 1];
    const seg = text.slice(s, e);
    const cover = ranges.filter((r) => r.start <= s && r.end >= e);
    if (!cover.length) { container.appendChild(document.createTextNode(seg)); continue; }
    const el = document.createElement("span");
    // shared words rest in neutral gold — "more than one shape lives here"
    el.className = cover.length > 1 ? "pk pk-shared" : "pk";
    el.textContent = seg;
    el.dataset.gids = cover.map((r) => r.gid).join(" ");
    el.style.setProperty("--h", GIDS[cover[0].gid].hue);
    container.appendChild(el);
    cover.forEach((r) => {
      GIDS[r.gid].spans.push(el);
      pieces.get(r).push(el);
    });
  }
  [...ranges].sort((a, b) => a.start - b.start).forEach((r) => {
    const els = pieces.get(r);
    if (els?.length) {
      const section = routingSectionFor(GIDS[r.gid].study, r.ref);
      els.forEach((el) => {
        if (section) el.dataset.sectionId = section.id;
        el.dataset.sourceRef = r.ref;
      });
      GIDS[r.gid].anchors.push({
        el: els[0], els, ref: r.ref, phrase: r.phrase, occ: r.occ,
        ...(section ? { sectionId: section.id, sectionOrder: section.order } : {}),
      });
    }
  });
}

function appendQaLines(container, lines, ranges) {
  let offset = 0;
  lines.forEach((line, index) => {
    const lineEl = document.createElement("span");
    lineEl.className = "qa-line";
    lineEl.dataset.align = line.align;
    const lineRanges = ranges
      .filter((range) => range.start >= offset && range.end <= offset + line.text.length)
      .map((range) => ({ ...range, start: range.start - offset, end: range.end - offset }));
    appendSegments(lineEl, line.text, lineRanges);
    container.appendChild(lineEl);
    offset += line.text.length + (index < lines.length - 1 ? 1 : 0);
  });
}

function buildSheets() {
  for (const [id, cfg] of Object.entries(SHEETS)) {
    const sheet = document.querySelector(`[data-sheet="${id}"]`);
    sheet.innerHTML = "";
    for (const gid in GIDS) if (GIDS[gid].study === id) { GIDS[gid].spans = []; GIDS[gid].anchors = []; }
    sheet.appendChild(S("svg", { class: "hl-underlay" })); // washes beneath the text ink
    const t = document.createElement("div"); t.className = "sheet-title"; t.textContent = cfg.title;
    const r = document.createElement("div"); r.className = "sheet-ref"; r.textContent = cfg.ref;
    sheet.append(t, r);
    for (const ch of cfg.chapters) {
      if (ch.head) {
        const h = document.createElement("div");
        h.className = "chap-head";
        h.textContent = ch.head;
        h.dataset.chapterId = ch.key;
        h.dataset.sourceRole = "chapter";
        sheet.appendChild(h);
      }
      for (const v of VERSES[ch.key]) {
        const ref = `${ch.key}.${v.verse}`;
        const sourceSection = routingSectionFor(id, ref);
        const startingSection = id === "rev" ? REVELATION_SECTION_STARTS.get(ref) : null;
        if (startingSection) {
          const lh = document.createElement("div");
          lh.className = "letter-head";
          lh.dataset.letter = startingSection.label;
          lh.dataset.sectionId = startingSection.id;
          lh.dataset.sectionOrder = String(startingSection.order);
          lh.dataset.firstRef = startingSection.firstRef;
          lh.dataset.lastRef = startingSection.lastRef;
          lh.dataset.chapterId = ch.key;
          lh.dataset.sourceRole = "letter";
          lh.textContent = startingSection.label;
          sheet.appendChild(lh);
        }
        let text = v.text;
        const ranges = versePlan(id, ref, text);
        const limit = id === "rev" && LONG_MODE ? null : TRUNCATE[id];
        if (limit && text.length > limit) {
          const cut = text.slice(0, limit);
          const cutAt = cut.lastIndexOf(" ");
          if (ranges.every((rg) => rg.end <= cutAt)) text = cut.slice(0, cutAt) + " …";
        }
        const row = document.createElement("div");
        row.className = "vrow";
        row.dataset.key = ref;
        row.dataset.chapterId = ch.key;
        row.dataset.sourceOrder = String(v.verse);
        if (sourceSection) {
          row.dataset.sectionId = sourceSection.id;
          row.dataset.sectionOrder = String(sourceSection.order);
        }
        const num = document.createElement("span"); num.className = "vnum"; num.textContent = v.verse;
        const txt = document.createElement("span"); txt.className = "vtext";
        const visibleRanges = ranges.filter((rg) => rg.end <= text.length);
        if (id === "qa" && v.qaLines) appendQaLines(txt, v.qaLines, visibleRanges);
        else appendSegments(txt, text, visibleRanges);
        row.append(num, txt); sheet.appendChild(row);
      }
    }
    sheet.appendChild(S("svg", { class: "overlay" }));
    const wh = document.createElement("div"); wh.className = "whisper"; sheet.appendChild(wh);
    const legend = document.createElement("div"); legend.className = "legend";
    const entries = [...LEGEND[id](),
      ...userPatterns().filter((p) => refStudy(p.members[0].ref) === id)
        .map((p) => ({ label: `${KIND_LABEL[p.kind]} · ${p.label}`, kind: p.kind, gids: [p.id] }))];
    for (const entry of entries) {
      const chip = document.createElement("span");
      chip.className = "chip"; chip.dataset.gids = entry.gids.join(" ");
      chip.innerHTML = `<svg width="9" height="9"><circle cx="4.5" cy="4.5" r="3" fill="${KIND_HUE[entry.kind]}"/></svg>${entry.label}`;
      legend.appendChild(chip);
    }
    sheet.appendChild(legend);
    // until the first mark exists, the first sheet teaches the gesture
    if (id === "psa" && USER.length === 0) {
      const hint = document.createElement("div");
      hint.className = "mark-hint";
      hint.textContent = "✎ select any words to begin a pattern of your own";
      sheet.appendChild(hint);
    }
  }
}

/* ── highlights — a quiet rounded wash behind the exact words ──
 * Same discipline as the app's HighlightUnderlay/highlightPath.ts: measure
 * the phrase with a Range (one rect per visual line), merge bands, share
 * seams between lines, trace one rounded silhouette per record. Washes are
 * not connections — no connector, no dots, no underline change; they live in
 * svg.hl-underlay under the ink while patterns keep the layer above. */
const HL_PAD_H = 2.5, HL_PAD_V = 1.5, HL_RADIUS = 5, HL_JUNCTION = 1.5;
const HL_HITS = {}; // sid → [{ id, color, rects }] in sheet-relative coords

function hlTextPoint(root, charOffset) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let acc = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const len = node.textContent.length;
    if (acc + len >= charOffset) return { node, offset: charOffset - acc };
    acc += len;
  }
  return null;
}
/* duplicate rects on one visual line collapse to one band; consecutive
 * bands then share the exact midpoint seam — no overlap, no gap */
function hlMergeRects(list) {
  const sorted = [...list].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const bands = [];
  for (const r of sorted) {
    const p = bands[bands.length - 1];
    if (p && Math.abs(p.y0 - r.y0) <= 1.5 && Math.abs(p.y1 - r.y1) <= 1.5 && r.x0 <= p.x1 + 1.5) {
      p.x0 = Math.min(p.x0, r.x0); p.y0 = Math.min(p.y0, r.y0);
      p.x1 = Math.max(p.x1, r.x1); p.y1 = Math.max(p.y1, r.y1);
    } else bands.push({ ...r });
  }
  for (let i = 0; i < bands.length - 1; i++) {
    const seam = (bands[i].y1 + bands[i + 1].y0) / 2;
    bands[i].y1 = seam; bands[i + 1].y0 = seam;
  }
  return bands;
}
/* one rounded outline around the stacked bands — broad exterior corners,
 * compact ~1.5px eased steps where the text rag changes (the production
 * tracer's grammar, distilled; near-equal widths read as a straight edge) */
function hlPath(rects, radius = HL_RADIUS) {
  const n = rects.length;
  if (!n) return "";
  const EPS = 1.5;
  const f = (v) => Math.round(v * 100) / 100;
  const rOf = (b) => Math.max(0, Math.min(radius, (b.x1 - b.x0) / 2, (b.y1 - b.y0) / 2));
  const step = (a, b, delta) =>
    Math.max(0, Math.min(HL_JUNCTION, (a.y1 - a.y0) / 4, (b.y1 - b.y0) / 4, Math.abs(delta) / 2));
  const first = rects[0], last = rects[n - 1];
  const r0 = rOf(first), r1 = rOf(last);
  let d = `M${f(first.x0 + r0)},${f(first.y0)}L${f(first.x1 - r0)},${f(first.y0)}` +
    `Q${f(first.x1)},${f(first.y0)} ${f(first.x1)},${f(first.y0 + r0)}`;
  for (let i = 0; i < n - 1; i++) { // right side, top to bottom
    const a = rects[i], b = rects[i + 1], seam = a.y1, delta = b.x1 - a.x1;
    if (Math.abs(delta) <= EPS) { d += `L${f(b.x1)},${f(seam)}`; continue; }
    const r = step(a, b, delta), s = Math.sign(delta);
    d += `L${f(a.x1)},${f(seam - r)}Q${f(a.x1)},${f(seam)} ${f(a.x1 + s * r)},${f(seam)}`;
    d += `L${f(b.x1 - s * r)},${f(seam)}Q${f(b.x1)},${f(seam)} ${f(b.x1)},${f(seam + r)}`;
  }
  d += `L${f(last.x1)},${f(last.y1 - r1)}Q${f(last.x1)},${f(last.y1)} ${f(last.x1 - r1)},${f(last.y1)}`;
  d += `L${f(last.x0 + r1)},${f(last.y1)}Q${f(last.x0)},${f(last.y1)} ${f(last.x0)},${f(last.y1 - r1)}`;
  for (let i = n - 2; i >= 0; i--) { // left side, bottom to top
    const a = rects[i], b = rects[i + 1], seam = a.y1, delta = a.x0 - b.x0;
    if (Math.abs(delta) <= EPS) { d += `L${f(a.x0)},${f(seam)}`; continue; }
    const r = step(a, b, delta), s = Math.sign(delta);
    d += `L${f(b.x0)},${f(seam + r)}Q${f(b.x0)},${f(seam)} ${f(b.x0 + s * r)},${f(seam)}`;
    d += `L${f(a.x0 - s * r)},${f(seam)}Q${f(a.x0)},${f(seam)} ${f(a.x0)},${f(seam - r)}`;
  }
  d += `L${f(first.x0)},${f(first.y0 + r0)}Q${f(first.x0)},${f(first.y0)} ${f(first.x0 + r0)},${f(first.y0)}`;
  return d + "Z";
}
function drawHighlights(sid) {
  const sheet = document.querySelector(`[data-sheet="${sid}"]`);
  const svg = sheet?.querySelector("svg.hl-underlay");
  if (!svg) return;
  const base = sheet.getBoundingClientRect();
  svg.setAttribute("width", base.width); svg.setAttribute("height", base.height);
  svg.innerHTML = "";
  const hits = (HL_HITS[sid] = []);
  for (const h of userHighlights()) {
    if (recStudy(h) !== sid) continue;
    const vt = sheet.querySelector(`.vrow[data-key="${h.key.ref}"] .vtext`);
    if (!vt) continue;
    const text = vt.textContent;
    let idx = -1;
    for (let occ = 0; occ <= (h.key.occ || 0); occ++) idx = text.indexOf(h.key.phrase, idx + 1);
    if (idx < 0) continue; // phrase absent in this rendering — record kept, wash silent
    const start = hlTextPoint(vt, idx), end = hlTextPoint(vt, idx + h.key.phrase.length);
    if (!start || !end) continue;
    const range = document.createRange();
    range.setStart(start.node, start.offset); range.setEnd(end.node, end.offset);
    const rects = hlMergeRects([...range.getClientRects()].map((r) => ({
      x0: r.left - base.left - HL_PAD_H, y0: r.top - base.top - HL_PAD_V,
      x1: r.right - base.left + HL_PAD_H, y1: r.bottom - base.top + HL_PAD_V,
    })));
    if (!rects.length) continue;
    S("path", { d: hlPath(rects), fill: `var(--hl-${h.color})`, "data-hl": h.id }, svg);
    hits.push({ id: h.id, color: h.color, rects });
  }
}
function drawAllHighlights() { for (const sid of Object.keys(SHEETS)) drawHighlights(sid); }

/* ── overlay: connectors that draw themselves on awaken ──── */
function measure(sid) {
  const sheet = document.querySelector(`[data-sheet="${sid}"]`);
  const svg = sheet.querySelector("svg.overlay");
  const base = sheet.getBoundingClientRect();
  svg.setAttribute("width", base.width); svg.setAttribute("height", base.height);
  let textLeft = Infinity, textRight = -Infinity;
  sheet.querySelectorAll(".vrow .vtext").forEach((el) => {
    const r = el.getBoundingClientRect();
    textLeft = Math.min(textLeft, r.left - base.left);
    textRight = Math.max(textRight, r.right - base.left);
  });
  return { sheet, svg, base, textLeft, textRight };
}
function animDraw(p, ms = 340) {
  if (REDUCED_MOTION) return;
  const L = p.getTotalLength();
  p.style.strokeDasharray = L; p.style.strokeDashoffset = L;
  p.getBoundingClientRect();
  p.style.transition = `stroke-dashoffset ${ms}ms cubic-bezier(.3,.7,.3,1)`;
  p.style.strokeDashoffset = 0;
}
function animFade(el, ms = 240, delay = 0) {
  if (REDUCED_MOTION) return;
  const target = el.getAttribute("opacity") || 1;
  el.style.opacity = 0;
  el.getBoundingClientRect();
  el.style.transition = `opacity ${ms}ms ease ${delay}ms`;
  el.style.opacity = target;
}

/* Connectors share the exact contact used by the underline and terminal dot.
 * Binary marks draw one contact-to-contact gesture; multi-member marks leave
 * rounded spine ports and converge directly into each phrase. */

/* ── the one line ────────────────────────────────────────────
 * A clean uniform stroke, the same discipline as the app's underlay:
 * constant width, round caps and joins, no swell, no taper, no wobble.
 * The earlier calligraphic ribbon (0.55→1.15 width profile) was retired
 * with the C0.5 visual amendment — at reading size the swell read as a
 * wedge at every rise and turn. Kind never bends or thickens the line —
 * it only chooses the hue. */
function strokeOutline(pts, frac = 1) {
  const total = pts.length;
  const count = Math.max(2, Math.round(total * Math.min(1, frac)));
  let d = "";
  for (let i = 0; i < count; i++) {
    d += `${i ? "L" : "M"}${pts[i].x.toFixed(2)},${pts[i].y.toFixed(2)}`;
  }
  return d;
}
/* the line draws itself point by point along the centerline */
function ribbonDraw(g, pts, hue, { w = 1.6, opacity = 1, delay = 0, dur = 380, role = "connector", immediate = false } = {}) {
  const p = S("path", {
    d: "", fill: "none", stroke: hue, "stroke-width": w,
    "stroke-linecap": "round", "stroke-linejoin": "round", "data-role": role,
  }, g);
  if (opacity < 1) p.setAttribute("opacity", opacity);
  if (REDUCED_MOTION || immediate) {
    p.setAttribute("d", strokeOutline(pts, 1));
    return p;
  }
  const t0 = performance.now() + delay;
  const ease = (x) => 1 - Math.pow(1 - x, 3);
  function frame(now) {
    if (!p.isConnected) return; // overlay cleared mid-flight
    const u = Math.min(1, Math.max(0, (now - t0) / dur));
    if (u > 0) p.setAttribute("d", strokeOutline(pts, ease(u)));
    if (u < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return p;
}
const ROUTE_KEY = "shape-marks-route";
/* Two views, one connector grammar and one connection card. The overlay is
 * identical in both; the value only picks the page's typographic set.
 * ("bows" is the retired pre-C0.5 value — migrate it forward.) */
let ROUTE = /^(reading|bows)$/.test(localStorage.getItem(ROUTE_KEY) || "") ? "reading" : "traces";
document.body.dataset.route = ROUTE;
let FOCUS_GID = null;
const MAX_MARGIN_TRACES = 4;
const LAST_PLANS = new Map();   // sid → Map(gid → plan) from the last Traces render
const LAST_INKED = new Map();   // sid → Set(companion gids) for lane hysteresis
const LAST_TOPOLOGIES = new Map(); // sid|gid → last valid PAINTED semantic side assignment
const LAST_TICK_LAYOUTS = new Map(); // sid|gid → pre-bloom held tick positions
let TICK_PREVIEW_GID = null;
const TICK_FOCUS_KEYS = new Map();

/* C0.4 is plural-first.  These narrow adapters retain exact C0.3 behavior for
 * non-section plans while keeping every consumer off the compatibility lies
 * (`plan.side`, `plan.spine`) that mixed topologies deliberately omit. */
function planSideRuns(plan) {
  if (!plan?.valid) return [];
  if (Array.isArray(plan.sideRuns)) return plan.sideRuns;
  if ((plan.side === "left" || plan.side === "right") && Number.isInteger(plan.strand)) {
    const legacyExtentYs = [
      plan.markerRanges?.marginStart,
      plan.markerRanges?.marginEnd,
      ...(Array.isArray(plan.ports) ? plan.ports.flatMap((port) => [port?.y]) : []),
    ].filter(Number.isFinite);
    return [{
      id: `${plan.side}:legacy:${plan.strand}`,
      runIndex: 0,
      sectionIds: [],
      side: plan.side,
      strand: plan.strand,
      railX: plan.marginRailX,
      x: plan.marginRailX,
      top: plan.spine?.top ?? (legacyExtentYs.length ? Math.min(...legacyExtentYs) : undefined),
      bottom: plan.spine?.bottom ?? (legacyExtentYs.length ? Math.max(...legacyExtentYs) : undefined),
      spineId: plan.spine ? `${plan.side}:legacy:spine` : null,
    }];
  }
  return [];
}
function planSpines(plan) {
  if (!plan?.valid) return [];
  if (Array.isArray(plan.spines)) return plan.spines;
  return plan.spine ? [{
    ...plan.spine,
    id: `${plan.side || "route"}:legacy:spine`,
    kind: plan.side ? "margin" : "middle",
    side: plan.side || null,
    strand: Number.isInteger(plan.strand) ? plan.strand : null,
  }] : [];
}
function planSpineClaims(plan) {
  if (!plan?.valid) return [];
  if (Array.isArray(plan.spineClaimsOut)) return plan.spineClaimsOut;
  return plan.spineClaimOut ? [plan.spineClaimOut] : [];
}
function planStrandClaims(plan) {
  if (!plan?.valid) return [];
  if (Array.isArray(plan.strandClaimsOut)) return plan.strandClaimsOut;
  return plan.strandClaimOut ? [plan.strandClaimOut] : [];
}
function planCorridorClaims(plan) {
  if (!plan?.valid) return [];
  if (isSectionTopology(plan) && Array.isArray(plan.corridorClaimsOut)) return plan.corridorClaimsOut;
  return Array.isArray(plan.claimsOut) ? plan.claimsOut : [];
}
const isMarginPlan = (plan) => planSideRuns(plan).length > 0;
const isSectionTopology = (plan) => plan?.sectionAware === true || plan?.topology === "sectioned";
const runIdOf = (run, index = 0) => String(run?.id ?? run?.runId ?? `run:${run?.runIndex ?? index}`);
const spineIdOf = (spine, index = 0) => String(spine?.id ?? spine?.spineId ?? `spine:${index}`);
function routeForAnchor(plan, anchor, anchorIndex) {
  if (!isMarginPlan(plan)) return null;
  const candidates = [
    ...(Array.isArray(plan.anchorRuns) ? plan.anchorRuns : []),
    ...(Array.isArray(plan.terminalRoutes) ? plan.terminalRoutes : []),
  ];
  /* Canonical identity wins outright.  A stale positional route must never
   * shadow the later exact owner just because it appeared first. */
  const direct = anchor?.id
    ? candidates.find((route) => route.anchorId === anchor.id)
    : null;
  if (direct?.side === "left" || direct?.side === "right") return direct;
  const runs = planSideRuns(plan);
  /* A valid C0.3/single-section fallback owns one whole route. Incidental
   * source section provenance must not make its held ticks ownerless. */
  if (!isSectionTopology(plan)) {
    const positional = candidates.find((route) =>
      !route?.anchorId && route?.anchorIndex === anchorIndex);
    if (positional?.side === "left" || positional?.side === "right") return positional;
    if (runs.length === 1) return runs[0];
  }
  const sectionId = anchor?.sectionId || anchor?.fragments?.[0]?.sectionId;
  if (isSectionTopology(plan) && runs.length > 1) return null;
  const run = sectionId
    ? runs.find((candidate) => candidate.sectionIds?.includes(sectionId))
    : runs.length === 1 ? runs[0] : null;
  return run && (run.side === "left" || run.side === "right") ? run : null;
}
function topologyMemoryForPlan(plan) {
  const runs = planSideRuns(plan);
  if (!runs.length) return null;
  const seen = new Set();
  const sectionSides = [];
  const declared = Array.isArray(plan.topologyMemory?.sectionSides)
    ? plan.topologyMemory.sectionSides
    : Array.isArray(plan.sectionSides) ? plan.sectionSides : runs.flatMap((run) =>
    (run.sectionIds || []).map((sectionId) => ({ sectionId, side: run.side })));
  for (const item of declared) {
    if (!item?.sectionId || (item.side !== "left" && item.side !== "right") || seen.has(item.sectionId)) continue;
    seen.add(item.sectionId);
    sectionSides.push({ sectionId: item.sectionId, side: item.side });
  }
  return {
    side: runs.length === 1 ? runs[0].side : null,
    sectionSides,
    topologySignature: plan.topologySignature ?? sectionSides,
  };
}
function topologySignatureText(plan) {
  if (!plan?.valid) return "";
  if (typeof plan.topologySignature === "string") return plan.topologySignature;
  const memory = topologyMemoryForPlan(plan);
  return memory ? JSON.stringify(memory.topologySignature) : "";
}
function ownSectionContacts(plan, ann) {
  if (!isSectionTopology(plan) || !ann) return { contacts: plan.contacts || [], errors: [] };
  const errors = [];
  const runs = planSideRuns(plan);
  const runById = new Map(runs.map((run, index) => [runIdOf(run, index), run]));
  const routes = Array.isArray(plan.anchorRuns) ? plan.anchorRuns : [];
  const contacts = Array.isArray(plan.contacts) ? plan.contacts : [];
  const routeByAnchor = new Map();
  const routeIndexes = new Set();
  for (const route of routes) {
    if (!route?.anchorId || routeByAnchor.has(route.anchorId)) {
      errors.push(`anchor-run-id:${route?.anchorId || "missing"}`);
    } else routeByAnchor.set(route.anchorId, route);
    if (!Number.isInteger(route?.anchorIndex) || routeIndexes.has(route.anchorIndex)) {
      errors.push(`anchor-run-index:${route?.anchorIndex ?? "missing"}`);
    } else routeIndexes.add(route.anchorIndex);
  }
  const contactById = new Map();
  const contactByAnchor = new Map();
  for (const contact of contacts) {
    if (!contact?.id || contactById.has(contact.id)) errors.push(`contact-id:${contact?.id || "missing"}`);
    else contactById.set(contact.id, contact);
    if (!contact?.anchorId || contactByAnchor.has(contact.anchorId)) {
      errors.push(`contact-anchor-id:${contact?.anchorId || "missing"}`);
    } else contactByAnchor.set(contact.anchorId, contact);
  }
  /* The engine publishes anchorIndex in canonical document order, independent
   * of caller array order.  Verify against that contract, not input position. */
  const canonicalAnchors = [...ann.anchors].sort((a, b) =>
    a.documentOrder - b.documentOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  canonicalAnchors.forEach((anchor, anchorIndex) => {
    const route = routeByAnchor.get(anchor.id);
    const run = route && runById.get(String(route.runId));
    if (!route || !run || (route.side !== "left" && route.side !== "right")) {
      errors.push(`anchor-run:${anchor.id}`);
      return;
    }
    if (route.anchorId !== anchor.id) errors.push(`anchor-run-anchor:${anchor.id}`);
    const sectionId = anchor.sectionId || anchor.fragments?.[0]?.sectionId;
    if (!sectionId || route.sectionId !== sectionId || !run.sectionIds?.includes(sectionId)) {
      errors.push(`anchor-run-section:${anchor.id}`);
    }
    if (route.side !== run.side || route.strand !== run.strand || String(route.runId) !== runIdOf(run)) {
      errors.push(`anchor-run-owner:${anchor.id}`);
    }
    if (route.anchorIndex !== anchorIndex) errors.push(`anchor-run-order:${anchor.id}`);
    const contact = typeof route.contactId === "string" ? contactById.get(route.contactId) : null;
    const fragment = [...(anchor.fragments || [])].sort((a, b) => a.top - b.top || a.left - b.left)[0];
    if (!contact || contactByAnchor.get(anchor.id) !== contact || !fragment) {
      errors.push(`contact-owner:${anchor.id}`);
      return;
    }
    const expectedMeta = {
      id: route.contactId,
      role: "terminal-contact",
      ownerId: runIdOf(run),
      runId: runIdOf(run),
      spineId: String(run.spineId),
      anchorId: anchor.id,
      sectionId,
    };
    for (const [key, value] of Object.entries(expectedMeta)) {
      if (contact[key] == null || String(contact[key]) !== String(value)) {
        errors.push(`contact-${key}:${anchor.id}`);
      }
    }
    if ((contact.side != null && contact.side !== route.side) ||
        (contact.departureSide != null && contact.departureSide !== route.side)) {
      errors.push(`contact-side:${anchor.id}`);
    }
    const expectedX = route.side === "right" ? fragment.right - 0.5 : fragment.left + 0.5;
    const expectedY = fragment.bottom + 2;
    if (!sameFiniteNumber(contact.x, expectedX, 1.25) || !sameFiniteNumber(contact.y, expectedY, 1.25)) {
      errors.push(`contact-geometry:${anchor.id}`);
    }
  });
  if (routes.length !== ann.anchors.length) errors.push("anchor-run-count");
  if (contacts.length !== ann.anchors.length) errors.push("contact-count");
  return { contacts, errors };
}
function canonicalSegmentEqual(a, b) {
  if (!a || !b || a.id !== b.id || a.type !== b.type || a.role !== b.role || a.ownerId !== b.ownerId) return false;
  const fields = a.type === "C"
    ? ["x1", "y1", "c1x", "c1y", "c2x", "c2y", "x2", "y2"]
    : ["x1", "y1", "x2", "y2"];
  return fields.every((field) => Number.isFinite(a[field]) && Number.isFinite(b[field]) && Math.abs(a[field] - b[field]) < 1e-6);
}
const sameFiniteNumber = (a, b, epsilon = 1e-6) =>
  Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= epsilon;
function sampleHostSegment(segment, step = 0.75) {
  if (segment?.type === "L") {
    const length = Math.hypot(segment.x2 - segment.x1, segment.y2 - segment.y1);
    const count = Math.max(2, Math.ceil(length / step));
    return Array.from({ length: count + 1 }, (_, index) => {
      const t = index / count;
      return {
        x: segment.x1 + (segment.x2 - segment.x1) * t,
        y: segment.y1 + (segment.y2 - segment.y1) * t,
      };
    });
  }
  return sampleHostCubic(segment, step);
}
function sampleHostCubic(segment, step = 0.75) {
  if (segment?.type !== "C") return [];
  const polygonLength = Math.hypot(segment.c1x - segment.x1, segment.c1y - segment.y1) +
    Math.hypot(segment.c2x - segment.c1x, segment.c2y - segment.c1y) +
    Math.hypot(segment.x2 - segment.c2x, segment.y2 - segment.c2y);
  const count = Math.max(8, Math.ceil(polygonLength / step));
  return Array.from({ length: count + 1 }, (_, index) => {
    const t = index / count, u = 1 - t;
    return {
      x: u * u * u * segment.x1 + 3 * u * u * t * segment.c1x +
        3 * u * t * t * segment.c2x + t * t * t * segment.x2,
      y: u * u * u * segment.y1 + 3 * u * u * t * segment.c1y +
        3 * u * t * t * segment.c2y + t * t * t * segment.y2,
    };
  });
}
function expandedHandoffObstacles(block) {
  if (!block) return [];
  const fontSize = Number.isFinite(block.fontSize) ? block.fontSize : 17;
  const expand = Math.max(2.5, fontSize * 0.12) + 2.5;
  const hardRects = block.wordRuns?.length ? block.wordRuns : (block.renderedLines || []);
  return [...hardRects, ...(block.verseNumberRects || []), ...(block.additionalObstacles || [])]
    .filter((rect) => [rect.left, rect.right, rect.top, rect.bottom].every(Number.isFinite))
    .map((rect) => ({
      left: rect.left - expand,
      right: rect.right + expand,
      top: rect.top - expand,
      bottom: rect.bottom + expand,
    }));
}
function claimsMatch(a, b, keys) {
  return keys.every((key) => typeof a?.[key] === "number" || typeof b?.[key] === "number"
    ? sameFiniteNumber(a?.[key], b?.[key])
    : String(a?.[key]) === String(b?.[key]));
}
function validateHostTopology(plan, ann = null, block = null) {
  if (!plan?.valid) return { ok: false, errors: [plan?.reason || "invalid-plan"] };
  const errors = [];
  const finite = (...values) => values.every(Number.isFinite);
  const runs = planSideRuns(plan);
  const spines = planSpines(plan);
  const handoffs = Array.isArray(plan.handoffs) ? plan.handoffs : [];
  const sectioned = isSectionTopology(plan);
  const orderedAnchors = [...(ann?.anchors || [])].sort((a, b) =>
    (a.documentOrder ?? 0) - (b.documentOrder ?? 0) || String(a.id).localeCompare(String(b.id)));
  const anchorSectionSequence = orderedAnchors.map((anchor) => anchor.sectionId).filter(Boolean);
  const activeSections = [...new Set(anchorSectionSequence)];
  const handoffObstacles = expandedHandoffObstacles(block);
  const spineIds = new Set();
  const spineById = new Map();
  spines.forEach((spine, index) => {
    const id = spineIdOf(spine, index);
    if (!id || spineIds.has(id) || (sectioned && (typeof spine?.id !== "string" || !spine.id))) {
      errors.push(`spine-id:${id || "missing"}`);
    }
    spineIds.add(id);
    spineById.set(id, spine);
    if (!finite(spine.x, spine.top, spine.bottom) || spine.bottom < spine.top) errors.push(`spine-bounds:${id}`);
    if (sectioned && !plan.centerline?.some((segment) => segment.role === "spine" && segment.spineId === id)) {
      errors.push(`spine-owner:${id}`);
    }
  });
  const runIds = new Set();
  const runById = new Map();
  runs.forEach((run, index) => {
    const id = runIdOf(run, index);
    if (runIds.has(id) || (sectioned && (typeof run?.id !== "string" || !run.id || run.runIndex !== index))) {
      errors.push(`run-id:${id}`);
    }
    runIds.add(id);
    runById.set(id, run);
    if ((run.side !== "left" && run.side !== "right") || !Number.isInteger(run.strand) || run.strand < 0 || run.strand > 2 ||
        !finite(run.railX, run.x, run.top, run.bottom) || run.bottom < run.top ||
        Math.abs(run.x - run.railX) > 1e-6) errors.push(`run-geometry:${id}`);
    if (sectioned && (!Array.isArray(run.sectionIds) || !run.sectionIds.length)) errors.push(`run-sections:${id}`);
    if (sectioned && (!run.spineId || !spineIds.has(String(run.spineId)))) errors.push(`run-spine:${id}`);
    else if (run.spineId && !spineIds.has(String(run.spineId))) errors.push(`run-spine:${id}`);
  });
  const handoffIds = new Set();
  handoffs.forEach((handoff, index) => {
    const id = String(handoff?.id ?? `handoff:${index}`);
    if (!handoff?.id || handoffIds.has(id)) errors.push(`handoff-id:${id}`);
    handoffIds.add(id);
    const fromRun = runById.get(String(handoff.fromRunId));
    const toRun = runById.get(String(handoff.toRunId));
    const fromSpine = spineById.get(String(handoff.fromSpineId));
    const toSpine = spineById.get(String(handoff.toSpineId));
    if (!handoff.gapId || !fromRun || !toRun || !fromSpine || !toSpine ||
        String(fromRun.spineId) !== String(handoff.fromSpineId) ||
        String(toRun.spineId) !== String(handoff.toSpineId) ||
        !fromRun.sectionIds?.includes(handoff.fromSectionId) ||
        !toRun.sectionIds?.includes(handoff.toSectionId) ||
        fromRun.side === toRun.side || !finite(handoff.from?.x, handoff.from?.y, handoff.to?.x, handoff.to?.y) ||
        Math.abs(handoff.from.x - fromSpine.x) > 1e-6 || Math.abs(handoff.to.x - toSpine.x) > 1e-6) {
      errors.push(`handoff-owner:${id}`);
    }
    /* C0.5: a handoff is a corner–flat-run–corner chain (with optional
     * straight rail continuations), never one page-wide cubic */
    const handoffSegments = plan.centerline?.filter((segment) => segment.role === "handoff" && segment.handoffId === id) || [];
    if (handoffSegments.length < 2 || handoffSegments.length > 5) {
      errors.push(`handoff-segments:${id}`);
    } else if (handoffSegments.some((segment) => segment.fromRunId !== handoff.fromRunId || segment.toRunId !== handoff.toRunId) ||
        !Array.isArray(handoff.segments) || handoff.segments.length !== handoffSegments.length ||
        handoff.segments.some((segment, index) => !canonicalSegmentEqual(segment, handoffSegments[index]))) {
      errors.push(`handoff-segment-owner:${id}`);
    }
    const fromIndex = activeSections.indexOf(handoff.fromSectionId);
    if (fromIndex < 0 || activeSections[fromIndex + 1] !== handoff.toSectionId ||
        fromRun.sectionIds?.at(-1) !== handoff.fromSectionId || toRun.sectionIds?.[0] !== handoff.toSectionId) {
      errors.push(`handoff-adjacency:${id}`);
    }
    const gap = block?.sectionGaps?.find((candidate) => candidate.id === handoff.gapId);
    if (block?.sectionGaps && (!gap || gap.hardClear !== true || gap.fromSectionId !== handoff.fromSectionId ||
        gap.toSectionId !== handoff.toSectionId || handoff.from.y < gap.top || handoff.to.y > gap.bottom ||
        handoff.from.x < gap.left || handoff.from.x > gap.right || handoff.to.x < gap.left || handoff.to.x > gap.right)) {
      errors.push(`handoff-gap:${id}`);
    }
    if (handoffSegments.length >= 2 && gap && fromSpine && toSpine) {
      const first = handoffSegments[0];
      const last = handoffSegments[handoffSegments.length - 1];
      const corners = handoffSegments.filter((segment) => segment.type === "C");
      const flats = handoffSegments.filter((segment) =>
        segment.type === "L" && sameFiniteNumber(segment.y1, segment.y2));
      const chained = handoffSegments.every((segment, index) => index === 0 ||
        (sameFiniteNumber(segment.x1, handoffSegments[index - 1].x2) &&
          sameFiniteNumber(segment.y1, handoffSegments[index - 1].y2)));
      const leaveVertical = first.type === "C"
        ? sameFiniteNumber(first.c1x, first.x1) : sameFiniteNumber(first.x2, first.x1);
      const arriveVertical = last.type === "C"
        ? sameFiniteNumber(last.c2x, last.x2) : sameFiniteNumber(last.x2, last.x1);
      const compactCorners = corners.every((corner) =>
        Math.abs(corner.x2 - corner.x1) <= 6 + 1e-6 && Math.abs(corner.y2 - corner.y1) <= 6 + 1e-6);
      const insideGap = (point) => Number.isFinite(point.x) && Number.isFinite(point.y) &&
        point.x >= gap.left - 1e-6 && point.x <= gap.right + 1e-6 &&
        point.y >= gap.top - 1e-6 && point.y <= gap.bottom + 1e-6;
      const controls = handoffSegments.flatMap((segment) => segment.type === "C"
        ? [{ x: segment.x1, y: segment.y1 }, { x: segment.c1x, y: segment.c1y },
          { x: segment.c2x, y: segment.c2y }, { x: segment.x2, y: segment.y2 }]
        : [{ x: segment.x1, y: segment.y1 }, { x: segment.x2, y: segment.y2 }]);
      if (handoffSegments.some((segment) => segment.type !== "L" && segment.type !== "C") ||
          corners.length !== 2 || !chained || !leaveVertical || !arriveVertical || !compactCorners ||
          (Math.abs(last.x2 - first.x1) > 12 && flats.length !== 1) ||
          !sameFiniteNumber(first.x1, handoff.from.x) || !sameFiniteNumber(first.y1, handoff.from.y) ||
          !sameFiniteNumber(last.x2, handoff.to.x) || !sameFiniteNumber(last.y2, handoff.to.y) ||
          !sameFiniteNumber(first.x1, fromSpine.x) || !sameFiniteNumber(first.y1, fromSpine.bottom) ||
          !sameFiniteNumber(last.x2, toSpine.x) || !sameFiniteNumber(last.y2, toSpine.top) ||
          !(first.y1 < last.y2) ||
          controls.some((point) => !insideGap(point))) {
        errors.push(`handoff-geometry:${id}`);
      } else {
        const samples = handoffSegments.flatMap((segment) => sampleHostSegment(segment));
        if (!samples.length || samples.some((point) => !insideGap(point) || handoffObstacles.some((obstacle) =>
          point.x > obstacle.left && point.x < obstacle.right && point.y > obstacle.top && point.y < obstacle.bottom))) {
          errors.push(`handoff-clearance:${id}`);
        }
      }
    }
  });
  if (sectioned) {
    const parts = Array.isArray(plan.routeParts) ? plan.routeParts : [];
    if (!parts.length) errors.push("route-parts");
    const corridorClaims = Array.isArray(plan.corridorClaimsOut) ? plan.corridorClaimsOut : [];
    const normalizedCorridorClaims = Array.isArray(plan.claimsOut) ? plan.claimsOut : [];
    const spineClaims = Array.isArray(plan.spineClaimsOut) ? plan.spineClaimsOut : [];
    const strandClaims = Array.isArray(plan.strandClaimsOut) ? plan.strandClaimsOut : [];
    const handoffClaims = Array.isArray(plan.handoffClaimsOut) ? plan.handoffClaimsOut : [];
    const allClaimIds = [...corridorClaims, ...spineClaims, ...strandClaims, ...handoffClaims]
      .map((claim) => claim?.id).filter(Boolean);
    if (allClaimIds.length !== corridorClaims.length + spineClaims.length + strandClaims.length + handoffClaims.length ||
        new Set(allClaimIds).size !== allClaimIds.length) errors.push("claim-ids");
    if (corridorClaims.length !== normalizedCorridorClaims.length ||
        corridorClaims.length !== (plan.corridors || []).length ||
        corridorClaims.length !== (plan.corridorIdx || []).length) errors.push("corridor-claim-count");
    corridorClaims.forEach((claim, index) => {
      const run = runById.get(String(claim?.ownerRunId));
      if (!claim?.id || !run || !run.sectionIds?.includes(claim.sectionId) ||
          !Number.isFinite(claim.corridor) || !Number.isFinite(claim.y) ||
          !Number.isFinite(claim.xMin) || !Number.isFinite(claim.xMax) || claim.xMax < claim.xMin ||
          !claimsMatch(claim, normalizedCorridorClaims[index], ["corridor", "y", "xMin", "xMax", "pad"]) ||
          !sameFiniteNumber(claim.corridor, plan.corridorIdx?.[index]) ||
          !sameFiniteNumber(claim.y, plan.corridors?.[index])) {
        errors.push(`corridor-claim:${claim?.id || index}`);
      }
    });
    if (spineClaims.length !== runs.length || strandClaims.length !== runs.length) errors.push("run-claim-count");
    runs.forEach((run, index) => {
      const runId = runIdOf(run, index);
      const spine = spineById.get(String(run.spineId));
      const ownedSpineClaims = spineClaims.filter((claim) => String(claim.ownerRunId) === runId);
      const ownedStrandClaims = strandClaims.filter((claim) => String(claim.ownerRunId) === runId);
      const spineClaim = ownedSpineClaims[0], strandClaim = ownedStrandClaims[0];
      if (ownedSpineClaims.length !== 1 || !spine || !spineClaim?.id || run.spineClaimId !== spineClaim.id ||
          !claimsMatch(spineClaim, {
            side: run.side, strand: run.strand, x: spine.x, top: spine.top, bottom: spine.bottom,
          }, ["side", "strand", "x", "top", "bottom"])) {
        errors.push(`spine-claim:${runId}`);
      }
      if (ownedStrandClaims.length !== 1 || !strandClaim?.id || run.strandClaimId !== strandClaim.id ||
          !claimsMatch(strandClaim, {
            side: run.side, strand: run.strand, top: run.top, bottom: run.bottom,
          }, ["side", "strand", "top", "bottom"])) {
        errors.push(`strand-claim:${runId}`);
      }
      const expectedCorridorIds = corridorClaims.filter((claim) => String(claim.ownerRunId) === runId)
        .map((claim) => claim.id);
      if (!Array.isArray(run.corridorClaimIds) || run.corridorClaimIds.length !== expectedCorridorIds.length ||
          run.corridorClaimIds.some((claimId, claimIndex) => claimId !== expectedCorridorIds[claimIndex])) {
        errors.push(`run-corridor-claims:${runId}`);
      }
    });
    handoffs.forEach((handoff, index) => {
      const owned = handoffClaims.filter((claim) => String(claim.ownerHandoffId) === String(handoff.id));
      const claim = owned[0];
      const expected = {
        gapId: handoff.gapId,
        fromSectionId: handoff.fromSectionId,
        toSectionId: handoff.toSectionId,
        xMin: Math.min(handoff.from.x, handoff.to.x),
        xMax: Math.max(handoff.from.x, handoff.to.x),
        top: handoff.from.y,
        bottom: handoff.to.y,
      };
      if (owned.length !== 1 || !claim?.id || !Number.isFinite(claim.pad) || claim.pad < 0 ||
          !claimsMatch(claim, expected, ["gapId", "fromSectionId", "toSectionId", "xMin", "xMax", "top", "bottom"]) ||
          handoff.claimOut?.id !== claim.id ||
          !claimsMatch(handoff.claimOut, claim, ["gapId", "fromSectionId", "toSectionId", "xMin", "xMax", "top", "bottom", "pad"])) {
        errors.push(`handoff-claim:${handoff.id || index}`);
      }
    });
    if (handoffClaims.length !== handoffs.length) errors.push("handoff-claim-count");
    for (const part of parts.filter((candidate) => candidate.role === "tributary")) {
      const expectedIds = corridorClaims.filter((claim) => String(claim.ownerRunId) === String(part.runId) &&
        claim.sectionId === part.sectionId).map((claim) => claim.id);
      const actualIds = Array.isArray(part.corridorClaimIds) ? part.corridorClaimIds : [];
      if (!expectedIds.length || actualIds.length !== expectedIds.length ||
          actualIds.some((claimId, index) => claimId !== expectedIds[index])) {
        errors.push(`part-corridor-claims:${part.id || "missing"}`);
      }
    }
    if (runs.length === 1 && (!claimsMatch(plan.spineClaimOut, spineClaims[0], ["side", "strand", "x", "top", "bottom"]) ||
        !claimsMatch(plan.strandClaimOut, strandClaims[0], ["side", "strand", "top", "bottom"]))) {
      errors.push("singular-claim-alias");
    }
    if (!activeSections.length || !runs.length) errors.push("active-sections");
    const activeIndex = new Map(activeSections.map((sectionId, index) => [sectionId, index]));
    let previousAnchorSection = -1;
    for (const sectionId of anchorSectionSequence) {
      const sectionIndex = activeIndex.get(sectionId);
      if (sectionIndex == null || sectionIndex < previousAnchorSection) errors.push("anchor-section-order");
      previousAnchorSection = sectionIndex ?? previousAnchorSection;
    }
    if (Array.isArray(block?.sections)) {
      const declaredIds = [...block.sections]
        .sort((a, b) => a.documentOrder - b.documentOrder || String(a.id).localeCompare(String(b.id)))
        .map((section) => section.id);
      if (new Set(declaredIds).size !== declaredIds.length) errors.push("declared-section-ids");
      const activeSet = new Set(activeSections);
      const declaredActive = declaredIds.filter((sectionId) => activeSet.has(sectionId));
      if (declaredActive.length !== activeSections.length ||
          declaredActive.some((sectionId, index) => sectionId !== activeSections[index])) {
        errors.push("active-section-order");
      }
    }
    const runSectionSequence = runs.flatMap((run) => run.sectionIds || []);
    if (runSectionSequence.length !== activeSections.length ||
        runSectionSequence.some((sectionId, index) => sectionId !== activeSections[index])) {
      errors.push("run-section-bijection");
    }
    const expectedSectionSides = runs.flatMap((run) =>
      (run.sectionIds || []).map((sectionId) => ({ sectionId, side: run.side })));
    for (const declaredSides of [plan.sectionSides, plan.topologyMemory?.sectionSides]) {
      if (!Array.isArray(declaredSides) || declaredSides.length !== expectedSectionSides.length ||
          declaredSides.some((item, index) => item?.sectionId !== expectedSectionSides[index].sectionId ||
            item?.side !== expectedSectionSides[index].side)) errors.push("topology-section-sides");
    }
    const expectedTopologySignature = `section-topology:v1|${runs.flatMap((run) =>
      (run.sectionIds || []).map((sectionId) => `${routeInternals.stableIdPart(sectionId)}:${run.side[0]}${run.strand}`)).join("|")}`;
    if (plan.topologySignature !== expectedTopologySignature ||
        plan.topologyMemory?.topologySignature !== plan.topologySignature) errors.push("topology-signature");
    if (spines.length !== runs.length) errors.push("run-spine-count");
    runs.forEach((run, index) => {
      const runId = runIdOf(run, index);
      const ownedSpines = spines.filter((spine, spineIndex) =>
        spineIdOf(spine, spineIndex) === String(run.spineId));
      const spine = ownedSpines[0];
      if (ownedSpines.length !== 1 || !spine || String(spine.runId ?? spine.ownerRunId) !== runId ||
          spine.side !== run.side || spine.strand !== run.strand || Math.abs(spine.x - run.railX) > 1e-6 ||
          spine.top !== run.top || spine.bottom !== run.bottom ||
          (spine.sectionIds || []).length !== run.sectionIds.length ||
          (spine.sectionIds || []).some((sectionId, sectionIndex) => sectionId !== run.sectionIds[sectionIndex])) {
        errors.push(`run-spine-owner:${runId}`);
      }
      if (index > 0 && runs[index - 1].side === run.side) errors.push(`run-not-maximal:${runId}`);
    });
    if (handoffs.length !== Math.max(0, runs.length - 1)) errors.push("handoff-count");
    for (let index = 0; index < runs.length - 1; index++) {
      const handoff = handoffs[index];
      if (!handoff || String(handoff.fromRunId) !== runIdOf(runs[index], index) ||
          String(handoff.toRunId) !== runIdOf(runs[index + 1], index + 1)) {
        errors.push(`handoff-order:${index}`);
      }
    }
    const partIdSet = new Set();
    const centerline = plan.centerline || [];
    const centerlineIds = centerline.map((segment) => segment.id).filter(Boolean);
    const centerlineById = new Map(centerline.map((segment) => [segment.id, segment]));
    if (centerlineIds.length !== centerline.length || centerlineById.size !== centerline.length) errors.push("centerline-ids");
    const ports = Array.isArray(plan.ports) ? plan.ports : [];
    const portIds = ports.map((port) => port?.id).filter(Boolean);
    if (portIds.length !== ports.length || new Set(portIds).size !== ports.length) errors.push("port-ids");
    const tributaryPorts = ports.filter((port) => port.role === "tributary-port");
    const expectedTributaryPorts = centerline.filter((segment) => {
      if (segment.role !== "tributary") return false;
      const run = runById.get(String(segment.runId));
      const spine = run && spineById.get(String(run.spineId));
      return Boolean(spine && sameFiniteNumber(segment.x2, spine.x) &&
        segment.y2 >= spine.top - 1e-6 && segment.y2 <= spine.bottom + 1e-6);
    });
    if (tributaryPorts.length !== expectedTributaryPorts.length) errors.push("tributary-port-count");
    const matchedTributarySegments = new Set();
    for (const port of tributaryPorts) {
      const run = runById.get(String(port.runId));
      const spine = run && spineById.get(String(run.spineId));
      const match = expectedTributaryPorts.find((segment) => !matchedTributarySegments.has(segment.id) &&
        String(segment.runId) === String(port.runId) && segment.sectionId === port.sectionId &&
        sameFiniteNumber(segment.x2, port.x) && sameFiniteNumber(segment.y2, port.y));
      if (!run || !spine || port.ownerId !== runIdOf(run) || String(port.spineId) !== String(spine.id) ||
          !run.sectionIds?.includes(port.sectionId) || !sameFiniteNumber(port.x, spine.x) || !match) {
        errors.push(`tributary-port:${port.id || "missing"}`);
      } else matchedTributarySegments.add(match.id);
    }
    for (const handoff of handoffs) {
      const ownedPorts = ports.filter((port) => port.role === "handoff-port" && port.handoffId === handoff.id);
      const expected = [
        { point: handoff.from, runId: handoff.fromRunId, spineId: handoff.fromSpineId },
        { point: handoff.to, runId: handoff.toRunId, spineId: handoff.toSpineId },
      ];
      if (ownedPorts.length !== 2 || expected.some((owner) => !ownedPorts.some((port) =>
        port.ownerId === handoff.id && String(port.runId) === String(owner.runId) &&
        String(port.spineId) === String(owner.spineId) && sameFiniteNumber(port.x, owner.point.x) &&
        sameFiniteNumber(port.y, owner.point.y)))) errors.push(`handoff-ports:${handoff.id}`);
    }
    if (ports.some((port) => port.role !== "tributary-port" && port.role !== "handoff-port") ||
        ports.length !== tributaryPorts.length + handoffs.length * 2) errors.push("port-roles");
    const partSegments = parts.flatMap((part) => Array.isArray(part.segments) ? part.segments : []);
    const partIds = partSegments.map((segment) => segment.id).filter(Boolean);
    if (partSegments.length !== (plan.centerline || []).length || centerlineIds.length !== partIds.length) {
      errors.push("route-part-coverage");
    }
    for (const id of centerlineIds) {
      if (partIds.filter((candidate) => candidate === id).length !== 1) errors.push(`route-part-owner:${id}`);
    }
    for (const [spineId, spine] of spineById) {
      const spineSegments = centerline.filter((segment) => segment.role === "spine" && String(segment.spineId) === spineId);
      const spineParts = parts.filter((part) => part.role === "spine" && String(part.spineId) === spineId);
      if (spineSegments.length !== 1 || spineParts.length !== 1 ||
          spineSegments[0]?.ownerId !== spine.id || String(spineSegments[0]?.runId) !== String(spine.runId) ||
          spineParts[0]?.ownerId !== spine.id || String(spineParts[0]?.runId) !== String(spine.runId)) {
        errors.push(`spine-cardinality:${spineId}`);
      }
    }
    for (const segment of centerline.filter((candidate) => candidate.role === "spine")) {
      if (!spineById.has(String(segment.spineId))) errors.push(`spine-segment-owner:${segment.id || "missing"}`);
    }
    for (const part of parts.filter((candidate) => candidate.role === "spine")) {
      if (!spineById.has(String(part.spineId))) errors.push(`spine-part-owner:${part.id || "missing"}`);
    }
    const allowedRoles = new Set(["tributary", "spine", "handoff"]);
    if (centerline.some((segment) => !allowedRoles.has(segment.role)) ||
        parts.some((part) => !allowedRoles.has(part.role))) errors.push("route-role-grammar");
    for (const sectionId of activeSections) {
      const sectionParts = parts.filter((part) => part.role === "tributary" && part.sectionId === sectionId);
      const run = runs.find((candidate) => candidate.sectionIds?.includes(sectionId));
      if (sectionParts.length !== 1 || !run || sectionParts[0]?.ownerId !== runIdOf(run) ||
          String(sectionParts[0]?.runId) !== runIdOf(run)) errors.push(`tributary-cardinality:${sectionId}`);
    }
    for (const part of parts.filter((candidate) => candidate.role === "tributary")) {
      const run = runById.get(String(part.runId));
      if (!run || part.ownerId !== runIdOf(run) || !run.sectionIds?.includes(part.sectionId)) {
        errors.push(`tributary-owner:${part.id || "missing"}`);
      }
    }
    for (const handoff of handoffs) {
      const handoffParts = parts.filter((part) => part.role === "handoff" && part.handoffId === handoff.id);
      /* C0.5: one part per handoff, carrying the 2–5 segment
       * corner–flat-run–corner chain with exactly two rounded turns */
      if (handoffParts.length !== 1 || handoffParts[0]?.ownerId !== handoff.id ||
          !(handoffParts[0]?.segments?.length >= 2 && handoffParts[0].segments.length <= 5) ||
          handoffParts[0].segments.filter((segment) => segment.type === "C").length !== 2) {
        errors.push(`handoff-part-cardinality:${handoff.id}`);
      }
    }
    for (const part of parts.filter((candidate) => candidate.role === "handoff")) {
      if (!handoffs.some((handoff) => handoff.id === part.handoffId && handoff.id === part.ownerId)) {
        errors.push(`handoff-part-owner:${part.id || "missing"}`);
      }
    }
    for (const segment of centerline.filter((candidate) => candidate.role === "handoff")) {
      if (!handoffs.some((handoff) => handoff.id === segment.handoffId && handoff.id === segment.ownerId)) {
        errors.push(`handoff-segment-orphan:${segment.id || "missing"}`);
      }
    }
    for (const part of parts) {
      if (!part.id || !part.role || !part.ownerId || !Array.isArray(part.segments) || !part.segments.length) {
        errors.push(`route-part:${part.id || "missing"}`);
      }
      if (partIdSet.has(part.id)) errors.push(`route-part-id:${part.id}`);
      partIdSet.add(part.id);
      const requiredKeys = part.role === "tributary" ? ["runId", "sectionId"] :
        part.role === "spine" ? ["runId", "spineId"] : part.role === "handoff" ? ["handoffId"] : [];
      for (const key of requiredKeys) if (part[key] == null || part[key] === "") errors.push(`route-part-${key}:${part.id}`);
      for (const segment of part.segments || []) {
        if (!canonicalSegmentEqual(segment, centerlineById.get(segment.id))) errors.push(`route-part-segment:${segment.id || "missing"}`);
        if (segment.role !== part.role || segment.ownerId !== part.ownerId) errors.push(`route-part-metadata:${part.id}`);
        for (const key of ["runId", "spineId", "handoffId", "sectionId"]) {
          if (part[key] != null && String(segment[key]) !== String(part[key])) errors.push(`route-part-${key}:${part.id}`);
        }
      }
      if (part.role === "spine") {
        const segment = part.segments?.[0];
        const spine = spineById.get(String(part.spineId));
        if (part.segments?.length !== 1 || !spine || segment?.type !== "L" ||
            Math.abs(segment.x1 - segment.x2) > 1e-6 || Math.abs(segment.x1 - spine.x) > 1e-6 ||
            Math.abs(Math.min(segment.y1, segment.y2) - spine.top) > 1e-6 ||
            Math.abs(Math.max(segment.y1, segment.y2) - spine.bottom) > 1e-6) errors.push(`spine-part:${part.id}`);
      }
    }
    for (const part of parts.filter((candidate) => candidate.role === "tributary")) {
      const run = runById.get(String(part.runId));
      const spine = run && spineById.get(String(run.spineId));
      const claims = corridorClaims.filter((claim) => String(claim.ownerRunId) === String(part.runId) &&
        claim.sectionId === part.sectionId);
      const components = [];
      let component = [];
      for (const segment of part.segments || []) {
        const prior = component.at(-1);
        if (prior && Math.hypot(segment.x1 - prior.x2, segment.y1 - prior.y2) > 1.5) {
          components.push(component);
          component = [];
        }
        component.push(segment);
      }
      if (component.length) components.push(component);
      const facts = components.map((segments) => {
        const points = segments.flatMap((segment) => segPtsFor(segment));
        const endpoint = segments.at(-1);
        const ownedPort = tributaryPorts.find((port) => String(port.runId) === String(part.runId) &&
          port.sectionId === part.sectionId && sameFiniteNumber(port.x, endpoint?.x2) &&
          sameFiniteNumber(port.y, endpoint?.y2));
        return {
          segments,
          points,
          reachesSpine: Boolean(spine && ownedPort && sameFiniteNumber(endpoint?.x2, spine.x) &&
            endpoint.y2 >= spine.top - 1e-6 && endpoint.y2 <= spine.bottom + 1e-6),
          minX: points.length ? Math.min(...points.map((point) => point.x)) : Infinity,
          maxX: points.length ? Math.max(...points.map((point) => point.x)) : -Infinity,
        };
      });
      const carriers = facts.filter((fact) => fact.reachesSpine);
      if (!spine || !claims.length || carriers.length !== claims.length) {
        errors.push(`corridor-claim-carriers:${part.id}`);
        continue;
      }
      const usedCarriers = new Set();
      for (const claim of claims) {
        const owns = (fact) => fact.points.some((point) => sameFiniteNumber(point.y, claim.y, 0.05)) &&
          fact.minX >= claim.xMin - 0.05 && fact.maxX <= claim.xMax + 0.05;
        const carrierIndex = carriers.findIndex((fact, index) => !usedCarriers.has(index) && owns(fact));
        if (carrierIndex < 0 || claim.xMin > spine.x + 0.05 || claim.xMax < spine.x - 0.05) {
          errors.push(`corridor-claim-geometry:${claim.id}`);
        } else {
          usedCarriers.add(carrierIndex);
          const carrier = carriers[carrierIndex];
          const start = carrier.segments[0];
          const contact = (plan.contacts || []).find((candidate) =>
            sameFiniteNumber(candidate.x, start.x1, 0.05) && sameFiniteNumber(candidate.y, start.y1, 0.05));
          const anchor = contact && ann?.anchors?.find((candidate) => candidate.id === contact.anchorId);
          const fragment = anchor?.fragments?.length
            ? [...anchor.fragments].sort((a, b) => a.top - b.top || a.left - b.left)[0]
            : null;
          const lines = [...(block?.renderedLines || [])].sort((a, b) => a.top - b.top || a.documentOrder - b.documentOrder);
          let expectedCorridor = null;
          if (fragment && lines.length) {
            const center = (fragment.top + fragment.bottom) / 2;
            let nearest = 0, distance = Infinity;
            lines.forEach((line, index) => {
              const candidateDistance = Math.abs((line.top + line.bottom) / 2 - center);
              if (candidateDistance < distance) { distance = candidateDistance; nearest = index; }
            });
            expectedCorridor = nearest + 1;
          }
          if (!contact || contact.sectionId !== part.sectionId ||
              !Number.isInteger(expectedCorridor) || claim.corridor !== expectedCorridor) {
            errors.push(`corridor-claim-index:${claim.id}`);
          }
        }
      }
      if (facts.some((fact) => !claims.some((claim) => fact.points.some((point) =>
        sameFiniteNumber(point.y, claim.y, 0.05)) && fact.minX >= claim.xMin - 0.05 &&
        fact.maxX <= claim.xMax + 0.05))) errors.push(`tributary-claim-coverage:${part.id}`);
    }
    const contactOwnership = ownSectionContacts(plan, ann);
    errors.push(...contactOwnership.errors);
    for (const contact of contactOwnership.contacts) {
      if (!contact.id || contact.role !== "terminal-contact" || !contact.ownerId || !contact.anchorId ||
          !contact.sectionId || !contact.runId || !contact.spineId) errors.push("contact-metadata");
    }
    if (runs.length > 1 && (plan.side != null || plan.strand != null || plan.marginRailX != null ||
        plan.spine != null || plan.spineClaimOut != null || plan.strandClaimOut != null)) {
      errors.push("mixed-singular-alias");
    }
  }
  return { ok: errors.length === 0, errors };
}
function hostValidatedPlan(plan, ann, block = null) {
  if (!plan?.valid) return plan;
  const validation = validateHostTopology(plan, ann, block);
  return validation.ok ? plan : {
    ...plan,
    valid: false,
    reason: "host-topology-invalid",
    hostValidationErrors: [...new Set(validation.errors)],
  };
}

function commitHeldShape(gid) {
  if (!gid || !GIDS[gid]) return;
  pinned.add(gid);
  FOCUS_GID = gid;
  hovered.delete(gid);
  TICK_PREVIEW_GID = null;
  applyActive();
  /* keyboard focus hands off from the rail tick into the card it opened */
  const card = CARDS[GIDS[gid].study];
  if (card?.classList.contains("on")) card.focus({ preventScroll: true });
}

/* ── the Loom engine host (Traces view) ─────────────────────
 * Measurement and weave helpers matching route-lab.js: ink-tightened
 * lines, word-run collision truth, exact crossings. The engine plans;
 * the ribbon draws. */
function inkSlackFor(el) {
  const cs = getComputedStyle(el);
  const key = `${cs.fontWeight}|${cs.fontSize}|${cs.fontFamily}`;
  const cache = inkSlackFor._cache || (inkSlackFor._cache = new Map());
  const hit = cache.get(key);
  if (hit) return hit;
  const ctx = (inkSlackFor._canvas || (inkSlackFor._canvas = document.createElement("canvas"))).getContext("2d");
  ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const m = ctx.measureText("Mahglpqy");
  const val = {
    top: Math.max(0, m.fontBoundingBoxAscent - m.actualBoundingBoxAscent),
    bottom: Math.max(0, m.fontBoundingBoxDescent - m.actualBoundingBoxDescent),
  };
  cache.set(key, val);
  return val;
}
function mergeInkLines(rects, tol = 2) {
  const out = [];
  for (const r of rects) {
    if (r.width < 1 || r.height < 1) continue;
    const cy = (r.top + r.bottom) / 2;
    const hit = out.find((o) => Math.abs((o.top + o.bottom) / 2 - cy) <= tol);
    if (hit) {
      hit.left = Math.min(hit.left, r.left); hit.right = Math.max(hit.right, r.right);
      hit.top = Math.min(hit.top, r.top); hit.bottom = Math.max(hit.bottom, r.bottom);
    } else out.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
  }
  return out;
}
function renderedLinesFromWordRuns(wordRuns) {
  const rows = new Map();
  for (const run of wordRuns) {
    const key = run.sourceRef || `row-${run.rowOrder ?? 0}`;
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push(run);
  }
  const out = [];
  const orderedRows = [...rows.entries()].sort(([, a], [, b]) =>
    (a[0]?.rowOrder ?? 0) - (b[0]?.rowOrder ?? 0));
  let documentOrder = 0;
  for (const [sourceRef, runs] of orderedRows) {
    const sectionId = runs[0]?.sectionId;
    const chapterId = runs[0]?.chapterId;
    const lines = mergeInkLines(runs, 3).sort((a, b) => a.top - b.top || a.left - b.left);
    lines.forEach((line, lineIndex) => out.push({
      ...line,
      id: `${sourceRef}:line:${lineIndex}`,
      sourceRef,
      chapterId,
      documentOrder: documentOrder++,
      ...(sectionId ? { sectionId } : {}),
    }));
  }
  return out;
}

/* Measure only the whitespace the browser actually rendered between adjacent
 * declared Revelation letters.  A gap grants the planner permission to try;
 * headings remain obstacles, so declaration never substitutes for clearance. */
function measuredSectionTopology(sid, M) {
  if (sid !== "rev") return { sections: [], sectionGaps: [] };
  const rel = (r) => ({
    left: r.left - M.base.left, right: r.right - M.base.left,
    top: r.top - M.base.top, bottom: r.bottom - M.base.top,
  });
  const sections = [];
  for (const source of REVELATION_SECTIONS) {
    const rows = [...M.sheet.querySelectorAll(`.vrow[data-section-id="${source.id}"]`)];
    const head = M.sheet.querySelector(`.letter-head[data-section-id="${source.id}"]`);
    if (!rows.length || !head) continue;
    const rects = [head, ...rows].map((el) => rel(el.getBoundingClientRect()));
    const left = Math.min(...rects.map((r) => r.left));
    const right = Math.max(...rects.map((r) => r.right));
    const top = Math.min(...rects.map((r) => r.top));
    const bottom = Math.max(...rects.map((r) => r.bottom));
    if (![left, right, top, bottom].every(Number.isFinite) || right <= left || bottom <= top) continue;
    sections.push({
      id: source.id,
      label: source.label,
      order: source.order,
      documentOrder: source.order,
      firstRef: source.firstRef,
      lastRef: source.lastRef,
      firstChapterId: source.firstChapterId,
      lastChapterId: source.lastChapterId,
      left,
      right,
      top,
      bottom,
    });
  }
  sections.sort((a, b) => a.order - b.order);
  const sectionGaps = [];
  for (let i = 0; i < sections.length - 1; i++) {
    const before = sections[i], after = sections[i + 1];
    const top = before.bottom, bottom = after.top;
    if (![top, bottom].every(Number.isFinite) || bottom <= top) continue;
    const id = `rev23:gap:${sectionSlug(before.label)}:${sectionSlug(after.label)}`;
    sectionGaps.push({
      id,
      order: i,
      documentOrder: i,
      beforeSectionId: before.id,
      afterSectionId: after.id,
      /* Temporary aliases keep the measured host contract readable to both
       * C0.4 consumers while the pure TypeScript port is still deferred. */
      fromSectionId: before.id,
      toSectionId: after.id,
      left: 0,
      right: M.base.width,
      top,
      bottom,
      hardClear: true,
    });
    const nextHead = M.sheet.querySelector(`.letter-head[data-section-id="${after.id}"]`);
    if (nextHead) nextHead.dataset.gapBeforeId = id;
  }
  return { sections, sectionGaps };
}
function blockFor(sid, M) {
  const rel = (r) => ({ left: r.left - M.base.left, right: r.right - M.base.left, top: r.top - M.base.top, bottom: r.bottom - M.base.top });
  /* word runs cache on layout dimensions — focus/hover replans reuse it */
  const wrKey = `c04|${sid}|${M.base.width}x${M.sheet.scrollHeight}|${ROUTE}`;
  const wrCache = blockFor._wr || (blockFor._wr = new Map());
  let geometry = wrCache.get(wrKey);
  if (!geometry) {
    const wordRuns = [];
    const range = document.createRange();
    M.sheet.querySelectorAll(".vrow .vtext").forEach((el, rowOrder) => {
      const row = el.closest(".vrow");
      const sectionId = row?.dataset.sectionId || null;
      const sourceRef = row?.dataset.key || `${sid}:row:${rowOrder}`;
      const chapterId = row?.dataset.chapterId || null;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node;
      let wordOrder = 0;
      while ((node = walker.nextNode())) {
        const text = node.nodeValue || "";
        if (!text.trim()) continue;
        const s = inkSlackFor(node.parentElement);
        const re = /\S+/g;
        let mt;
        while ((mt = re.exec(text))) {
          range.setStart(node, mt.index);
          range.setEnd(node, mt.index + mt[0].length);
          for (const r of range.getClientRects()) {
            if (r.width <= 0.4 || r.height <= 1) continue;
            const rr = rel(r);
            wordRuns.push({
              left: rr.left, right: rr.right,
              top: rr.top + s.top, bottom: rr.bottom - s.bottom,
              id: `${sourceRef}:word:${wordOrder++}`,
              sourceRef,
              chapterId,
              rowOrder,
              ...(sectionId ? { sectionId } : {}),
            });
          }
        }
      }
    });
    const renderedLines = renderedLinesFromWordRuns(wordRuns);
    const { sections, sectionGaps } = measuredSectionTopology(sid, M);
    geometry = { wordRuns, renderedLines, sections, sectionGaps };
    wrCache.set(wrKey, geometry);
    if (wrCache.size > 12) wrCache.delete(wrCache.keys().next().value);
  }
  /* rendered lines come FROM the word runs — ink truth for any markup
   * (the qa sheet's synthetic blocks return line-box element rects,
   * which lie about leading; words never do) */
  const { wordRuns, renderedLines, sections, sectionGaps } = geometry;
  const verseNumberRects = [...M.sheet.querySelectorAll(".vnum")].map((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const r = range.getClientRects()[0] || el.getBoundingClientRect();
    return rel(r);
  });
  const additionalObstacles = [...M.sheet.querySelectorAll(".chap-head, .letter-head, .sheet-title, .sheet-ref, .legend, .mark-hint")]
    .map((el, index) => ({
      ...rel(el.getBoundingClientRect()),
      id: el.dataset.sectionId
        ? `shape-section-head:${el.dataset.sectionId}`
        : el.dataset.chapterId ? `shape-chapter-head:${el.dataset.chapterId}` : `shape-obstacle:${sid}:${index}`,
      role: el.dataset.sourceRole || (el.classList.contains("sheet-title") ? "title" : "support"),
      ...(el.dataset.sectionId ? { sectionId: el.dataset.sectionId } : {}),
    }))
    .filter((r) => r.right - r.left > 1 && r.bottom - r.top > 1);
  return {
    bounds: { left: 0, right: M.base.width, top: 0, bottom: M.base.height },
    renderedLines, wordRuns, verseNumberRects, additionalObstacles,
    ...(sections.length ? { sections, sectionGaps } : {}),
    fontSize: parseFloat(getComputedStyle(M.sheet.querySelector(".vtext")).fontSize) || 17,
    lineHeight: parseFloat(getComputedStyle(M.sheet.querySelector(".vtext")).lineHeight) || 26,
    availableLeftMargin: Math.max(60, M.textLeft - 8),
    availableRightMargin: Math.max(30, M.base.width - M.textRight - 8),
    preferredMargin: "left",
  };
}
function annFor(M, gid) {
  const rel = (r) => ({ left: r.left - M.base.left, right: r.right - M.base.left, top: r.top - M.base.top, bottom: r.bottom - M.base.top });
  const G = GIDS[gid];
  const anchors = [];
  G.anchors.forEach((anchor, ki) => {
    const els = anchor.els || [anchor.el];
    const rects = els.flatMap((el) => [...el.getClientRects()].map(rel));
    if (!rects.length) return;
    const s = inkSlackFor(els[0].closest(".vtext") || els[0]);
    const section = anchor.sectionId
      ? REVELATION_SECTIONS.find((candidate) => candidate.id === anchor.sectionId) || null
      : routingSectionFor(G.study, anchor.ref);
    const sectionId = section?.id || anchor.sectionId || null;
    anchors.push({
      id: `${gid}:${ki}`,
      sourceRef: anchor.ref,
      fragments: mergeInkLines(rects).map((r, fragmentIndex) => ({
        left: r.left, right: r.right,
        top: r.top + s.top, bottom: r.bottom - s.bottom,
        id: `${gid}:${ki}:fragment:${fragmentIndex}`,
        sourceLineId: `${anchor.ref}:line:${fragmentIndex}`,
        ...(sectionId ? { sectionId } : {}),
      })),
      documentOrder: ki,
      ...(sectionId ? { sectionId } : {}),
    });
  });
  return { id: gid, anchors };
}
/* exact weave crossings (route-lab.js twins) */
function solveCubicYAtX(s, x) {
  const minX = Math.min(s.x1, s.x2), maxX = Math.max(s.x1, s.x2);
  if (x < minX - 0.001 || x > maxX + 0.001) return null;
  let lo = 0, hi = 1;
  const dec = s.x2 < s.x1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2, u = 1 - mid;
    const px = u * u * u * s.x1 + 3 * u * u * mid * s.c1x + 3 * u * mid * mid * s.c2x + mid * mid * mid * s.x2;
    if ((dec && px > x) || (!dec && px < x)) lo = mid;
    else hi = mid;
  }
  const t = (lo + hi) / 2, u = 1 - t;
  return u * u * u * s.y1 + 3 * u * u * t * s.c1y + 3 * u * t * t * s.c2y + t * t * t * s.y2;
}
function crossingsAt(plan, x) {
  const ys = [];
  for (const s of plan.centerline) {
    if (s.type === "L") {
      if (Math.abs(s.y2 - s.y1) < 0.01 &&
          x >= Math.min(s.x1, s.x2) - 0.001 && x <= Math.max(s.x1, s.x2) + 0.001) ys.push(s.y1);
    } else {
      const y = solveCubicYAtX(s, x);
      if (y !== null) ys.push(y);
    }
  }
  return ys;
}
function splitSpine(spine, gapCenters) {
  if (!spine) return [];
  const y1 = spine.top, y2 = spine.bottom;
  if (y2 - y1 < 0.01) return [];
  const intervals = gapCenters
    .map((y) => [Math.max(y1, y - 1.7), Math.min(y2, y + 1.7)])
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const iv of intervals) {
    const prev = merged[merged.length - 1];
    if (prev && iv[0] <= prev[1] + 0.2) prev[1] = Math.max(prev[1], iv[1]);
    else merged.push([...iv]);
  }
  const segments = [];
  let cursor = y1;
  for (const [a, b] of merged) {
    if (a - cursor > 0.25) segments.push([cursor, a]);
    cursor = Math.max(cursor, b);
  }
  if (y2 - cursor > 0.25) segments.push([cursor, y2]);
  return segments;
}

function placeHeldTick(side, rawX, rawY, used, width, height) {
  const outward = side === "right" ? 1 : -1;
  const minX = 5.5, maxX = Math.max(minX, width - 5.5);
  const baseX = Math.max(minX, Math.min(maxX, rawX));
  const free = (x, y) => !used.some((u) =>
    u.side === side && Math.abs(u.y - y) < 2.5 && Math.abs(u.x - x) < 1);
  for (let step = 0; step < 24; step++) {
    const x = baseX + outward * step * 7;
    if (x < minX || x > maxX) break;
    if (free(x, rawY)) return { x, y: rawY, side, stacked: step > 0 };
  }
  const minY = 6, maxY = Math.max(minY, height - 6);
  for (let step = 1; step < 24; step++) {
    for (const sign of [-1, 1]) {
      const y = rawY + sign * step * 12;
      if (y >= minY && y <= maxY && free(baseX, y)) {
        return { x: baseX, y, side, stacked: true };
      }
    }
  }
  return { x: baseX, y: Math.max(minY, Math.min(maxY, rawY)), side, stacked: true };
}
function segPtsFor(s) {
  const pts = [];
  if (s.type === "L") {
    const n = Math.max(1, Math.ceil(Math.hypot(s.x2 - s.x1, s.y2 - s.y1) / 1.5));
    for (let i = 0; i <= n; i++) pts.push({ x: s.x1 + (s.x2 - s.x1) * (i / n), y: s.y1 + (s.y2 - s.y1) * (i / n) });
  } else {
    for (let i = 0; i <= 14; i++) {
      const t = i / 14, u = 1 - t;
      pts.push({
        x: u * u * u * s.x1 + 3 * u * u * t * s.c1x + 3 * u * t * t * s.c2x + t * t * t * s.x2,
        y: u * u * u * s.y1 + 3 * u * u * t * s.c1y + 3 * u * t * t * s.c2y + t * t * t * s.y2,
      });
    }
  }
  return pts;
}
/* the route explains itself — shapes wording over engine facts */
/* warm the measurement caches while the page is idle, so the first wake
 * of a big sheet (51 verses in Long mode) doesn't pay the word walk */
function warmBlocks() {
  const idle = globalThis.requestIdleCallback || ((fn) => setTimeout(fn, 180));
  for (const sid of Object.keys(SHEETS)) {
    idle(() => {
      const sheet = document.querySelector(`[data-sheet="${sid}"]`);
      if (!sheet || sheet.closest("[hidden]")) return;
      try { blockFor(sid, measure(sid)); } catch (e) { /* sheet mid-rebuild */ }
    });
  }
}

function routeQaDiagnostics(sid) {
  const plans = LAST_PLANS.get(sid) || new Map();
  return [...plans.entries()].map(([gid, plan]) => ({
    gid,
    valid: Boolean(plan?.valid),
    reason: plan?.reason || null,
    mode: plan?.mode || null,
    topology: plan?.topology || "legacy",
    score: plan?.score ?? null,
    scoreRaw: plan?.scoreRaw ?? null,
    rawLength: plan?.rawLength ?? null,
    topologySignature: plan?.topologySignature || null,
    hostValidationErrors: (plan?.hostValidationErrors || []).slice(0, 8),
    paintValidation: plan?.paintValidation ? {
      ok: plan.paintValidation.ok,
      errors: (plan.paintValidation.errors || []).slice(0, 8),
      partCount: plan.paintValidation.partCount ?? null,
      pathCount: plan.paintValidation.pathCount ?? null,
      nativePathLength: plan.paintValidation.nativePathLength ?? null,
      semanticPathLength: plan.paintValidation.semanticPathLength ?? null,
      visiblePathLength: plan.paintValidation.visiblePathLength ?? null,
      maskHoleCount: plan.paintValidation.maskHoleCount ?? null,
      minVisibleRatio: plan.paintValidation.minVisibleRatio ?? null,
      minSpineCoverage: plan.paintValidation.minSpineCoverage ?? null,
    } : null,
    finalPaintValidation: plan?.finalPaintValidation ? {
      ok: plan.finalPaintValidation.ok,
      errors: (plan.finalPaintValidation.errors || []).slice(0, 8),
      partCount: plan.finalPaintValidation.partCount ?? null,
      pathCount: plan.finalPaintValidation.pathCount ?? null,
      nativePathLength: plan.finalPaintValidation.nativePathLength ?? null,
      semanticPathLength: plan.finalPaintValidation.semanticPathLength ?? null,
      visiblePathLength: plan.finalPaintValidation.visiblePathLength ?? null,
      maskHoleCount: plan.finalPaintValidation.maskHoleCount ?? null,
      minVisibleRatio: plan.finalPaintValidation.minVisibleRatio ?? null,
      minSpineCoverage: plan.finalPaintValidation.minSpineCoverage ?? null,
    } : null,
    sideRuns: planSideRuns(plan).map((run) => ({
      id: runIdOf(run), sectionIds: [...(run.sectionIds || [])], side: run.side,
      strand: run.strand, railX: run.railX,
    })),
    handoffs: (plan?.handoffs || []).map((handoff) => ({
      id: handoff.id, gapId: handoff.gapId,
      fromSectionId: handoff.fromSectionId, toSectionId: handoff.toSectionId,
      from: handoff.from, to: handoff.to,
    })),
    contacts: (plan?.contacts || []).slice(0, 12).map((contact) => ({
      anchorId: contact.anchorId || null,
      sectionId: contact.sectionId || null,
      side: contact.side || contact.departureSide || null,
      runId: contact.runId || null,
      x: contact.x,
      y: contact.y,
    })),
    sectionRouting: plan?.diagnostics?.sectionRouting || null,
    dp: plan?.diagnostics?.dp || null,
    stateFailureCount: plan?.diagnostics?.stateFailures?.length || 0,
    sectionDeclines: (plan?.diagnostics?.declined || [])
      .filter((entry) => entry.move === "section-routing").slice(0, 4),
  }));
}

/* lab introspection for the browser console */
globalThis.__LAB = {
  blockFor,
  annFor,
  measure: (sid) => measure(sid),
  measuredSectionTopology,
  revelationSections: REVELATION_SECTIONS.map((section) => ({ ...section })),
  planSideRuns,
  planSpines,
  validateHostTopology,
  routeQaDiagnostics,
  planRoute,
  warmBlocks,
};

function segmentSpineId(plan, segment) {
  if (segment.role === "spine" && segment.spineId) return String(segment.spineId);
  /* Exact C0.3 compatibility: old segments predate ownership metadata. */
  const legacy = planSpines(plan).find((spine) =>
    segment.type === "L" && Math.abs(segment.x1 - spine.x) < 0.01 && Math.abs(segment.x2 - spine.x) < 0.01 &&
    Math.abs(segment.y2 - segment.y1) > 4);
  return legacy ? spineIdOf(legacy, planSpines(plan).indexOf(legacy)) : null;
}
function routePartsForPaint(plan) {
  if (isSectionTopology(plan)) return plan.routeParts || [];
  return [{ id: "legacy:centerline", role: "connector", ownerId: "legacy", segments: plan.centerline || [] }];
}

/* An engine plan, drawn in Shapes' own voice. Canonical route segments keep
 * their owner; every spine is painted independently, and the horizontal S
 * remains one quiet handoff ribbon with no new decorative vocabulary. */
function drawRouted(svg, g, plan, hue, focused, weaveState = null, { immediate = false } = {}) {
  const w = focused ? 1.5 : 1.25;
  const runs = [];
  const centerlineIndexes = new Map((plan.centerline || []).map((segment, index) => [segment.id || segment, index]));
  for (const part of routePartsForPaint(plan)) {
    if (part.role === "spine") continue;
    let cur = null;
    const flush = () => { if (cur?.points.length) runs.push(cur); cur = null; };
    for (const segment of part.segments || []) {
      if (!isSectionTopology(plan) && segmentSpineId(plan, segment)) continue;
      const pts = segPtsFor(segment);
      if (cur && Math.hypot(pts[0].x - cur.points[cur.points.length - 1].x,
        pts[0].y - cur.points[cur.points.length - 1].y) > 1.5) flush();
      if (!cur) cur = { part, points: [], segmentIndexes: [], segmentIds: [], roles: new Set() };
      cur.points.push(...(cur.points.length ? pts.slice(1) : pts));
      cur.segmentIndexes.push(centerlineIndexes.get(segment.id || segment));
      if (segment.id) cur.segmentIds.push(segment.id);
      cur.roles.add(segment.role || part.role || "connector");
    }
    flush();
  }
  runs.forEach((run, i) => {
    const path = ribbonDraw(g, run.points, hue, {
      w, delay: 40 + i * 26, dur: 340, role: run.part.role || "connector", immediate,
    });
    path.__routeCenterline = run.points.map((point) => ({ x: point.x, y: point.y }));
    path.dataset.partId = run.part.id;
    path.dataset.ownerId = run.part.ownerId;
    path.dataset.segmentIndexes = run.segmentIndexes.join(",");
    path.dataset.segmentIds = run.segmentIds.join(" ");
    path.dataset.segmentRoles = [...run.roles].join(",");
    if (run.part.runId != null) path.dataset.runId = run.part.runId;
    if (run.part.handoffId != null) path.dataset.handoffId = run.part.handoffId;
  });
  const declaredSpines = planSpines(plan);
  const spineById = new Map(declaredSpines.map((spine, index) => [spineIdOf(spine, index), spine]));
  const spinePaints = isSectionTopology(plan)
    ? routePartsForPaint(plan).filter((part) => part.role === "spine").map((part) => {
      const segment = part.segments[0];
      const spineId = String(part.spineId);
      return {
        part,
        spineId,
        spine: spineById.get(spineId),
        geometry: { x: segment.x1, top: Math.min(segment.y1, segment.y2), bottom: Math.max(segment.y1, segment.y2) },
        segmentIds: segment.id ? [segment.id] : [],
      };
    })
    : declaredSpines.map((spine, spineIndex) => {
      const spineId = spineIdOf(spine, spineIndex);
      return {
        part: { id: `legacy:part:${spineId}`, ownerId: spineId, runId: spine.runId, spineId },
        spineId,
        spine,
        geometry: spine,
        segmentIds: [],
      };
    });
  spinePaints.forEach(({ part, spineId, spine, geometry, segmentIds }) => {
    const hops = weaveState?.hopsBySpine?.get(spineId) || [];
    for (const [a, b] of splitSpine(geometry, hops)) {
      const n = Math.max(6, Math.round((b - a) / 2));
      const pts = Array.from({ length: n + 1 }, (_, k) => ({ x: geometry.x, y: a + ((b - a) * k) / n }));
      const path = ribbonDraw(g, pts, hue, { w: w - 0.12, delay: 70, dur: 380, role: "spine", immediate });
      path.__routeCenterline = pts.map((point) => ({ x: point.x, y: point.y }));
      path.dataset.partId = part.id;
      path.dataset.ownerId = part.ownerId;
      path.dataset.spineId = spineId;
      path.dataset.segmentIds = segmentIds.join(" ");
      if (part.runId != null) path.dataset.runId = part.runId;
      if (spine?.side) path.dataset.side = spine.side;
      if (Number.isInteger(spine?.strand)) path.dataset.strand = String(spine.strand);
    }
  });
  const renderPatches = weaveState?.patches || [];
  if (renderPatches.length) {
    const W = +svg.getAttribute("width") + 40, H = +svg.getAttribute("height") + 40;
    let defs = svg.querySelector("defs");
    if (!defs) { defs = document.createElementNS("http://www.w3.org/2000/svg", "defs"); svg.insertBefore(defs, svg.firstChild); }
    const mask = S("mask", { id: `weave-${g.dataset.gid}`, maskUnits: "userSpaceOnUse", x: -20, y: -20, width: W, height: H }, defs);
    S("rect", { x: -20, y: -20, width: W, height: H, fill: "#fff" }, mask);
    for (const pt of renderPatches) S("circle", { cx: pt.x, cy: pt.y, r: 2.6, fill: "#000" }, mask);
    g.setAttribute("mask", `url(#weave-${g.dataset.gid})`);
  }
  const anchorRouteByContact = new Map((plan.anchorRuns || [])
    .filter((route) => route?.contactId)
    .map((route) => [String(route.contactId), route]));
  const sideRunById = new Map(planSideRuns(plan).map((run, index) => [runIdOf(run, index), run]));
  plan.contacts.forEach((contact, i) => {
    const anchorRoute = anchorRouteByContact.get(String(contact.id));
    const sideRun = sideRunById.get(String(contact.runId));
    /* Contact ownership remains untouched canonical engine output. The side
     * glyph is resolved from its already-verified anchor/run relation. */
    const side = contact.side || contact.departureSide || anchorRoute?.side || sideRun?.side;
    traceDot(g, contact, hue, 60 + i * 22, TG.constants.TOUCH_RADIUS, 1, {
      contactId: contact.id,
      anchorId: contact.anchorId,
      sectionId: contact.sectionId,
      side,
      runId: contact.runId,
    });
  });
}

function segmentPaintBounds(segments) {
  const points = segments.flatMap((segment) => segPtsFor(segment));
  if (!points.length || points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return null;
  return {
    left: Math.min(...points.map((point) => point.x)),
    right: Math.max(...points.map((point) => point.x)),
    top: Math.min(...points.map((point) => point.y)),
    bottom: Math.max(...points.map((point) => point.y)),
  };
}
function unionPaintBounds(bounds) {
  if (!bounds.length) return null;
  return {
    left: Math.min(...bounds.map((box) => box.left)),
    right: Math.max(...bounds.map((box) => box.right)),
    top: Math.min(...bounds.map((box) => box.top)),
    bottom: Math.max(...bounds.map((box) => box.bottom)),
  };
}
function verticalPaintCoverage(bounds, top, bottom) {
  if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom <= top) return 0;
  const intervals = bounds.map((box) => [Math.max(top, box.top), Math.min(bottom, box.bottom)])
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const interval of intervals) {
    const prior = merged[merged.length - 1];
    if (prior && interval[0] <= prior[1]) prior[1] = Math.max(prior[1], interval[1]);
    else merged.push([...interval]);
  }
  return merged.reduce((sum, [start, end]) => sum + end - start, 0) / (bottom - top);
}
function maskHolesForPaint(group) {
  const ref = group.getAttribute("mask") || "";
  const id = ref.match(/^url\(#(.+)\)$/)?.[1];
  if (!id) return { holes: [], error: null };
  const mask = [...group.ownerSVGElement.querySelectorAll("mask")].find((candidate) => candidate.id === id);
  if (!mask) return { holes: [], error: `paint-mask-missing:${id}` };
  const holes = [...mask.querySelectorAll('circle[fill="#000"]')].map((circle) => ({
    x: Number(circle.getAttribute("cx")),
    y: Number(circle.getAttribute("cy")),
    r: Number(circle.getAttribute("r")),
  }));
  if (!holes.length || holes.some((hole) => !Number.isFinite(hole.x) || !Number.isFinite(hole.y) ||
      !Number.isFinite(hole.r) || hole.r <= 0 || hole.r > 4)) {
    return { holes, error: `paint-mask-holes:${id}` };
  }
  return { holes, error: null };
}
function semanticMaskCoverage(path, holes) {
  const points = Array.isArray(path.__routeCenterline) ? path.__routeCenterline : [];
  if (points.length < 2 || points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return null;
  let totalLength = 0, visibleLength = 0;
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1], to = points[index];
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (!length) continue;
    const samples = Math.max(1, Math.ceil(length / 0.4));
    const sampleLength = length / samples;
    totalLength += length;
    for (let sample = 0; sample < samples; sample++) {
      const t = (sample + 0.5) / samples;
      const x = from.x + (to.x - from.x) * t;
      const y = from.y + (to.y - from.y) * t;
      if (holes.every((hole) => Math.hypot(x - hole.x, y - hole.y) > hole.r)) visibleLength += sampleLength;
    }
  }
  return totalLength > 0 ? { totalLength, visibleLength, visibleRatio: visibleLength / totalLength } : null;
}
function validatePaintGroup(group, plan, { allowSpineSplits = false, expectedContinuations = [] } = {}) {
  const errors = [];
  try {
    const paths = [...group.querySelectorAll("path[data-part-id]")];
    const sectioned = isSectionTopology(plan);
    const canonicalParts = sectioned ? (plan.routeParts || []) : [];
    const expectedParts = canonicalParts.map((part) => part.id);
    const partById = new Map(canonicalParts.map((part) => [part.id, part]));
    const expectedPartSet = new Set(expectedParts);
    const paintedParts = new Set(paths.map((path) => path.dataset.partId));
    const { holes, error: maskError } = maskHolesForPaint(group);
    const spineCoverageRatios = [];
    if (maskError) errors.push(maskError);
    const pathFacts = [];
    for (const path of paths) {
      const d = path.getAttribute("d") || "";
      if (!d || /NaN|Infinity/.test(d)) { errors.push(`paint-path:${path.dataset.partId}`); continue; }
      const length = path.getTotalLength();
      if (!Number.isFinite(length) || length <= 0) { errors.push(`paint-length:${path.dataset.partId}`); continue; }
      const semanticCoverage = semanticMaskCoverage(path, holes);
      if (!semanticCoverage) { errors.push(`paint-centerline:${path.dataset.partId}`); continue; }
      const { totalLength: semanticLength, visibleLength, visibleRatio } = semanticCoverage;
      path.dataset.visibleRatio = visibleRatio.toFixed(4);
      if (holes.length && visibleRatio < 0.82) {
        errors.push(`paint-mask-path:${path.dataset.partId}:${visibleRatio.toFixed(3)}`);
      }
      const box = path.getBBox();
      if (![box.x, box.y, box.width, box.height].every(Number.isFinite)) errors.push(`paint-bounds:${path.dataset.partId}`);
      pathFacts.push({
        path,
        length,
        semanticLength,
        visibleLength,
        ids: (path.dataset.segmentIds || "").split(/\s+/).filter(Boolean),
        bounds: { left: box.x, right: box.x + box.width, top: box.y, bottom: box.y + box.height },
      });
    }
    if (sectioned) {
      expectedParts.forEach((partId) => { if (!paintedParts.has(partId)) errors.push(`paint-missing:${partId}`); });
      paintedParts.forEach((partId) => { if (!expectedPartSet.has(partId)) errors.push(`paint-extra:${partId}`); });
      for (const fact of pathFacts) {
        const partId = fact.path.dataset.partId;
        const part = partById.get(partId);
        if (!part || fact.path.dataset.ownerId !== String(part.ownerId) || fact.path.dataset.role !== part.role) {
          errors.push(`paint-owner:${partId}`);
          continue;
        }
        if (!fact.ids.length || new Set(fact.ids).size !== fact.ids.length) errors.push(`paint-segments:${partId}`);
        const canonicalIds = new Set(part.segments.map((segment) => segment.id));
        for (const id of fact.ids) if (!canonicalIds.has(id)) errors.push(`paint-segment-owner:${partId}:${id}`);
        const ownedBounds = segmentPaintBounds(fact.ids.map((id) =>
          part.segments.find((segment) => segment.id === id)).filter(Boolean));
        const epsilon = 2.75;
        if (ownedBounds && (fact.bounds.left < ownedBounds.left - epsilon || fact.bounds.right > ownedBounds.right + epsilon ||
            fact.bounds.top < ownedBounds.top - epsilon || fact.bounds.bottom > ownedBounds.bottom + epsilon)) {
          errors.push(`paint-path-bounds:${partId}`);
        }
      }
      for (const part of canonicalParts) {
        const facts = pathFacts.filter((fact) => fact.path.dataset.partId === part.id);
        const counts = new Map();
        facts.forEach((fact) => fact.ids.forEach((id) => counts.set(id, (counts.get(id) || 0) + 1)));
        for (const segment of part.segments) {
          const count = counts.get(segment.id) || 0;
          const splitSpine = allowSpineSplits && part.role === "spine";
          if ((!splitSpine && count !== 1) || (splitSpine && count < 1)) {
            errors.push(`paint-segment-count:${part.id}:${segment.id}:${count}`);
          }
        }
        for (const id of counts.keys()) {
          if (!part.segments.some((segment) => segment.id === id)) errors.push(`paint-segment-extra:${part.id}:${id}`);
        }
        const expectedBounds = segmentPaintBounds(part.segments);
        const paintedBounds = unionPaintBounds(facts.map((fact) => fact.bounds));
        const epsilon = 2.75;
        if (!expectedBounds || !paintedBounds || paintedBounds.left > expectedBounds.left + epsilon ||
            paintedBounds.right < expectedBounds.right - epsilon || paintedBounds.top > expectedBounds.top + epsilon ||
            paintedBounds.bottom < expectedBounds.bottom - epsilon) {
          errors.push(`paint-part-bounds:${part.id}`);
        }
        const totalLength = facts.reduce((sum, fact) => sum + fact.semanticLength, 0);
        const visibleLength = facts.reduce((sum, fact) => sum + fact.visibleLength, 0);
        if (holes.length && totalLength > 0) {
          const ratio = visibleLength / totalLength;
          const minimumRatio = part.role === "handoff" ? 0.94 : 0.9;
          const lossBudget = part.role === "handoff" ? 12 : part.role === "spine" ? 8 : 6;
          if (ratio < minimumRatio) errors.push(`paint-mask-part:${part.id}:${ratio.toFixed(3)}`);
          if (totalLength - visibleLength > lossBudget) {
            errors.push(`paint-mask-budget:${part.id}:${(totalLength - visibleLength).toFixed(2)}`);
          }
        }
        if (part.role === "spine" && expectedBounds) {
          const coverage = verticalPaintCoverage(facts.map((fact) => fact.bounds), expectedBounds.top, expectedBounds.bottom);
          spineCoverageRatios.push(coverage);
          /* Woven spine gaps are a small over/under breath, never a license to
           * leave endpoint slivers that merely preserve the union extrema. */
          if (allowSpineSplits && coverage < 0.72) {
            errors.push(`paint-spine-coverage:${part.id}:${coverage.toFixed(3)}`);
          }
        }
      }
    }
    if (sectioned) {
      const allContacts = [...group.querySelectorAll('circle[data-role="contact"]')];
      const contacts = allContacts.filter((contact) => contact.dataset.continuation !== "true");
      const continuations = allContacts.filter((contact) => contact.dataset.continuation === "true");
      const expectedContacts = new Map((plan.contacts || []).map((contact) => [String(contact.id), contact]));
      const expectedContactSides = new Map((plan.anchorRuns || []).map((route) => [String(route.contactId), route.side]));
      const paintedContactIds = contacts.map((contact) => contact.dataset.contactId).filter(Boolean);
      if (contacts.length !== plan.contacts.length || expectedContacts.size !== plan.contacts.length ||
          paintedContactIds.length !== contacts.length || new Set(paintedContactIds).size !== contacts.length ||
          contacts.some((contact) => {
            const expected = expectedContacts.get(String(contact.dataset.contactId));
            return !expected || contact.dataset.anchorId !== String(expected.anchorId) ||
              contact.dataset.sectionId !== String(expected.sectionId) ||
              contact.dataset.runId !== String(expected.runId) ||
              contact.dataset.side !== String(expectedContactSides.get(String(expected.id))) ||
              !sameFiniteNumber(Number(contact.getAttribute("cx")), expected.x) ||
              !sameFiniteNumber(Number(contact.getAttribute("cy")), expected.y);
          })) errors.push("paint-contact-ownership");
      const expectedByKey = new Map(expectedContinuations.map((contact) => [contact.key, contact]));
      const continuationKeys = continuations.map((contact) => contact.dataset.continuationKey).filter(Boolean);
      if (continuations.length !== expectedContinuations.length || continuationKeys.length !== continuations.length ||
          new Set(continuationKeys).size !== continuationKeys.length || expectedByKey.size !== expectedContinuations.length ||
          continuations.some((contact) => {
            const expected = expectedByKey.get(contact.dataset.continuationKey);
            return !expected || contact.dataset.anchorId !== expected.anchorId ||
              contact.dataset.sectionId !== expected.sectionId || contact.dataset.side !== expected.side ||
              contact.dataset.runId !== expected.runId ||
              !sameFiniteNumber(Number(contact.getAttribute("cx")), expected.x) ||
              !sameFiniteNumber(Number(contact.getAttribute("cy")), expected.y);
          })) errors.push("paint-continuation-ownership");
      if (holes.length && allContacts.some((contact) => {
        const x = Number(contact.getAttribute("cx"));
        const y = Number(contact.getAttribute("cy"));
        const radius = Number(contact.getAttribute("r")) || 0;
        return holes.some((hole) => Math.hypot(x - hole.x, y - hole.y) <= hole.r + radius);
      })) errors.push("paint-mask-contact");
    }
    const nativePathLength = pathFacts.reduce((sum, fact) => sum + fact.length, 0);
    const semanticPathLength = pathFacts.reduce((sum, fact) => sum + fact.semanticLength, 0);
    const visiblePathLength = pathFacts.reduce((sum, fact) => sum + fact.visibleLength, 0);
    return {
      ok: errors.length === 0,
      errors,
      partCount: expectedParts.length,
      pathCount: paths.length,
      nativePathLength,
      semanticPathLength,
      visiblePathLength,
      maskHoleCount: holes.length,
      minVisibleRatio: pathFacts.length
        ? Math.min(...pathFacts.map((fact) => fact.visibleLength / fact.semanticLength))
        : null,
      minSpineCoverage: spineCoverageRatios.length ? Math.min(...spineCoverageRatios) : null,
    };
  } catch (error) {
    return { ok: false, errors: [`paint-exception:${error instanceof Error ? error.message : String(error)}`] };
  }
}

function continuationContactsForPlan(plan, ann) {
  const sideRuns = planSideRuns(plan);
  const contacts = [];
  for (const [anchorIndex, anchor] of ann.anchors.entries()) for (const fragment of anchor.fragments.slice(1)) {
    const route = routeForAnchor(plan, anchor, anchorIndex);
    if (!route && isSectionTopology(plan) && sideRuns.length > 1) continue;
    const side = route?.side || (plan.side === "right" ? "right" : "left");
    contacts.push({
      key: `${anchor.id}|${fragment.id}`,
      anchorId: anchor.id,
      sectionId: anchor.sectionId || "",
      side,
      runId: String(route?.runId ?? route?.id ?? ""),
      x: side === "right" ? fragment.right - 0.5 : fragment.left + 0.5,
      y: fragment.bottom + 2,
    });
  }
  return contacts;
}

function drawContinuationContacts(group, contacts, hue) {
  for (const contact of contacts) {
    traceDot(group, contact, hue, 120, 1.35, 0.72, {
      anchorId: contact.anchorId,
      sectionId: contact.sectionId,
      side: contact.side,
      runId: contact.runId,
      continuation: "true",
      continuationKey: contact.key,
    });
  }
}

function stagePlanPaint(svg, plan, hue, focused, weaveState, expectedContinuations) {
  const stage = S("g", {
    class: "route-paint-stage", visibility: "hidden", "aria-hidden": "true",
    "data-gid": `paint-stage:${plan.topologySignature || plan.mode}`,
  }, svg);
  try {
    drawRouted(svg, stage, plan, hue, focused, weaveState, { immediate: true });
    drawContinuationContacts(stage, expectedContinuations, hue);
    return validatePaintGroup(stage, plan, { allowSpineSplits: true, expectedContinuations });
  } finally {
    const maskId = stage.getAttribute("mask")?.match(/^url\(#(.+)\)$/)?.[1];
    if (maskId) [...svg.querySelectorAll("mask")].find((mask) => mask.id === maskId)?.remove();
    stage.remove();
  }
}

/* Paint candidates in priority order.  A later companion always weaves under
 * every already-validated route, so an accepted route never needs to be
 * mutated after its claims are committed. */
function candidateWeaveState(plan, paintedPlans) {
  const state = { hopsBySpine: new Map(), patches: [] };
  const ownPorts = plan.ports || [];
  for (const painted of paintedPlans) {
    for (const [spineIndex, spine] of planSpines(plan).entries()) {
      const spineId = spineIdOf(spine, spineIndex);
      const hops = state.hopsBySpine.get(spineId) || [];
      for (const y of crossingsAt(painted, spine.x)) {
        if (y < spine.top + 2 || y > spine.bottom - 2) continue;
        if (ownPorts.some((port) => port.spineId === spineId && Math.abs(port.y - y) < 2.6)) continue;
        if (!hops.some((existing) => Math.abs(existing - y) < 3)) hops.push(y);
      }
      state.hopsBySpine.set(spineId, hops);
    }
    for (const spine of planSpines(painted)) {
      for (const y of crossingsAt(plan, spine.x)) {
        if (y < spine.top + 2 || y > spine.bottom - 2) continue;
        if (!state.patches.some((patch) => Math.abs(patch.x - spine.x) < 1 && Math.abs(patch.y - y) < 3)) {
          state.patches.push({ x: spine.x, y, againstSpineId: spine.id || null });
        }
      }
    }
  }
  return state;
}

function paintDrawnPlan(svg, gid, plan, localFocus, weaveState, expectedContinuations) {
  const G = GIDS[gid];
  const sideRuns = planSideRuns(plan);
  const sides = [...new Set(sideRuns.map((run) => run.side))];
  const displaySide = sides.length > 1 ? "mixed" : sides[0] || "direct";
  const handoffCount = Array.isArray(plan?.handoffs) ? plan.handoffs.length : 0;
  const g = S("g", {
    class: `margin-annotation ${gid === localFocus ? "is-focus" : "is-held"}${handoffCount ? " has-handoff" : ""}`,
    "data-gid": gid,
    "data-side": displaySide,
    "data-strand": sideRuns.length === 1 ? sideRuns[0].strand : "",
    "data-side-runs": sideRuns.length,
    "data-spines": planSpines(plan).length,
    "data-handoffs": handoffCount,
  }, svg);
  g.dataset.kind = G.kind;
  const signature = topologySignatureText(plan);
  if (signature) g.dataset.topologySignature = signature;
  if (Number.isFinite(plan?.score)) g.dataset.score = String(plan.score);
  if (Number.isFinite(plan?.scoreRaw)) g.dataset.scoreRaw = String(plan.scoreRaw);
  if (plan?.paintValidation) {
    g.dataset.paintParts = String(plan.paintValidation.partCount || 0);
    g.dataset.paintPaths = String(plan.paintValidation.pathCount || 0);
    g.dataset.nativePathLength = String(plan.paintValidation.nativePathLength || 0);
  }
  if (G.qaKind) g.dataset.qaKind = G.qaKind;
  if (G.qaDistance) g.dataset.qaDistance = G.qaDistance;
  if (G.qaPlacement) g.dataset.qaPlacement = G.qaPlacement;
  if (!plan?.valid) {
    g.dataset.route = plan ? plan.reason : "none";
    if (plan?.hostValidationErrors) g.dataset.hostTopologyErrors = plan.hostValidationErrors.join(",");
    return { plan, group: g };
  }

  g.dataset.route = plan.mode + (plan.cradleVariant ? ":" + plan.cradleVariant : "");
  g.dataset.hostTopology = "valid";
  /* The hidden proof used this exact final weave state. The visible artifact
   * now gets Shapes' normal ribbon animation; it does not synchronously paint
   * and validate the same geometry a second time. */
  drawRouted(svg, g, plan, G.hue, gid === localFocus, weaveState);
  drawContinuationContacts(g, expectedContinuations, G.hue);
  const finalPaintValidation = plan.finalPaintValidation;
  g.dataset.finalPaintPaths = String(finalPaintValidation.pathCount || 0);
  g.dataset.finalNativePathLength = String(finalPaintValidation.nativePathLength || 0);
  g.dataset.finalSemanticPathLength = String(finalPaintValidation.semanticPathLength || 0);
  g.dataset.finalVisiblePathLength = String(finalPaintValidation.visiblePathLength || 0);
  g.dataset.maskHoleCount = String(finalPaintValidation.maskHoleCount || 0);
  if (Number.isFinite(finalPaintValidation.minVisibleRatio)) {
    g.dataset.minVisibleRatio = String(finalPaintValidation.minVisibleRatio);
  }
  if (Number.isFinite(finalPaintValidation.minSpineCoverage)) {
    g.dataset.minSpineCoverage = String(finalPaintValidation.minSpineCoverage);
  }
  return { plan, group: g };
}

function traceDot(g, point, hue, delay = 0, radius = TG.constants.TOUCH_RADIUS, opacity = 1, meta = {}) {
  const attrs = {
    cx: point.x, cy: point.y, r: radius, fill: hue, opacity, "data-role": "contact",
  };
  for (const [key, value] of Object.entries(meta)) {
    if (value == null || value === "") continue;
    attrs[`data-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`] = value;
  }
  const dot = S("circle", attrs, g);
  animFade(dot, 200, delay);
  return dot;
}

function drawOverlay(sid, gids) {
  const sheet = document.querySelector(`[data-sheet="${sid}"]`);
  const svg = sheet.querySelector("svg.overlay");
  const key = gids.slice().sort().join("|") + "·" + ROUTE + "·" + [...hovered].join(",") + "·" + (FOCUS_GID || "");
  if (svg.dataset.key === key) return;
  const activeTickKey = svg.contains(document.activeElement)
    ? document.activeElement.getAttribute?.("data-tick-key")
    : null;
  const requestedTickKey = TICK_FOCUS_KEYS.get(sid) || activeTickKey;
  const restoreTickFocus = Boolean(activeTickKey || TICK_FOCUS_KEYS.has(sid));
  svg.dataset.key = key;
  const live = svg.querySelector("g.live");
  svg.innerHTML = "";
  if (live) svg.appendChild(live);
  delete svg.dataset.tickOwnershipErrors;
  if (!gids.length) {
    LAST_PLANS.delete(sid);
    LAST_INKED.delete(sid);
    delete svg.dataset.handoffPlanCount;
    return;
  }
  const M = measure(sid);
  const lineHeight = parseFloat(getComputedStyle(M.sheet.querySelector(".vtext")).lineHeight) || 26;
  const preview = [...hovered].filter((gid) => GIDS[gid]?.study === sid).at(-1);
  const localFocus = preview || (FOCUS_GID && gids.includes(FOCUS_GID) ? FOCUS_GID : gids.at(-1));
  /* C0.5: one overlay grammar for both views. Reading retired its local bows;
   * the Loom engine now plans every inked trace and everything held becomes a
   * quiet rail tick. The Reading/Traces toggle never changes the connectors. */
  {
    /* the Loom engine plans every inked trace: focused first (it claims
     * corridors and strand 0 first), then companions ranked BESIDE the
     * focus (engine rankCompanions) with ~35px lane hysteresis so lanes
     * don't reshuffle on every focus hop. Everything active but not
     * drawn becomes a held tick on the rail. */
    const fontSize = parseFloat(getComputedStyle(M.sheet.querySelector(".vtext")).fontSize) || 17;
    const block = blockFor(sid, M);
    svg.dataset.sectionCount = String(block.sections?.length || 0);
    svg.dataset.sectionGapCount = String(block.sectionGaps?.length || 0);
    svg.dataset.sectionIds = (block.sections || []).map((section) => section.id).join(" ");
    const expandLoom = Math.max(2.5, fontSize * 0.12) + 2.5;
    const datumRects = block.wordRuns.length ? block.wordRuns : block.renderedLines;
    let minLeft = Infinity, maxRight = -Infinity;
    for (const r of [...datumRects, ...block.verseNumberRects, ...block.additionalObstacles]) {
      minLeft = Math.min(minLeft, r.left - expandLoom);
      maxRight = Math.max(maxRight, r.right + expandLoom);
    }
    const leftLoomInner = minLeft - 10;
    const rightLoomInner = maxRight + 10;
    const anns = new Map(gids.map((gid) => [gid, annFor(M, gid)]));
    const intervals = gids.map((gid) => {
      const fr = anns.get(gid).anchors.flatMap((a) => a.fragments);
      return fr.length ? { id: gid, top: Math.min(...fr.map((f) => f.top)), bottom: Math.max(...fr.map((f) => f.bottom)) } : null;
    }).filter(Boolean);
    const fiv = intervals.find((i) => i.id === localFocus);
    const distTo = (id) => {
      const i = intervals.find((x) => x.id === id);
      if (!i || !fiv) return 1e9;
      return i.top > fiv.bottom ? i.top - fiv.bottom : fiv.top > i.bottom ? fiv.top - i.bottom : 0;
    };
    const prevInked = LAST_INKED.get(sid) || new Set();
    const companionPriority = rankCompanions(intervals, localFocus)
      .sort((a, b) => (distTo(a) - (prevInked.has(a) ? 35 : 0)) - (distTo(b) - (prevInked.has(b) ? 35 : 0)))
      .slice(0, MAX_MARGIN_TRACES - 1);
    LAST_INKED.set(sid, new Set(companionPriority));
    /* DOM draw order is back-to-front, but planning/claims retain the engine's
     * nearest-first ranking so a lower-priority companion can only weave under
     * routes that already earned their place. */
    const drawnOrder = [...companionPriority].reverse().concat(localFocus).filter(Boolean);

    /* Candidates paint in priority order.  These occupancy arrays receive a
     * route only after its final woven DOM paths pass native validation. */
    const claims = [], spineClaims = [], strandClaims = [], handoffClaims = [];
    const plans = new Map();
    const paintedPlans = [];
    const routeGroups = new Map();
    const ordered = [localFocus, ...companionPriority].filter(Boolean);
    /* Pin runs on the drawn underline's center, exactly. Fragments are
     * element rects minus the measured ink slack; adding the same slack
     * back and stepping up half the underline height lands on the center
     * of the 1.5px line the .pk paints — font metrics cancel out. */
    const sheetText = document.querySelector(`[data-sheet="${sid}"] .vtext`);
    const underlinePinDy = (sheetText ? inkSlackFor(sheetText).bottom : 0)
      - TG.constants.UNDERLINE_CENTER_OFFSET;
    const planOne = (gid, focused) => {
      const ann = anns.get(gid);
      if (!ann.anchors.length) return { valid: false, reason: "no-anchors" };
      const previousTopology = LAST_TOPOLOGIES.get(`${sid}|${gid}`) || null;
      const sectionReady = Boolean(block.sections?.length && block.sectionGaps?.length &&
        ann.anchors.every((anchor) => anchor.sectionId));
      try {
        return hostValidatedPlan(planRoute(block, ann, {
          fontSize, corridorClaims: claims, spineClaims, strandClaims, handoffClaims,
          loomX: leftLoomInner, leftLoomX: leftLoomInner, rightLoomX: rightLoomInner,
          underlineDy: underlinePinDy,
          sides: ["left", "right"], previousSide: previousTopology?.side || undefined,
          previousTopology: previousTopology || undefined,
          previousSectionSides: previousTopology?.sectionSides || undefined,
          ...(sectionReady ? {
            sectionRouting: { enabled: true, previousSides: previousTopology?.sectionSides || [] },
          } : {}),
          /* C0.5: the interior shaft's staircase silhouette failed the
           * visual gate (screenshot 3) — no host may request it until it
           * can attach with the calm grammar. Margin, cradle, and local
           * families carry every relation. */
          focused, allowMiddle: false, claimPad: 0.25,
        }), ann, block);
      } catch (e) {
        return { valid: false, reason: "engine-error" };
      }
    };
    for (const gid of ordered) {
      let plan = planOne(gid, gid === localFocus);
      let weaveState = null;
      let expectedContinuations = [];
      if (plan.valid) {
        plan.focused = gid === localFocus;
        weaveState = candidateWeaveState(plan, paintedPlans);
        expectedContinuations = continuationContactsForPlan(plan, anns.get(gid));
        const paintValidation = stagePlanPaint(
          svg, plan, GIDS[gid].hue, gid === localFocus, weaveState, expectedContinuations,
        );
        if (!paintValidation.ok) {
          plan = {
            ...plan, valid: false, reason: "host-paint-invalid",
            hostValidationErrors: paintValidation.errors, paintValidation, finalPaintValidation: paintValidation,
          };
        } else {
          plan.paintValidation = paintValidation;
          plan.finalPaintValidation = paintValidation;
        }
      }
      const painted = paintDrawnPlan(svg, gid, plan, localFocus, weaveState, expectedContinuations);
      plan = painted.plan;
      routeGroups.set(gid, painted.group);
      plans.set(gid, plan);
      if (plan.valid && plan.paintValidation?.ok && plan.finalPaintValidation?.ok) {
        claims.push(...planCorridorClaims(plan));
        spineClaims.push(...planSpineClaims(plan));
        strandClaims.push(...planStrandClaims(plan));
        handoffClaims.push(...(plan.handoffClaimsOut || []));
        const topologyMemory = topologyMemoryForPlan(plan);
        if (topologyMemory) LAST_TOPOLOGIES.set(`${sid}|${gid}`, topologyMemory);
        paintedPlans.push(plan);
      }
    }
    /* Planning is front-to-back priority; SVG siblings are then restored to
     * visual back-to-front order so the focus remains the topmost ink without
     * changing any accepted route, claim, or weave decision. */
    for (const gid of drawnOrder) {
      const group = routeGroups.get(gid);
      if (group?.parentNode === svg) svg.appendChild(group);
    }
    /* Every held trace gets a side-effect-free shadow plan so its tick can
     * live on the side where that trace would actually bloom. Shadows see
     * committed claims but never consume claims, strands, or side memory. */
    for (const gid of gids) {
      if (!plans.has(gid)) plans.set(gid, planOne(gid, false));
    }

    LAST_PLANS.set(sid, plans);
    const qaPlans = routeQaDiagnostics(sid);
    const qaMetadata = S("metadata", {
      class: "route-qa-metadata", "data-route-qa": sid, "data-version": "c04",
    }, svg);
    qaMetadata.textContent = JSON.stringify({
      sid,
      sections: (block.sections || []).map(({ id, documentOrder, top, bottom }) => ({ id, documentOrder, top, bottom })),
      sectionGaps: (block.sectionGaps || []).map(({ id, fromSectionId, toSectionId, left, right, top, bottom, hardClear }) => ({
        id, fromSectionId, toSectionId, left, right, top, bottom, hardClear, height: bottom - top,
      })),
      plans: qaPlans,
    });
    svg.dataset.handoffPlanCount = String(qaPlans.filter((candidate) => candidate.valid && candidate.handoffs.length).length);

    /* held ticks: everything active-but-not-drawn gets one quiet tick per
     * anchor line on the held rail — hover previews, click holds */
    /* tick LAYOUT includes a tick-previewed gid (its thread is bloomed,
     * its tick invisible) so positions persist and mouseleave can fire
     * on the phantom hit rect at the same spot */
    const heldForTicks = gids.filter((gid) => {
      const p = plans.get(gid);
      const isDrawn = drawnOrder.includes(gid) && p && p.valid;
      return !isDrawn || gid === preview;
    });
    const gTicks = S("g", { class: "held-ticks" }, svg);
    const used = [];
    const tickNodes = [];
    const svgBox = svg.getBoundingClientRect();
    const svgWidth = svgBox.width;
    const svgHeight = svgBox.height;
    let outerLeftRail = leftLoomInner, outerRightRail = rightLoomInner;
    for (const plan of plans.values()) {
      if (!isMarginPlan(plan)) continue;
      for (const run of planSideRuns(plan)) {
        if (!Number.isFinite(run.railX)) continue;
        if (run.side === "right") outerRightRail = Math.max(outerRightRail, run.railX);
        else outerLeftRail = Math.min(outerLeftRail, run.railX);
      }
    }
    const beginTickPreview = (gid) => {
      let changed = false;
      if (TICK_PREVIEW_GID && TICK_PREVIEW_GID !== gid) changed = hovered.delete(TICK_PREVIEW_GID) || changed;
      TICK_PREVIEW_GID = gid;
      if (!hovered.has(gid)) { hovered.add(gid); changed = true; }
      if (changed) applyActive();
    };
    const endTickPreview = (gid) => {
      if (TICK_PREVIEW_GID !== gid) return;
      TICK_PREVIEW_GID = null;
      if (hovered.delete(gid)) applyActive();
    };
    for (const gid of heldForTicks) {
      const ann = anns.get(gid);
      if (!ann || !ann.anchors.length) continue;
      const p = plans.get(gid);
      const visible = !(drawnOrder.includes(gid) && p && p.valid);
      const lineMarks = [];
      for (const [anchorIndex, a] of ann.anchors.entries()) {
        for (const f of [...a.fragments].sort((p2, q) => p2.top - q.top || p2.left - q.left)) {
          const y = (f.top + f.bottom) / 2;
          const sourceLineId = f.sourceLineId || f.id;
          const markKey = `${a.sectionId || "whole"}|${a.id}|${sourceLineId}`;
          if (!lineMarks.some((mark) => mark.markKey === markKey)) {
            lineMarks.push({ y, anchor: a, anchorIndex, sectionId: a.sectionId || "", sourceLineId, markKey });
          }
        }
      }
      const layoutKey = `${sid}|${gid}`;
      /* A rejected topology owns nothing. Keep held annotations explicit by
       * falling back only through the last successfully painted memory, then
       * the stable left default; never borrow a side from the rejected plan. */
      const rememberedTopology = LAST_TOPOLOGIES.get(layoutKey) || null;
      const savedLayout = !visible && TICK_PREVIEW_GID === gid
        ? LAST_TICK_LAYOUTS.get(layoutKey)
        : null;
      const frozen = savedLayout && Math.abs(savedLayout.width - svgWidth) < 0.5 &&
        Math.abs(savedLayout.height - svgHeight) < 0.5
        ? new Map(savedLayout.ticks.map((tick) => [tick.markKey, tick]))
        : null;
      const layouts = [];
      for (let lineIndex = 0; lineIndex < lineMarks.length; lineIndex++) {
        const mark = lineMarks[lineIndex];
        const lineY = mark.y;
        const anchorRoute = routeForAnchor(p, mark.anchor, mark.anchorIndex);
        const sectionRuns = planSideRuns(p).filter((run) => run.sectionIds?.includes(mark.sectionId));
        const rememberedSection = rememberedTopology?.sectionSides?.find((entry) =>
          entry.sectionId === mark.sectionId && (entry.side === "left" || entry.side === "right"));
        const rememberedWhole = rememberedTopology?.side === "left" || rememberedTopology?.side === "right"
          ? rememberedTopology.side : null;
        const plannedSide = anchorRoute?.side || (sectionRuns.length === 1 ? sectionRuns[0].side : null) ||
          rememberedSection?.side || rememberedWhole || "left";
        const tickSideSource = anchorRoute ? "anchor-run" : sectionRuns.length === 1 ? "section-run" :
          rememberedSection ? "committed-section" : rememberedWhole ? "committed-whole" : "default-left";
        const plannedOutward = plannedSide === "right" ? 1 : -1;
        const heldRailX = (plannedSide === "right" ? outerRightRail : outerLeftRail) + plannedOutward * 4;
        const tick = frozen?.get(mark.markKey)
          ? { ...frozen.get(mark.markKey) }
          : placeHeldTick(plannedSide, heldRailX, lineY, used, svgWidth, svgHeight);
        const { x, y, stacked } = tick;
        const side = tick.side;
        const outward = side === "right" ? 1 : -1;
        used.push(tick);
        tick.sectionId = mark.sectionId;
        tick.anchorId = mark.anchor.id;
        tick.sourceLineId = mark.sourceLineId;
        tick.markKey = mark.markKey;
        layouts.push(tick);
        if (visible) S("path", {
          d: `M ${x.toFixed(2)} ${y.toFixed(2)} h ${(outward * 5.5).toFixed(1)}`, stroke: "var(--text-tertiary)",
          "stroke-width": 1.2, fill: "none", "stroke-linecap": "round", opacity: 0.55, class: "tick",
          "data-tick-side": side, "data-tick-gid": gid,
          "data-tick-side-source": tickSideSource,
          "data-section-id": mark.sectionId, "data-anchor-id": mark.anchor.id,
          "data-source-line-id": mark.sourceLineId, "data-mark-key": mark.markKey,
        }, gTicks);
        const hitWidth = stacked ? 7 : 17;
        const rawHitX = side === "right"
          ? (stacked ? x - 0.75 : x - 5)
          : (stacked ? x - 6.25 : x - 11);
        const hitX = Math.max(0, Math.min(svgWidth - hitWidth, rawHitX));
        const tickKey = `${gid}:${mark.markKey}`;
        const hit = S("a", {
          href: "#", class: "tick-hit", role: "button", tabindex: -1,
          "data-tick-key": tickKey, "data-tick-gid": gid, "data-tick-side": side,
          "data-tick-side-source": tickSideSource,
          "data-section-id": mark.sectionId, "data-anchor-id": mark.anchor.id,
          "data-source-line-id": mark.sourceLineId, "data-mark-key": mark.markKey,
          "aria-label": `${GIDS[gid].label || gid} · held on ${side} margin${mark.sectionId ? ` in ${mark.sectionId.split(":").at(-1)}` : ""}`,
        }, gTicks);
        S("rect", {
          x: hitX.toFixed(2), y: (y - 6).toFixed(2), width: hitWidth, height: 12,
          fill: "transparent", class: "tick-hit-shape",
        }, hit);
        hit.style.pointerEvents = "all";
        hit.style.cursor = "pointer";
        hit.addEventListener("mouseenter", () => beginTickPreview(gid));
        hit.addEventListener("mouseleave", () => endTickPreview(gid));
        hit.addEventListener("focus", () => beginTickPreview(gid));
        const commitTick = () => commitHeldShape(gid);
        hit.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          /* Pointer activation belongs to the completed-gesture delegate.
           * detail=0 preserves keyboard, assistive-tech, and programmatic clicks. */
          if (e.detail === 0) commitTick();
        });
        hit.addEventListener("keydown", (e) => {
          const key = (e.key || "").toLowerCase();
          const index = tickNodes.indexOf(hit);
          if (key === "arrowdown" || key === "arrowup") {
            e.preventDefault();
            const next = tickNodes[(index + (key === "arrowdown" ? 1 : tickNodes.length - 1)) % tickNodes.length];
            const nextGid = next.getAttribute("data-tick-gid");
            TICK_FOCUS_KEYS.set(sid, next.getAttribute("data-tick-key"));
            if (TICK_PREVIEW_GID === nextGid && hovered.has(nextGid)) {
              /* Same-thread navigation needs no redraw: move focus on the
               * live tick set and consume the otherwise-stale restore key. */
              TICK_FOCUS_KEYS.delete(sid);
              next.focus({ preventScroll: true });
            } else beginTickPreview(nextGid);
          } else if (key === "enter" || key === "return" || key === " " || key === "spacebar" ||
              e.code === "Enter" || e.code === "NumpadEnter" || e.code === "Space") {
            e.preventDefault();
            commitTick();
          } else if (key === "escape" || e.code === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            TICK_FOCUS_KEYS.delete(sid);
            hit.blur();
            endTickPreview(gid);
          }
        });
        tickNodes.push(hit);
      }
      if (visible) LAST_TICK_LAYOUTS.set(layoutKey, {
        width: svgWidth,
        height: svgHeight,
        ticks: layouts.map((tick) => ({ ...tick })),
      });
    }
    if (tickNodes.length) {
      const focusTarget = tickNodes.find((node) => node.getAttribute("data-tick-key") === requestedTickKey);
      const rovingTarget = focusTarget || tickNodes[0];
      tickNodes.forEach((node) => node.setAttribute("tabindex", node === rovingTarget ? 0 : -1));
      if (restoreTickFocus && focusTarget) focusTarget.focus({ preventScroll: true });
    }

    TICK_FOCUS_KEYS.delete(sid);
  }
}

/* ── awaken state ────────────────────────────────────────── */
function activeGids() { return new Set([...pinned, ...hovered]); }

function applyActive() {
  const act = activeGids();
  const activeOrder = [...act];
  const focus = [...hovered].at(-1) || (FOCUS_GID && act.has(FOCUS_GID) ? FOCUS_GID : [...act].at(-1));
  const hueByGid = Object.fromEntries(Object.entries(GIDS).map(([gid, G]) => [gid, G.hue]));
  for (const sid of Object.keys(SHEETS)) {
    const sheet = document.querySelector(`[data-sheet="${sid}"]`);
    const local = [...act].filter((g) => GIDS[g].study === sid);
    sheet.classList.toggle("awake", local.length > 0);
    sheet.querySelectorAll(".pk").forEach((el) => {
      const gs = gidsOf(el);
      const activeG = gs.filter((g) => act.has(g));
      const orderedActive = TG.orderSegmentGids(gs, activeOrder, focus);
      el.classList.toggle("on", activeG.length > 0);
      el.classList.toggle("trace-focus", !!focus && gs.includes(focus));
      // Focus owns both the text wash and the underline nearest its touch dot.
      el.style.setProperty("--h", TG.resolveSegmentHue(gs, activeOrder, focus, hueByGid));
      el.dataset.focusGid = focus && gs.includes(focus) ? focus : "";
      // Shared words keep quieter held lines above the focused underline.
      el.classList.toggle("stack", activeG.length > 1);
      if (orderedActive.length > 1) {
        el.style.backgroundImage = orderedActive.map((g) => `linear-gradient(${GIDS[g].hue}, ${GIDS[g].hue})`).join(", ");
        el.style.backgroundPosition = orderedActive.map((_, i) => `0 calc(100% - ${(orderedActive.length - 1 - i) * 3}px)`).join(", ");
        el.style.backgroundSize = "100% 1.5px";
        el.style.backgroundRepeat = "no-repeat";
      } else {
        el.style.backgroundImage = ""; el.style.backgroundPosition = "";
        el.style.backgroundSize = ""; el.style.backgroundRepeat = "";
      }
    });
    drawOverlay(sid, local);
  }
  document.querySelectorAll("[data-gids]").forEach((c) => {
    if (!c.classList.contains("chip") && !c.classList.contains("mcell") && !c.classList.contains("mhead")) return;
    c.classList.toggle("on", c.dataset.gids.split(" ").some((g) => act.has(g)));
  });
  updatePills();
  updateCard();
}

/* whisper — the pattern names itself, anchored to the touched phrase */
/* whisper grammar — dots carry identity, words stay few:
 *   one shape       ● echo · "the wicked" frames the psalm
 *   several, none   ●● 2 shapes · click to focus
 *   one focused     ● hinge · 2 of 2 · click for next
 *   all focused     ●● all 2 · click to clear                */
function wdot(hue) { return `<i class="wdot" style="background:${hue}"></i>`; }
function showWhisper(pk) {
  const sheet = pk.closest(".sheet");
  const wh = sheet.querySelector(".whisper");
  const gids = pk.dataset.gids.split(" ");
  const short = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
  let html;
  if (gids.length === 1) {
    html = wdot(GIDS[gids[0]].hue) + esc(short(GIDS[gids[0]].label, 44));
  } else {
    const pinnedIn = gids.filter((g) => pinned.has(g));
    const dots = gids.map((g) => wdot(GIDS[g].hue)).join("");
    if (pinnedIn.length === 0) html = `${dots}${gids.length} shapes · click to focus`;
    else if (pinnedIn.length === gids.length) html = `${dots}all ${gids.length} · click to clear`;
    else html = `${wdot(GIDS[pinnedIn[0]].hue)}${esc(KIND_LABEL[GIDS[pinnedIn[0]].kind])} · ${gids.indexOf(pinnedIn[0]) + 1} of ${gids.length} · click for next`;
  }
  wh.innerHTML = html;
  const base = sheet.getBoundingClientRect();
  const r = pk.getClientRects()[0];
  wh.style.left = Math.max(8, Math.min(r.left - base.left, base.width - 300)) + "px";
  wh.style.top = (r.top - base.top - 24) + "px";
  wh.classList.add("on");
}
function hideWhisper() {
  document.querySelectorAll(".whisper.on").forEach((w) => w.classList.remove("on"));
}

/* off-screen awareness — quiet pills at the viewport edge */
const pillUp = document.createElement("button");
const pillDown = document.createElement("button");
pillUp.className = "pill pill-up"; pillDown.className = "pill pill-down";
document.body.append(pillUp, pillDown);
let pillTargets = { up: null, down: null };
pillUp.addEventListener("click", () => pillTargets.up && pillTargets.up.scrollIntoView({ behavior: "smooth", block: "center" }));
pillDown.addEventListener("click", () => pillTargets.down && pillTargets.down.scrollIntoView({ behavior: "smooth", block: "center" }));

function updatePills() {
  const act = [...activeGids()];
  // while a pattern is pinned the card is the navigator; pills serve hover only
  if (!act.length || pinned.size) { pillUp.classList.remove("on"); pillDown.classList.remove("on"); return; }
  const anchors = act.flatMap((g) => GIDS[g].anchors.map((a) => a.el));
  const above = [], below = [];
  let sheetRect = null;
  for (const a of anchors) {
    const r = a.getBoundingClientRect();
    if (r.bottom < 64) above.push(a);
    else if (r.top > innerHeight - 36) below.push(a);
    if (!sheetRect) sheetRect = a.closest(".sheet").getBoundingClientRect();
  }
  const hue = GIDS[act[0]].hue;
  const cx = sheetRect ? sheetRect.left + 62 : innerWidth / 2;
  for (const [pill, list, arrow] of [[pillUp, above, "↑"], [pillDown, below, "↓"]]) {
    if (list.length) {
      pill.textContent = `${arrow} ${list.length} more`;
      pill.style.color = hue; pill.style.left = cx + "px";
      pill.classList.add("on");
    } else pill.classList.remove("on");
  }
  pillTargets = { up: above[above.length - 1] || null, down: below[0] || null };
}
addEventListener("scroll", () => { if (activeGids().size) { updatePills(); updateCardView(); } }, { passive: true });

/* connection card — the one held connection, condensed to one glance.
 * Docked in the study's right rail in the app's Living Margin voice: dense
 * UI type, hairline separations, no heavy fills. One implementation serves
 * both views; the Reading/Traces toggle changes the page, never the card.
 * It appears only while a connection is held (click) — hover alone never
 * shows it — and it presents exactly the focused connection. Switching
 * happens in the text (phrase cycling) or on the held rail ticks.
 * Structured to map 1:1 onto a future React <ConnectionCard>: one container,
 * flat class names, the kind hue carried by one custom property. */
const CARDS = {};
for (const sid of Object.keys(SHEETS)) {
  const rail = document.querySelector(`[data-rail="${sid}"]`);
  const card = document.createElement("aside");
  card.className = "ccard";
  card.tabIndex = -1;
  card.dataset.study = sid;
  card.setAttribute("aria-label", `${SHEETS[sid].title} · active connection`);
  rail.prepend(card);
  CARDS[sid] = card;
}

function traceTitle(G) {
  const prefix = `${KIND_LABEL[G.kind]} · `;
  return G.label.startsWith(prefix) ? G.label.slice(prefix.length) : G.label;
}

/* one card language: the kind tick is a short rule — an echo of the line
 * vocabulary, never an icon. Hue carries the kind; text names it. */
function kindTick() {
  return `<i class="card-tick" aria-hidden="true"></i>`;
}
function momentsWord(n) { return `${n} ${n === 1 ? "moment" : "moments"}`; }

/* the card appears only while a connection is held; it shows exactly the
 * focused one. The marked phrases, washes, and the in-text whisper are the
 * whole discovery surface — the margin never lists what is not held. */
function updateCard() {
  for (const sid of Object.keys(SHEETS)) {
    const card = CARDS[sid];
    const held = [...pinned].filter((g) => GIDS[g]?.study === sid);
    const gid = FOCUS_GID && held.includes(FOCUS_GID) ? FOCUS_GID : held.at(-1);
    if (!gid) {
      card.classList.remove("on");
      card.dataset.key = "";
      card.innerHTML = "";
      continue;
    }
    const G = GIDS[gid];
    /* rebuild only when the card's content actually changes, so hover and
     * scroll churn never steal focus from the observation mid-sentence */
    const key = `${gid}|${held.join(",")}|${G.anchors.length}|${G.label}`;
    if (card.dataset.key === key && card.classList.contains("on")) continue;
    card.dataset.key = key;
    card.dataset.gid = gid;
    card.style.setProperty("--ccard-hue", G.hue);
    card.innerHTML = "";

    const head = document.createElement("header");
    head.className = "ccard-head";
    head.innerHTML = kindTick();
    const title = document.createElement("span");
    title.className = "ccard-title";
    if (gid.startsWith("u-")) {
      const rec = USER.find((p) => p.id === gid);
      title.textContent = rec?.label || traceTitle(G);
      title.contentEditable = "plaintext-only";
      title.spellcheck = false;
      title.title = "click to rename";
      title.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); title.blur(); } });
      title.addEventListener("blur", () => {
        renameUser(gid, title.textContent);
        rebuildAll();
        applyActive();
      });
      title.addEventListener("click", (ev) => ev.stopPropagation());
    } else {
      title.textContent = traceTitle(G); // kind already speaks in the meta line
    }
    head.appendChild(title);
    card.appendChild(head);

    /* the one concession to plurality: plain text, no interaction */
    const others = held.length - 1;
    const kindLine = document.createElement("p");
    kindLine.className = "ccard-kind";
    kindLine.textContent = `${KIND_LABEL[G.kind]} · ${momentsWord(G.anchors.length)}`
      + (others > 0 ? ` · ${others} more held` : "");
    card.appendChild(kindLine);

    const note = document.createElement("textarea");
    note.className = "ccard-note";
    note.rows = 1;
    note.placeholder = "why these? note an observation…";
    note.value = getNote(gid);
    const grow = () => { note.style.height = "auto"; note.style.height = note.scrollHeight + "px"; };
    /* persist on input so a rebuild cannot outrun a pending change event */
    note.addEventListener("input", () => { grow(); setNote(gid, note.value); });
    note.addEventListener("click", (ev) => ev.stopPropagation());
    note.addEventListener("mouseup", (ev) => ev.stopPropagation());
    card.appendChild(note);
    requestAnimationFrame(grow);

    const moments = document.createElement("ol");
    moments.className = "ccard-moments";
    moments.setAttribute("aria-label", `${traceTitle(G)} source moments`);
    for (const a of G.anchors) {
      const row = document.createElement("li");
      row.className = "ccard-moment";
      row._el = a.el;
      const jump = document.createElement("button");
      jump.type = "button";
      jump.className = "ccard-jump";
      const [book, ch, v] = a.ref.split(".");
      jump.setAttribute("aria-label", `${book} ${ch}:${v}, ${a.phrase}`);
      const ref = document.createElement("span"); ref.className = "ccard-ref"; ref.textContent = `${ch}:${v}`;
      const phrase = document.createElement("span"); phrase.className = "ccard-phrase"; phrase.textContent = a.phrase;
      const state = document.createElement("span"); state.className = "ccard-state"; state.setAttribute("aria-hidden", "true");
      jump.append(ref, phrase, state);
      jump.addEventListener("click", (e) => {
        e.stopPropagation();
        a.el.scrollIntoView({ behavior: REDUCED_MOTION ? "auto" : "smooth", block: "center" });
      });
      row.appendChild(jump);
      if (gid.startsWith("u-")) {
        const rm = document.createElement("button");
        rm.type = "button"; rm.className = "ccard-remove"; rm.textContent = "Remove";
        rm.setAttribute("aria-label", `remove ${ch}:${v} “${a.phrase}” from this connection`);
        rm.addEventListener("click", (e) => { e.stopPropagation(); removeMember(gid, a.ref, a.phrase, a.occ); });
        row.appendChild(rm);
      }
      moments.appendChild(row);
    }
    card.appendChild(moments);

    const actions = document.createElement("div");
    actions.className = "ccard-actions";
    if (gid.startsWith("u-")) {
      const add = document.createElement("button");
      add.type = "button"; add.textContent = "Add words";
      add.addEventListener("click", (e) => { e.stopPropagation(); startExtend(gid); });
      actions.appendChild(add);
    }
    const exportBtn = document.createElement("button");
    exportBtn.type = "button"; exportBtn.textContent = "Export SVG";
    exportBtn.addEventListener("click", (e) => { e.stopPropagation(); exportCard(gid); });
    const release = document.createElement("button");
    release.type = "button"; release.textContent = "Release";
    release.addEventListener("click", (e) => {
      e.stopPropagation();
      pinned.delete(gid);
      hovered.delete(gid);
      FOCUS_GID = [...pinned].filter((g) => GIDS[g]?.study === sid).at(-1) || null;
      applyActive();
    });
    actions.append(exportBtn, release);
    if (gid.startsWith("u-")) {
      const del = document.createElement("button");
      del.type = "button"; del.className = "is-danger"; del.textContent = "Delete";
      del.addEventListener("click", (e) => { e.stopPropagation(); deleteUserPattern(gid); });
      actions.appendChild(del);
    }
    card.appendChild(actions);
    card.classList.add("on");
  }
  updateCardView();
}
function updateCardView() {
  /* off-screen speaks in plain words — above, below, here — and the row
   * nearest the reading position carries the same quiet inset rule */
  for (const card of Object.values(CARDS)) {
    if (!card.classList.contains("on")) continue;
    const rows = [...card.querySelectorAll(".ccard-moment")];
    let closest = null;
    let closestDistance = Infinity;
    rows.forEach((row) => {
      const r = row._el.getBoundingClientRect();
      const off = r.bottom < 72 ? "above" : r.top > innerHeight - 36 ? "below" : "";
      row.classList.toggle("is-away", !!off);
      row.querySelector(".ccard-state").textContent = off || "here";
      const distance = Math.abs((r.top + r.bottom) / 2 - innerHeight * 0.42);
      if (!off && distance < closestDistance) { closest = row; closestDistance = distance; }
    });
    rows.forEach((row) => row.classList.toggle("is-current", row === closest));
  }
}

/* ── export — a pinned pattern as a letterpress card (SVG) ─
 * Cream stock, the pattern's own mark language on the left spine,
 * ref + phrase per member, kind named in small caps. Shareable. */
const EXPORT_HUES = {
  "link:parallel": "#4E9A5F", "link:contrast": "#C05A80", "link:echo": "#4678C8",
  hinge: "#4E9A5F", mirror: "#8760C4", series: "#C8961E",
};
function esc(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function exportCard(gid) {
  const G = GIDS[gid];
  const hue = EXPORT_HUES[G.kind];
  const cfg = SHEETS[G.study];
  const W = 900, rowH = 58, padX = 84, top = 168;
  const rows = G.anchors.map((a) => {
    const [, ch, v] = a.ref.split(".");
    return { ref: `${ch}:${v}`, phrase: a.phrase };
  });
  const noteLines = [];
  const noteText = getNote(gid);
  if (noteText) {
    let line = "";
    for (const w of noteText.split(/\s+/)) {
      if ((line + " " + w).trim().length > 62) { noteLines.push(line.trim()); line = w; }
      else line += " " + w;
      if (noteLines.length === 5) break;
    }
    if (line.trim() && noteLines.length < 6) noteLines.push(line.trim());
  }
  const noteH = noteLines.length ? 34 + noteLines.length * 26 : 0;
  const H = top + rows.length * rowH + noteH + 96;
  const spineX = padX + 34, refX = padX + 118, txtX = padX + 138;
  const y0 = top + rowH / 2, y1 = top + (rows.length - 1) * rowH + rowH / 2;
  const spine = rows.length > 2
    ? `<path d="M ${spineX} ${y0} V ${y1}" stroke="${hue}" stroke-width="1.2" opacity="0.55"/>`
    : `<path d="M ${spineX + 24} ${y0} C ${spineX - 14} ${y0 + 4}, ${spineX - 14} ${y1 - 4}, ${spineX + 24} ${y1}" fill="none" stroke="${hue}" stroke-width="1.4" stroke-linecap="round"/>`;
  const marks = rows.map((r, i) => {
    const y = top + i * rowH + rowH / 2;
    return `<path d="M ${spineX} ${y} H ${refX - 26}" stroke="${hue}" stroke-width="1" opacity="0.35"/>
      <circle cx="${refX - 26}" cy="${y}" r="2.4" fill="${hue}"/>
      <text x="${refX}" y="${y + 4}" text-anchor="end" font-family="ui-monospace, 'JetBrains Mono', monospace" font-size="12" fill="#6B6254">${r.ref}</text>
      <text x="${txtX}" y="${y + 6}" font-family="'Source Serif 4', Georgia, serif" font-size="21" fill="#181511">${esc(shortQuote(r.phrase, 52))}</text>
      <path d="M ${txtX} ${y + 14} H ${txtX + Math.min(r.phrase.length, 52) * 9.6}" stroke="${hue}" stroke-width="1.4" opacity="0.85"/>`;
  }).join("\n");
  const [kindWord, ...rest] = G.label.split(" · ");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" rx="26" fill="#FAF6EC"/>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="25.5" fill="none" stroke="#E4DAC9"/>
  <circle cx="${padX}" cy="76" r="5" fill="${hue}"/>
  <text x="${padX + 18}" y="81" font-family="ui-monospace, 'JetBrains Mono', monospace" font-size="13" letter-spacing="3" fill="#6B6254">${esc(kindWord.toUpperCase())} · ${esc(cfg.title.toUpperCase())}</text>
  <text x="${padX}" y="128" font-family="'Source Serif 4', Georgia, serif" font-size="30" font-weight="600" fill="#181511">${esc(rest.join(" · "))}</text>
  ${spine}
  ${marks}
  ${noteLines.map((l, i) =>
    `<text x="${padX}" y="${top + rows.length * rowH + 44 + i * 26}" font-family="'Source Serif 4', Georgia, serif" font-size="16" font-style="italic" fill="#4D463C">${esc(l)}</text>`
  ).join("\n")}
  <text x="${padX}" y="${H - 44}" font-family="ui-monospace, 'JetBrains Mono', monospace" font-size="11" letter-spacing="1.5" fill="#9A8F7D">${esc(cfg.ref)} · PATTERN SHAPES</text>
</svg>`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  a.download = `${(rest.join("-") || gid).replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "pattern"}.svg`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ── revelation matrix panel ─────────────────────────────── */
function glyphSVGString(name, partial, earPos) {
  const extra = earPos ? `<text x="${earPos === "pre" ? -4 : 18}" y="10" font-size="7" font-family="var(--font-mono)" fill="var(--text-tertiary)">${earPos === "pre" ? "≺" : "≻"}</text>` : "";
  return `<svg class="glyph" width="18" height="18" viewBox="-4 -4 22 22" style="overflow:visible;opacity:${partial ? 0.45 : 1}"><path d="${GLYPH_PATHS[name]}" fill="none" stroke="var(--k-series)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>${extra}</svg>`;
}
function buildRevPanel() {
  const panel = document.querySelector('[data-panel="rev"]');
  const P = PATTERNS.rev[0];
  const els = P.elementSchema;
  const keyed = new Set(["address", "know", "promise", "ear"]);
  panel.innerHTML = `<h3>One letter, seven times</h3><div class="panel-sub">absence is data · hover a column to trace it in the text</div>
    <div class="matrix" style="grid-template-columns: 96px repeat(7, 1fr)">
      <div></div>${els.map((e) => `<div class="mhead" ${keyed.has(e) ? `data-gids="rev23:${e}"` : ""}>${e}</div>`).join("")}
      ${P.members.map((m) => `<div class="mrow" data-letter="${m.role}">
        <div class="mrow-label">${m.role}<span class="cell-ref">${m.range[0].replace("REV.", "")}–${m.range[1].split(".")[2]}</span></div>
        ${els.map((el) => {
          const has = !!m.elements[el];
          const partial = (m.partial || []).includes(el);
          const gid = keyed.has(el) ? ` data-gids="rev23:${el}"` : "";
          return `<div class="mcell"${gid}>${has ? glyphSVGString(el, partial, el === "ear" ? m.earPos : null) : `<span style="color:var(--border-medium);font-size:9px">·</span>`}</div>`;
        }).join("")}
      </div>`).join("")}
    </div>
    <div class="panel-note">≺ ear before promise · ≻ after — the flip lands after Thyatira. Rows: click a name to jump to that letter.</div>`;
  panel.querySelectorAll(".mrow-label").forEach((lbl) => {
    lbl.addEventListener("click", () => {
      const head = document.querySelector(`.letter-head[data-letter="${lbl.parentElement.dataset.letter}"]`);
      if (head) head.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

/* ── authoring — select words, pick a tool, wire the counterpart ──
 * Selection is the gesture (picking words is what selection is for);
 * the tldraw part is the live wire that follows the cursor until the
 * counterpart is chosen. Records land in localStorage as the same
 * shape-marks payload the built-ins use. */
let SESSION = null; // { kind, members: [{ref, phrase, range}], study }
const AUTHOR_KINDS = ["link:parallel", "link:contrast", "link:echo", "mirror", "series", "hinge"];
const authbar = document.createElement("div");
authbar.className = "authbar";
document.body.appendChild(authbar);

function nodeRow(n) { return (n.nodeType === 3 ? n.parentElement : n)?.closest?.(".vrow") || null; }
function selectionInfo() {
  const sel = getSelection();
  if (!sel.rangeCount || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  const row = nodeRow(range.commonAncestorContainer);
  if (!row || !row.closest(".sheet")) return null;
  const phrase = sel.toString().replace(/\s+/g, " ").trim();
  if (phrase.length < 2) return null;
  // which occurrence did they actually select? measure the selection's
  // absolute offset in the verse, then rank it among the phrase's matches
  const vt = row.querySelector(".vtext");
  const pre = document.createRange();
  pre.selectNodeContents(vt);
  pre.setEnd(range.startContainer, range.startOffset);
  const raw = sel.toString();
  const abs = pre.toString().length + (raw.length - raw.trimStart().length);
  const full = vt.textContent;
  const positions = [];
  for (let i = full.indexOf(phrase); i !== -1; i = full.indexOf(phrase, i + 1)) positions.push(i);
  let occ = positions.indexOf(abs);
  if (occ === -1) occ = Math.max(0, positions.findIndex((p) => p >= abs));
  return { ref: row.dataset.key, phrase, occ, range: range.cloneRange() };
}
function placeAuthbar(rect) {
  authbar.style.left = Math.max(12, Math.min(rect.left + rect.width / 2 - authbar.offsetWidth / 2, innerWidth - authbar.offsetWidth - 12)) + "px";
  authbar.style.top = Math.max(60, rect.top - 46) + "px";
}
/* each kind explains itself in plain words while you decide */
const KIND_DEF = {
  "link:parallel": "the same thought, said again in other words",
  "link:contrast": "two things set against each other",
  "link:echo": "a word or phrase that returns from earlier",
  mirror: "paired halves that answer each other in order",
  series: "the same phrase recurring — a refrain",
  hinge: "one line that weighs both sides",
};
const DEF_RESTING = "connect the words — or lay a wash";

/* one menu, two quiet rows: connection kinds above, highlight washes below.
 * Same selection gesture feeds both; a divider keeps the vocabularies apart. */
function showKindPalette(info) {
  authbar.innerHTML = "";
  authbar.classList.add("palette");
  const def = document.createElement("div"); def.className = "authdef";
  def.textContent = DEF_RESTING;
  const row = document.createElement("div"); row.className = "authrow";
  for (const kind of AUTHOR_KINDS) {
    const b = document.createElement("button");
    b.className = "ak";
    b.innerHTML = `<i style="background:${KIND_HUE[kind]}"></i>${KIND_LABEL[kind]}`;
    b.addEventListener("mousedown", (e) => e.preventDefault()); // keep the selection
    b.addEventListener("mouseenter", () => { def.textContent = KIND_DEF[kind]; });
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      startSession(kind, info);
    });
    row.appendChild(b);
  }
  row.addEventListener("mouseleave", () => { def.textContent = DEF_RESTING; });
  const hlrow = document.createElement("div"); hlrow.className = "authrow hlrow";
  for (const color of HIGHLIGHT_COLORS) {
    const b = document.createElement("button");
    b.className = "ak hl";
    b.setAttribute("aria-label", `highlight ${color}`);
    b.innerHTML = `<i style="background:var(--hl-${color}-ink)"></i>${color}`;
    b.addEventListener("mousedown", (e) => e.preventDefault()); // keep the selection
    b.addEventListener("mouseenter", () => { def.textContent = `a quiet ${color} wash behind these words`; });
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      createHighlight(info, color);
    });
    hlrow.appendChild(b);
  }
  hlrow.addEventListener("mouseleave", () => { def.textContent = DEF_RESTING; });
  authbar.append(row, hlrow, def);
  authbar.classList.add("on");
  placeAuthbar(info.range.getBoundingClientRect());
}
function sessionBar(msg) {
  const G = SESSION;
  authbar.classList.remove("palette");
  authbar.innerHTML = `<span class="ak" style="cursor:default"><i style="background:${KIND_HUE[G.kind]}"></i>${KIND_LABEL[G.kind]}</span>
    <span class="hint">${msg}</span>`;
  if (G.extend) {
    const done = document.createElement("button"); done.className = "ak act"; done.textContent = "done";
    done.addEventListener("click", (e) => { e.stopPropagation(); endSession(); });
    authbar.appendChild(done);
  } else {
    if (!BINARY_KINDS.has(G.kind) && G.members.length >= 2) {
      const done = document.createElement("button"); done.className = "ak act"; done.textContent = "done";
      done.addEventListener("click", (e) => { e.stopPropagation(); finalizeSession(); });
      authbar.appendChild(done);
    }
    const cancel = document.createElement("button"); cancel.className = "ak"; cancel.textContent = "cancel";
    cancel.addEventListener("click", (e) => { e.stopPropagation(); endSession(); });
    authbar.appendChild(cancel);
  }
  authbar.classList.add("on");
  const anchor = G.members[G.members.length - 1];
  if (anchor) placeAuthbar(anchor.range.getBoundingClientRect());
  else {
    const rail = document.querySelector(`[data-rail="${G.study}"]`);
    const target = rail.querySelector(".ccard.on");
    if (target) placeAuthbar(target.getBoundingClientRect());
  }
}
function startSession(kind, info) {
  const study = refStudy(info.ref);
  if (!study) { endSession(); return; }
  SESSION = { kind, members: [info], study };
  getSelection().removeAllRanges();
  sessionBar(BINARY_KINDS.has(kind) ? "select the counterpart" : "select the next occurrence");
  liveWire();
}
function captureMember() {
  const info = selectionInfo();
  if (!info) return;
  if (refStudy(info.ref) !== SESSION.study) { sessionBar("stay within this passage"); return; }
  if (SESSION.extend) {
    // extending an existing pattern: each selection lands immediately
    const rec = USER.find((p) => p.id === SESSION.extend);
    if (!rec || rec.members.some((m) => m.ref === info.ref && m.phrase === info.phrase && (m.occ || 0) === info.occ)) return;
    rec.members.push({ ref: info.ref, phrase: info.phrase, ...(info.occ ? { occ: info.occ } : {}) });
    if (!rec.custom) rec.label = userLabel(rec.kind, rec.members);
    saveUser();
    getSelection().removeAllRanges();
    rebuildAll();
    applyActive();
    sessionBar(`${rec.members.length} in the pattern · select more, or finish`);
    return;
  }
  if (SESSION.members.some((m) => m.ref === info.ref && m.phrase === info.phrase && m.occ === info.occ)) return;
  SESSION.members.push(info);
  getSelection().removeAllRanges();
  if (BINARY_KINDS.has(SESSION.kind) && SESSION.members.length === 2) { finalizeSession(); return; }
  sessionBar(`${SESSION.members.length} marked · select the next, or finish`);
}
function startExtend(gid) {
  const G = GIDS[gid];
  SESSION = { kind: G.kind, members: [], study: G.study, extend: gid };
  pinned.add(gid);
  applyActive();
  sessionBar("select the words to add");
}
function finalizeSession() {
  const { kind, members } = SESSION;
  const rec = {
    id: `u-${Date.now()}`,
    kind,
    label: userLabel(kind, members),
    members: members.map(({ ref, phrase, occ }) => ({ ref, phrase, ...(occ ? { occ } : {}) })),
  };
  USER.push(rec);
  saveUser();
  endSession();
  rebuildAll();
  pinned.clear(); hovered.clear();
  pinned.add(rec.id);
  FOCUS_GID = rec.id;
  applyActive();
}
function endSession() {
  SESSION = null;
  authbar.classList.remove("on");
  document.querySelectorAll("svg.overlay g.live").forEach((g) => g.remove());
  document.querySelectorAll("svg.overlay").forEach((s) => { s.dataset.key = "~"; });
  applyActive();
}
function createHighlight(info, color) {
  USER.push({
    id: `h-${Date.now()}`, type: "highlight", color,
    key: { ref: info.ref, phrase: info.phrase, ...(info.occ ? { occ: info.occ } : {}) },
  });
  saveUser();
  getSelection().removeAllRanges();
  authbar.classList.remove("on");
  rebuildAll();
  applyActive();
}

/* removing a highlight — click the washed words while nothing is selected
 * and a small chip offers the one action a wash has */
const hlbar = document.createElement("div");
hlbar.className = "hlbar";
document.body.appendChild(hlbar);
function hideHlbar() { hlbar.classList.remove("on"); }
function highlightAt(sid, x, y) {
  const sheet = document.querySelector(`[data-sheet="${sid}"]`);
  if (!sheet) return null;
  const base = sheet.getBoundingClientRect();
  const px = x - base.left, py = y - base.top;
  const list = HL_HITS[sid] || [];
  for (let i = list.length - 1; i >= 0; i--) { // last drawn wins, like paint order
    if (list[i].rects.some((r) => px >= r.x0 && px <= r.x1 && py >= r.y0 && py <= r.y1)) return list[i];
  }
  return null;
}
function showHlRemove(hit, x, y) {
  hlbar.innerHTML = "";
  const b = document.createElement("button");
  b.className = "ak";
  b.setAttribute("aria-label", `remove ${hit.color} highlight`);
  b.innerHTML = `<i style="background:var(--hl-${hit.color}-ink)"></i>remove highlight`;
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    removeHighlight(hit.id);
    hideHlbar();
  });
  hlbar.appendChild(b);
  hlbar.classList.add("on");
  hlbar.style.left = Math.max(12, Math.min(x - hlbar.offsetWidth / 2, innerWidth - hlbar.offsetWidth - 12)) + "px";
  hlbar.style.top = Math.max(60, y - 40) + "px";
}
function removeHighlight(id) {
  const snap = JSON.stringify(USER);
  USER = USER.filter((r) => r.id !== id);
  saveUser();
  rebuildAll();
  applyActive();
  offerUndo("highlight removed", snap);
}
document.addEventListener("mousedown", (e) => { if (!e.target.closest?.(".hlbar")) hideHlbar(); });
addEventListener("scroll", hideHlbar, { passive: true });

function deleteUserPattern(gid, silent) {
  const snap = JSON.stringify(USER);
  USER = USER.filter((p) => p.id !== gid);
  saveUser();
  pinned.delete(gid); hovered.delete(gid);
  rebuildAll();
  applyActive();
  if (!silent) offerUndo("mark deleted", snap, gid);
}

/* the live wire — provisional marks + a dashed thread chasing the cursor */
function liveWire(e) {
  if (!SESSION) return;
  const M = measure(SESSION.study);
  let g = M.svg.querySelector("g.live");
  if (!g) g = S("g", { class: "live" }, M.svg);
  g.innerHTML = "";
  const hue = KIND_HUE[SESSION.kind];
  let last = null;
  for (const m of SESSION.members) {
    const rects = [...m.range.getClientRects()];
    for (const r of rects) {
      S("path", {
        d: `M ${r.left - M.base.left} ${r.bottom - M.base.top - TG.constants.UNDERLINE_CENTER_OFFSET} H ${r.right - M.base.left}`,
        stroke: hue, "stroke-width": 1.6, fill: "none", "stroke-linecap": "round",
      }, g);
    }
    if (rects[0]) last = {
      x: rects[0].left - M.base.left - (TG.constants.TOUCH_RADIUS - TG.constants.TOUCH_OVERLAP),
      y: rects[0].bottom - M.base.top - TG.constants.UNDERLINE_CENTER_OFFSET,
    };
    if (last) S("circle", { cx: last.x, cy: last.y, r: TG.constants.TOUCH_RADIUS, fill: hue }, g);
  }
  if (last && e) {
    /* the provisional wire is the same line as everything else —
     * its uncommitted state reads as reticence, not a dash pattern */
    S("path", {
      d: `M ${last.x} ${last.y} L ${e.clientX - M.base.left} ${e.clientY - M.base.top}`,
      stroke: hue, "stroke-width": 1.2, fill: "none",
      "stroke-linecap": "round", opacity: 0.45,
    }, g);
  }
}
addEventListener("mousemove", (e) => { if (SESSION) requestAnimationFrame(() => liveWire(e)); });
document.addEventListener("mouseup", (e) => {
  if (e.target.closest?.(".authbar")) return;
  setTimeout(() => {
    if (SESSION) { captureMember(); return; }
    const info = selectionInfo();
    if (info) showKindPalette(info);
    else authbar.classList.remove("on");
  }, 0);
});

/* ── events ──────────────────────────────────────────────── */
function gidsOf(el) { return el.dataset.gids.split(" "); }

/* hover intent — the page only awakens for a deliberate pause, and
 * survives the cursor crossing small gaps without flickering asleep */
let hoverTimer = 0, sleepTimer = 0;
let responsiveRedrawFrame = 0;
let sheetResizeObserver = null;

function scheduleResponsiveRedraw() {
  if (responsiveRedrawFrame) return;
  responsiveRedrawFrame = requestAnimationFrame(() => {
    responsiveRedrawFrame = 0;
    redrawActive();
    drawAllHighlights();
  });
}

function bindHeldTickPointerDelegate(scope) {
  if (scope.dataset.tickPointerDelegate === "true") return;
  scope.dataset.tickPointerDelegate = "true";
  let pendingTickPointer = null;
  let suppressTickClick = null;
  const tickAtPointer = (event) => {
    const svg = scope.querySelector("svg.overlay");
    if (!svg) return null;
    const direct = event.target && event.target.closest && event.target.closest(".tick-hit");
    if (direct && svg.contains(direct)) return direct;
    return [...svg.querySelectorAll(".tick-hit")].find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return event.clientX >= rect.left && event.clientX <= rect.right &&
        event.clientY >= rect.top && event.clientY <= rect.bottom;
    }) || null;
  };
  scope.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.isPrimary === false) return;
    const hit = tickAtPointer(event);
    if (!hit) return;
    pendingTickPointer = {
      pointerId: event.pointerId,
      key: hit.getAttribute("data-tick-key"),
      x: event.clientX,
      y: event.clientY,
    };
  }, true);
  scope.addEventListener("pointerup", (event) => {
    const pending = pendingTickPointer;
    pendingTickPointer = null;
    if (!pending || pending.pointerId !== event.pointerId) return;
    /* A tick-origin gesture owns its one follow-up click even when bloom
     * replaced the child link between pointerdown and pointerup. */
    suppressTickClick = { x: event.clientX, y: event.clientY, until: performance.now() + 250 };
    if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > 8) return;
    const hit = tickAtPointer(event);
    if (!hit || hit.getAttribute("data-tick-key") !== pending.key) return;
    event.preventDefault();
    event.stopPropagation();
    commitHeldShape(hit.getAttribute("data-tick-gid"));
  }, true);
  scope.addEventListener("pointercancel", () => { pendingTickPointer = null; }, true);
  scope.addEventListener("click", (event) => {
    const suppression = suppressTickClick;
    suppressTickClick = null;
    if (!suppression || performance.now() > suppression.until ||
        Math.hypot(event.clientX - suppression.x, event.clientY - suppression.y) > 8) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
}

function wire() {
  document.querySelectorAll(".study").forEach((scope) => {
    bindHeldTickPointerDelegate(scope);
    scope.addEventListener("mouseover", (e) => {
      const t = e.target.closest("[data-gids]");
      if (!t || !scope.contains(t)) return;
      clearTimeout(sleepTimer);
      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => {
        const gs = gidsOf(t);
        hovered.clear();
        // once you've cycled to a specific pattern, hover defers to your choice
        if (!gs.some((g) => pinned.has(g))) gs.forEach((g) => hovered.add(g));
        applyActive();
        if (t.classList.contains("pk")) showWhisper(t);
      }, 140);
    });
    scope.addEventListener("mouseout", (e) => {
      const to = e.relatedTarget;
      if (to && to.closest && to.closest("[data-gids]")) return;
      clearTimeout(hoverTimer);
      sleepTimer = setTimeout(() => {
        if (hovered.size) { hovered.clear(); applyActive(); }
        hideWhisper();
      }, 90);
    });
    scope.addEventListener("click", (e) => {
      if (SESSION || !getSelection().isCollapsed) return; // authoring owns the gesture
      // a click on washed words offers the highlight's one edit: remove.
      // The chip rides alongside pattern cycling, so a wash stays removable
      // even when a pattern claims the same words.
      const sheetEl = e.target.closest(".sheet");
      const hit = sheetEl ? highlightAt(sheetEl.dataset.sheet, e.clientX, e.clientY) : null;
      if (hit) showHlRemove(hit, e.clientX, e.clientY);
      const t = e.target.closest("[data-gids]");
      if (!t) {
        if (pinned.size && !e.target.closest(".rail")) { pinned.clear(); applyActive(); }
        return;
      }
      /* one pattern: click toggles. Shared words: click cycles through
       * what they carry — first pattern → second → … → all → none. */
      const gs = gidsOf(t);
      if (gs.length === 1) {
        pinned.has(gs[0]) ? pinned.delete(gs[0]) : pinned.add(gs[0]);
      } else {
        const all = gs.every((g) => pinned.has(g));
        const idx = gs.findIndex((g) => pinned.has(g));
        gs.forEach((g) => pinned.delete(g));
        if (all) { /* → none */ }
        else if (idx === -1) pinned.add(gs[0]);
        else if (idx < gs.length - 1) pinned.add(gs[idx + 1]);
        else gs.forEach((g) => pinned.add(g));
      }
      // the display and the whisper follow the click immediately
      gs.forEach((g) => hovered.delete(g));
      FOCUS_GID = gs.find((x) => pinned.has(x)) || [...pinned].pop() || null;
      applyActive();
      if (t.classList.contains("pk")) showWhisper(t);
    });
  });
  addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (hlbar.classList.contains("on")) { hideHlbar(); return; }
    if (SESSION) { endSession(); return; }
    if (pinned.size || hovered.size) {
      pinned.clear(); hovered.clear(); applyActive(); hideWhisper();
    }
  });
  document.getElementById("route-seg").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    ROUTE = b.dataset.route;
    localStorage.setItem(ROUTE_KEY, ROUTE);
    document.body.dataset.route = ROUTE;
    syncRadioGroup(e.currentTarget, b);
    redrawActive();
    /* the view toggle reflows the reading column — washes must remeasure
     * with the connectors, not a ResizeObserver frame later */
    drawAllHighlights();
  });
  document.getElementById("density-btn").addEventListener("click", (e) => {
    DENSITY_MODE = !DENSITY_MODE;
    e.currentTarget.setAttribute("aria-pressed", DENSITY_MODE);
    e.currentTarget.textContent = DENSITY_MODE ? "Dense Psalm · 14" : "Dense Psalm";
    if (!DENSITY_MODE) {
      for (const gid of [...pinned, ...hovered]) {
        if (gid.startsWith("stress-")) { pinned.delete(gid); hovered.delete(gid); }
      }
      if (FOCUS_GID?.startsWith("stress-")) FOCUS_GID = [...pinned].at(-1) || null;
    }
    rebuildAll();
    applyActive();
  });
  document.getElementById("long-btn").addEventListener("click", (e) => {
    LONG_MODE = !LONG_MODE;
    e.currentTarget.setAttribute("aria-pressed", LONG_MODE);
    e.currentTarget.textContent = LONG_MODE ? "Long text · 22" : "Long text";
    document.body.dataset.longText = LONG_MODE ? "true" : "false";
    if (!LONG_MODE) {
      for (const gid of [...pinned, ...hovered]) {
        if (gid.startsWith("revstress-")) { pinned.delete(gid); hovered.delete(gid); }
      }
      if (FOCUS_GID?.startsWith("revstress-")) FOCUS_GID = [...pinned].at(-1) || null;
    }
    rebuildAll();
    applyActive();
    if (LONG_MODE) requestAnimationFrame(() => {
      document.getElementById("study-rev")?.scrollIntoView({ behavior: REDUCED_MOTION ? "auto" : "smooth", block: "start" });
    });
  });
  document.getElementById("angles-btn").addEventListener("click", (e) => {
    ANGLE_MODE = !ANGLE_MODE;
    e.currentTarget.setAttribute("aria-pressed", ANGLE_MODE);
    e.currentTarget.textContent = ANGLE_MODE ? `Angle proof · ${GEOMETRY_FIXTURE.patterns.length}` : "Angle proof";
    document.body.dataset.angleProof = ANGLE_MODE ? "true" : "false";
    document.getElementById("study-qa").hidden = !ANGLE_MODE;
    if (!ANGLE_MODE) {
      for (const gid of [...pinned, ...hovered]) {
        if (gid.startsWith("qa-")) { pinned.delete(gid); hovered.delete(gid); }
      }
      if (FOCUS_GID?.startsWith("qa-")) FOCUS_GID = [...pinned].at(-1) || null;
    }
    rebuildAll();
    applyActive();
    if (ANGLE_MODE) requestAnimationFrame(() => {
      document.getElementById("study-qa")?.scrollIntoView({ behavior: REDUCED_MOTION ? "auto" : "smooth", block: "start" });
    });
  });
  document.getElementById("reveal-btn").addEventListener("click", (e) => {
    const on = document.body.classList.toggle("reveal");
    e.currentTarget.setAttribute("aria-pressed", on);
  });
  document.getElementById("atm-seg").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    syncRadioGroup(e.currentTarget, b);
    document.body.className = `theme-${b.dataset.theme}` + (document.body.classList.contains("reveal") ? " reveal" : "");
    requestAnimationFrame(redrawActive);
  });
  addEventListener("resize", scheduleResponsiveRedraw);
  if (globalThis.ResizeObserver && !sheetResizeObserver) {
    sheetResizeObserver = new ResizeObserver(scheduleResponsiveRedraw);
    document.querySelectorAll(".sheet").forEach((sheet) => sheetResizeObserver.observe(sheet));
  }
}
function redrawActive() {
  document.querySelectorAll("svg.overlay").forEach((s) => { s.dataset.key = "~"; });
  applyActive();
}

function syncRadioGroup(group, selected) {
  group.querySelectorAll('button[role="radio"]').forEach((button) => {
    const checked = button === selected;
    button.setAttribute("aria-checked", checked);
    button.tabIndex = checked ? 0 : -1;
  });
}

function wireRadioKeys(group) {
  group.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const buttons = [...group.querySelectorAll('button[role="radio"]')];
    const current = Math.max(0, buttons.indexOf(document.activeElement));
    const next = event.key === "Home"
      ? 0
      : event.key === "End"
        ? buttons.length - 1
        : (current + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    event.preventDefault();
    buttons[next].focus();
    buttons[next].click();
  });
}

/* ── boot ────────────────────────────────────────────────── */
function rebuildAll() {
  buildGids();
  buildSheets();
  /* the sheets were rebuilt, so every anchor element the card rows point at
   * is new — force the next updateCard() to re-render instead of skipping */
  for (const card of Object.values(CARDS)) card.dataset.key = "";
  for (const s of Object.keys(SHEETS)) {
    const pre = document.querySelector(`[data-payload="${s}"]`);
    if (!pre) continue;
    const mine = USER.filter((p) => recStudy(p) === s);
    const builtIn = s === "qa" ? (ANGLE_MODE ? GEOMETRY_FIXTURE.patterns : []) : PATTERNS[s];
    pre.textContent = JSON.stringify(mine.length ? { builtIn, yours: mine } : builtIn, null, 2);
  }
  warmBlocks();
  drawAllHighlights();
}
rebuildAll();
buildRevPanel();
wire();
document.body.dataset.route = ROUTE;
const routeGroup = document.getElementById("route-seg");
const atmosphereGroup = document.getElementById("atm-seg");
syncRadioGroup(routeGroup, routeGroup.querySelector(`[data-route="${ROUTE}"]`));
syncRadioGroup(atmosphereGroup, atmosphereGroup.querySelector('[aria-checked="true"]'));
wireRadioKeys(routeGroup);
wireRadioKeys(atmosphereGroup);
applyActive();
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => {
  /* metrics measured before the webfont landed poison the ink-slack cache
   * (and with it every fragment bottom) — drop them and remeasure */
  inkSlackFor._cache = new Map();
  redrawActive(); warmBlocks(); drawAllHighlights();
});
