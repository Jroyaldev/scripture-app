/* Pattern shapes lab · v3 — "the text awakens".
 * At rest the page is almost plain scripture: keyed phrases carry only a
 * whisper of a dotted hint. Touch one and its whole pattern wakes — sibling
 * phrases ink in, a connector draws itself through the gutter, the rest of
 * the page recedes, and a small whisper names the shape. Click pins it.
 * No dialect switcher, no chrome at rest: one opinionated language.
 * Traces routing is the Loom engine (route-engine.js) — the same planner
 * as route.html; Reading keeps trace-geometry's local bows. */
import { planRoute, rankCompanions } from "./route-engine.js";

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
 * tests distance, recurrence, and a score with enough tracks to need its own
 * navigation. Revelation stays complete while this mode is on: none of its
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
  { id: "revstress-first-last", kind: "series", label: "first and last", members: [
    { ref: "REV.2.4", phrase: "your first love" },
    { ref: "REV.2.5", phrase: "the first works" },
    { ref: "REV.2.8", phrase: "The first and the last" },
    { ref: "REV.2.19", phrase: "your last works are more than the first" },
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
  for (const p of USER) {
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

/* letter boundaries for Revelation — quiet structural heads, like chapter heads */
const LETTER_STARTS = {};
for (const m of PATTERNS.rev[0].members) LETTER_STARTS[m.range[0]] = m.role;

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
    if (els?.length) GIDS[r.gid].anchors.push({ el: els[0], els, ref: r.ref, phrase: r.phrase, occ: r.occ });
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
    const t = document.createElement("div"); t.className = "sheet-title"; t.textContent = cfg.title;
    const r = document.createElement("div"); r.className = "sheet-ref"; r.textContent = cfg.ref;
    sheet.append(t, r);
    for (const ch of cfg.chapters) {
      if (ch.head) { const h = document.createElement("div"); h.className = "chap-head"; h.textContent = ch.head; sheet.appendChild(h); }
      for (const v of VERSES[ch.key]) {
        const ref = `${ch.key}.${v.verse}`;
        if (LETTER_STARTS[ref] && id === "rev") {
          const lh = document.createElement("div");
          lh.className = "letter-head"; lh.dataset.letter = LETTER_STARTS[ref];
          lh.textContent = LETTER_STARTS[ref];
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
        row.className = "vrow"; row.dataset.key = ref;
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
      ...USER.filter((p) => refStudy(p.members[0].ref) === id)
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

/* ── overlay: connectors that draw themselves on awaken ──── */
function measure(sid) {
  const sheet = document.querySelector(`[data-sheet="${sid}"]`);
  const svg = sheet.querySelector("svg.overlay");
  const base = sheet.getBoundingClientRect();
  svg.setAttribute("width", base.width); svg.setAttribute("height", base.height);
  let textLeft = Infinity;
  sheet.querySelectorAll(".vrow .vtext").forEach((el) => {
    textLeft = Math.min(textLeft, el.getBoundingClientRect().left - base.left);
  });
  return { sheet, svg, base, textLeft };
}
function measureAnchor(M, anchor, underlineOffset = 0) {
  const rects = (anchor.els || [anchor.el]).flatMap((el) => TG.relativeClientRects(M.base, el.getClientRects()));
  return TG.planMember(rects, underlineOffset);
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

/* ── the ink ribbon — the one line ───────────────────────────
 * A premium line is not a uniform stroke: it is a filled outline
 * around a centerline with a designed width profile — tapered ends,
 * restrained swell midway (≈55%→115% of nominal). The perfect-freehand
 * insight, composed rather than gestured: no pressure, no wobble.
 * There is exactly one profile. Kind never bends the line — it only
 * chooses the hue. */
function ribbonOutline(pts, w, frac = 1) {
  const total = pts.length;
  const count = Math.max(2, Math.round(total * Math.min(1, frac)));
  const L = [], R = [];
  for (let i = 0; i < count; i++) {
    const t = i / (total - 1);
    const ramp = Math.min(1, t / 0.16, (1 - t) / 0.16);
    let r = (w / 2) * (0.55 + 0.6 * Math.sin(Math.PI * t)) * (0.3 + 0.7 * ramp);
    if (frac < 1) {
      // mid-draw the leading edge narrows to a nib tip
      r *= Math.min(1, (count - 1 - i) / Math.max(1, total * 0.12));
    }
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(total - 1, i + 1)];
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    L.push(`${(pts[i].x + nx * r).toFixed(2)},${(pts[i].y + ny * r).toFixed(2)}`);
    R.push(`${(pts[i].x - nx * r).toFixed(2)},${(pts[i].y - ny * r).toFixed(2)}`);
  }
  return `M${L.join("L")}L${R.reverse().join("L")}Z`;
}
/* the ribbon draws itself: the ink flows point by point along the
 * centerline, leading edge tapered like a nib in contact */
function ribbonDraw(g, pts, hue, { w = 1.6, opacity = 1, delay = 0, dur = 380, role = "connector" } = {}) {
  const p = S("path", { d: "", fill: hue, stroke: "none", "data-role": role }, g);
  if (opacity < 1) p.setAttribute("opacity", opacity);
  if (REDUCED_MOTION) {
    p.setAttribute("d", ribbonOutline(pts, w, 1));
    return p;
  }
  const t0 = performance.now() + delay;
  const ease = (x) => 1 - Math.pow(1 - x, 3);
  function frame(now) {
    if (!p.isConnected) return; // overlay cleared mid-flight
    const u = Math.min(1, Math.max(0, (now - t0) / dur));
    if (u > 0) p.setAttribute("d", ribbonOutline(pts, w, ease(u)));
    if (u < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return p;
}
const ROUTE_KEY = "shape-marks-route";
let ROUTE = localStorage.getItem(ROUTE_KEY) === "bows" ? "bows" : "traces";
document.body.dataset.route = ROUTE;
let FOCUS_GID = null;
const MAX_MARGIN_TRACES = 4;
const LAST_PLANS = new Map();   // sid → Map(gid → plan) from the last Traces render
const LAST_INKED = new Map();   // sid → Set(companion gids) for lane hysteresis

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
function blockFor(sid, M) {
  const rel = (r) => ({ left: r.left - M.base.left, right: r.right - M.base.left, top: r.top - M.base.top, bottom: r.bottom - M.base.top });
  /* word runs cache on layout dimensions — focus/hover replans reuse it */
  const wrKey = `${sid}|${M.base.width}x${M.sheet.scrollHeight}|${ROUTE}`;
  const wrCache = blockFor._wr || (blockFor._wr = new Map());
  let wordRuns = wrCache.get(wrKey);
  if (!wordRuns) {
    wordRuns = [];
    const range = document.createRange();
    M.sheet.querySelectorAll(".vrow .vtext").forEach((el) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node;
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
            wordRuns.push({ left: rr.left, right: rr.right, top: rr.top + s.top, bottom: rr.bottom - s.bottom });
          }
        }
      }
    });
    wrCache.set(wrKey, wordRuns);
    if (wrCache.size > 12) wrCache.delete(wrCache.keys().next().value);
  }
  /* rendered lines come FROM the word runs — ink truth for any markup
   * (the qa sheet's synthetic blocks return line-box element rects,
   * which lie about leading; words never do) */
  const renderedLines = mergeInkLines(wordRuns, 3);
  const verseNumberRects = [...M.sheet.querySelectorAll(".vnum")].map((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const r = range.getClientRects()[0] || el.getBoundingClientRect();
    return rel(r);
  });
  const additionalObstacles = [...M.sheet.querySelectorAll(".chap-head, .letter-head, .sheet-title, .sheet-ref, .legend, .mark-hint")]
    .map((el) => rel(el.getBoundingClientRect()))
    .filter((r) => r.right - r.left > 1 && r.bottom - r.top > 1);
  return {
    bounds: { left: 0, right: M.base.width, top: 0, bottom: M.base.height },
    renderedLines, wordRuns, verseNumberRects, additionalObstacles,
    lineHeight: parseFloat(getComputedStyle(M.sheet.querySelector(".vtext")).lineHeight) || 26,
    availableLeftMargin: Math.max(60, M.textLeft - 8),
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
    anchors.push({
      id: `${gid}:${ki}`,
      fragments: mergeInkLines(rects).map((r) => ({ left: r.left, right: r.right, top: r.top + s.top, bottom: r.bottom - s.bottom })),
      documentOrder: ki,
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
function computeHops(drawnPlans) {
  for (const p of drawnPlans) { p.renderHops = []; p.renderPatches = []; }
  for (const A of drawnPlans) {
    for (const B of drawnPlans) {
      if (A === B || !B.spine) continue;
      for (const y of crossingsAt(A, B.spine.x)) {
        if (y < B.spine.top + 2 || y > B.spine.bottom - 2) continue;
        if (B.focused && !A.focused) {
          if (!A.renderPatches.some((h) => Math.abs(h.y - y) < 3 && Math.abs(h.x - B.spine.x) < 1)) {
            A.renderPatches.push({ x: B.spine.x, y });
          }
        } else {
          if (B.ports.some((pt) => Math.abs(pt.y - y) < 2.6)) continue;
          if (!B.renderHops.some((h) => Math.abs(h - y) < 3)) B.renderHops.push(y);
        }
      }
    }
  }
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
function explainShapesPlan(plan) {
  if (!plan) return null;
  if (!plan.valid) {
    const why = {
      "needs-space": "no corridor slot or strand is free in the current weave — held as a tick",
      kink: "a terminal turn had no room to breathe — held as a tick",
      "obstacle-collision": "every legal path would touch ink — held as a tick",
      "no-anchors": "its phrases are not in this rendering",
    }[plan.reason] || `${plan.reason} — held as a tick`;
    return { label: "held", reason: why };
  }
  const labels = {
    "same-line": plan.cradleVariant === "embrace" ? "direct hammock · embrace" : "direct hammock",
    "local-tag": "local tag", "local-comb": "local comb",
    "middle-shaft": "middle shaft",
    tag: "loom tag", corridor: "left loom", multipoint: "left loom · tributaries",
  };
  const reasons = {
    "same-line": plan.cradleVariant === "embrace"
      ? "the pair is held as one — outer pins, floor beneath both words"
      : "both phrases share one verified corridor, so the margin detour disappears",
    "local-tag": "the whole route fits beside the idea itself",
    "local-comb": "the line's pins comb into one short rail beside the phrase",
    "middle-shaft": "a clear vertical stands in the void beside the ideas — neither endpoint visits the page edge",
    tag: "a single idea; its pin pours into the loom beside its own line",
    corridor: "the phrases span lines; one quiet spine on the left loom carries them",
    multipoint: "each line's pins comb into tributaries feeding one spine on the loom",
  };
  return { label: labels[plan.mode] || plan.mode, reason: reasons[plan.mode] || "" };
}

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

/* lab introspection for the browser console */
globalThis.__LAB = { blockFor, annFor, measure: (sid) => measure(sid), planRoute, warmBlocks };

/* an engine plan, drawn in shapes' own voice: the tapered ribbon */
function drawRouted(svg, g, plan, hue, focused) {
  const w = focused ? 1.5 : 1.25;
  const nonSpine = plan.spine
    ? plan.centerline.filter((s) =>
        !(s.type === "L" && Math.abs(s.x1 - plan.spine.x) < 0.01 && Math.abs(s.x2 - plan.spine.x) < 0.01 &&
          Math.abs(s.y2 - s.y1) > 4))
    : plan.centerline;
  const runs = [];
  let cur = [];
  for (const s of nonSpine) {
    const pts = segPtsFor(s);
    if (cur.length && Math.hypot(pts[0].x - cur[cur.length - 1].x, pts[0].y - cur[cur.length - 1].y) > 1.5) {
      runs.push(cur); cur = [];
    }
    cur.push(...(cur.length ? pts.slice(1) : pts));
  }
  if (cur.length) runs.push(cur);
  runs.forEach((pts, i) => ribbonDraw(g, pts, hue, { w, delay: 40 + i * 26, dur: 340 }));
  if (plan.spine) {
    for (const [a, b] of splitSpine(plan.spine, plan.renderHops || [])) {
      const n = Math.max(6, Math.round((b - a) / 2));
      const pts = Array.from({ length: n + 1 }, (_, k) => ({ x: plan.spine.x, y: a + ((b - a) * k) / n }));
      ribbonDraw(g, pts, hue, { w: w - 0.12, delay: 70, dur: 380 });
    }
  }
  if (plan.renderPatches && plan.renderPatches.length) {
    const W = +svg.getAttribute("width") + 40, H = +svg.getAttribute("height") + 40;
    let defs = svg.querySelector("defs");
    if (!defs) { defs = document.createElementNS("http://www.w3.org/2000/svg", "defs"); svg.insertBefore(defs, svg.firstChild); }
    const mask = S("mask", { id: `weave-${g.dataset.gid}`, maskUnits: "userSpaceOnUse", x: -20, y: -20, width: W, height: H }, defs);
    S("rect", { x: -20, y: -20, width: W, height: H, fill: "#fff" }, mask);
    for (const pt of plan.renderPatches) S("circle", { cx: pt.x, cy: pt.y, r: 2.6, fill: "#000" }, mask);
    g.setAttribute("mask", `url(#weave-${g.dataset.gid})`);
  }
  plan.contacts.forEach((c, i) => traceDot(g, c, hue, 60 + i * 22));
}

function traceDot(g, point, hue, delay = 0, radius = TG.constants.TOUCH_RADIUS, opacity = 1) {
  const dot = S("circle", {
    cx: point.x, cy: point.y, r: radius, fill: hue, opacity, "data-role": "contact",
  }, g);
  animFade(dot, 200, delay);
  return dot;
}

function drawWrappedTerminals(g, members, hue, endpoints) {
  const occupied = new Set(endpoints.map((point) => `${point.x.toFixed(2)}:${point.y.toFixed(2)}`));
  members.forEach((member) => {
    if (member.fragments.length < 2) return;
    member.continuationContacts.forEach((point) => {
      const key = `${point.x.toFixed(2)}:${point.y.toFixed(2)}`;
      if (!occupied.has(key)) traceDot(g, point, hue, 120, 1.35, 0.72);
    });
  });
}

/* one line type for every kind — the ribbon, in the kind's hue */
function renderKindPath(g, plan, hue) {
  const w = plan.mode === "far" ? 1.55 : plan.mode === "same-line" ? 1.35 : 1.2;
  ribbonDraw(g, plan.points, hue, { w, delay: 50, dur: 360 });
}

function drawArc(g, a, b, hue, stagger, gutterX, lineHeight) {
  const plan = TG.planArc(a, b, { gutterX, laneOffset: stagger, lineHeight });
  g.dataset.distance = plan.mode;
  g.dataset.route = plan.route || "cradle";
  if (plan.route === "corridor") {
    g.dataset.laneX = plan.laneX;
    g.dataset.corridorTop = plan.corridorTop;
    g.dataset.corridorBottom = plan.corridorBottom;
  }
  renderKindPath(g, plan, hue);
  traceDot(g, plan.start, hue, 30);
  traceDot(g, plan.end, hue, 390);
  drawWrappedTerminals(g, [a, b], hue, [plan.start, plan.end]);
  return plan;
}

function threadPath(g, d, hue, role, opacity = 0.66, delay = 40) {
  const path = S("path", {
    d, fill: "none", stroke: hue, "stroke-width": 1.1,
    "stroke-linecap": "round", "stroke-linejoin": "round", opacity,
    "data-role": role,
  }, g);
  animFade(path, 240, delay);
  return path;
}

function drawThread(g, members, hue, laneX, lineHeight) {
  const plan = TG.planThread(members, { laneX, lineHeight });
  if (!plan) return null;
  g.dataset.distance = plan.mode;
  g.dataset.route = plan.route || "thread";

  if (plan.mode === "inline-thread") {
    threadPath(g, `M ${plan.spine.start.x} ${plan.spine.start.y} H ${plan.spine.end.x}`, hue, "spine", 0.72);
    plan.branches.forEach((branch, index) => threadPath(g, branch.d, hue, "shoulder", 0.62, 60 + index * 24));
  } else {
    plan.branches.forEach((branch, index) => threadPath(g, branch.d, hue, "shoulder", 0.62, 60 + index * 24));
    threadPath(g, `M ${plan.spine.start.x} ${plan.spine.start.y} V ${plan.spine.end.y}`, hue, "spine", 0.74, 30);
  }

  plan.contacts.forEach((contact, index) => traceDot(g, contact, hue, 70 + index * 24));
  drawWrappedTerminals(g, members, hue, plan.contacts);
  return plan;
}

function drawOverlay(sid, gids) {
  const sheet = document.querySelector(`[data-sheet="${sid}"]`);
  const svg = sheet.querySelector("svg.overlay");
  const key = gids.slice().sort().join("|") + "·" + ROUTE + "·" + [...hovered].join(",") + "·" + (FOCUS_GID || "");
  if (svg.dataset.key === key) return;
  svg.dataset.key = key;
  const live = svg.querySelector("g.live");
  svg.innerHTML = "";
  if (live) svg.appendChild(live);
  if (!gids.length) return;
  const M = measure(sid);
  const lineHeight = parseFloat(getComputedStyle(M.sheet.querySelector(".vtext")).lineHeight) || 26;
  const preview = [...hovered].filter((gid) => GIDS[gid]?.study === sid).at(-1);
  const localFocus = preview || (FOCUS_GID && gids.includes(FOCUS_GID) ? FOCUS_GID : gids.at(-1));
  /* Annotation lines remain the primary Traces language. Density is handled
   * through progressive disclosure: the focused line plus the three most
   * recent comparisons receive deterministic gutter lanes. Everything held
   * still remains directly switchable in the passage score. */
  const inked = ROUTE === "traces"
    ? [...gids.filter((gid) => gid !== localFocus).slice(-(MAX_MARGIN_TRACES - 1)), localFocus].filter(Boolean)
    : gids;

  if (ROUTE === "traces") {
    /* the Loom engine plans every inked trace: focused first (it claims
     * corridors and strand 0 first), then companions ranked BESIDE the
     * focus (engine rankCompanions) with ~35px lane hysteresis so lanes
     * don't reshuffle on every focus hop. Everything active but not
     * drawn becomes a held tick on the rail. */
    const fontSize = parseFloat(getComputedStyle(M.sheet.querySelector(".vtext")).fontSize) || 17;
    const block = blockFor(sid, M);
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
    const companions = rankCompanions(intervals, localFocus)
      .sort((a, b) => (distTo(a) - (prevInked.has(a) ? 35 : 0)) - (distTo(b) - (prevInked.has(b) ? 35 : 0)))
      .slice(0, MAX_MARGIN_TRACES - 1);
    LAST_INKED.set(sid, new Set(companions));
    const drawnOrder = [...companions.reverse(), localFocus].filter(Boolean);

    const claims = [], spineClaims = [], strandClaims = [];
    const plans = new Map();
    const ordered = [localFocus, ...drawnOrder.filter((gid) => gid !== localFocus)].filter(Boolean);
    for (const gid of ordered) {
      const ann = anns.get(gid);
      if (!ann.anchors.length) { plans.set(gid, { valid: false, reason: "no-anchors" }); continue; }
      let plan;
      try {
        plan = planRoute(block, ann, {
          fontSize, corridorClaims: claims, spineClaims, strandClaims,
          focused: gid === localFocus, allowMiddle: gid === localFocus, claimPad: 0.25,
        });
      } catch (e) {
        plan = { valid: false, reason: "engine-error" };
      }
      plans.set(gid, plan);
      if (plan.valid) {
        plan.focused = gid === localFocus;
        claims.push(...plan.claimsOut);
        if (plan.spineClaimOut) spineClaims.push(plan.spineClaimOut);
        if (plan.strandClaimOut) strandClaims.push(plan.strandClaimOut);
      }
    }
    LAST_PLANS.set(sid, plans);
    computeHops([...plans.values()].filter((p) => p.valid));
    for (const gid of drawnOrder) {
      const G = GIDS[gid];
      const plan = plans.get(gid);
      const g = S("g", {
        class: `margin-annotation ${gid === localFocus ? "is-focus" : "is-held"}`,
        "data-gid": gid,
      }, svg);
      g.dataset.kind = G.kind;
      if (G.qaKind) g.dataset.qaKind = G.qaKind;
      if (G.qaDistance) g.dataset.qaDistance = G.qaDistance;
      if (G.qaPlacement) g.dataset.qaPlacement = G.qaPlacement;
      if (plan && plan.valid) {
        g.dataset.route = plan.mode + (plan.cradleVariant ? ":" + plan.cradleVariant : "");
        drawRouted(svg, g, plan, G.hue, gid === localFocus);
        /* continuation dots on wrapped fragments */
        const ann = anns.get(gid);
        for (const a of ann.anchors) for (const f of a.fragments.slice(1)) {
          traceDot(g, { x: f.left + 0.5, y: f.bottom + 2 }, G.hue, 120, 1.35, 0.72);
        }
      } else {
        /* honest failure: the phrase keys still glow; a tick marks it */
        g.dataset.route = plan ? plan.reason : "none";
      }
    }

    /* held ticks: everything active-but-not-drawn gets one quiet tick per
     * anchor line on the held rail — hover previews, click holds */
    const expandT = Math.max(2.5, fontSize * 0.12) + 2.5;
    let minLeft = Infinity;
    for (const r of [...block.wordRuns, ...block.verseNumberRects, ...block.additionalObstacles]) {
      minLeft = Math.min(minLeft, r.left - expandT);
    }
    const heldRailX = (minLeft - 10) - 22;
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
    for (const gid of heldForTicks) {
      const ann = anns.get(gid);
      if (!ann || !ann.anchors.length) continue;
      const p = plans.get(gid);
      const visible = !(drawnOrder.includes(gid) && p && p.valid);
      const lineYs = [];
      for (const a of ann.anchors) {
        const f = [...a.fragments].sort((p2, q) => p2.top - q.top)[0];
        const y = (f.top + f.bottom) / 2;
        if (!lineYs.some((v) => Math.abs(v - y) < 3)) lineYs.push(y);
      }
      for (const y of lineYs) {
        let x = heldRailX;
        while (used.some((u) => Math.abs(u.y - y) < 2.5 && Math.abs(u.x - x) < 1)) x -= 7;
        used.push({ x, y });
        if (visible) S("path", {
          d: `M ${x.toFixed(2)} ${y.toFixed(2)} h -5.5`, stroke: "var(--text-tertiary)",
          "stroke-width": 1.2, fill: "none", "stroke-linecap": "round", opacity: 0.55, class: "tick",
        }, gTicks);
        const hit = S("rect", {
          x: (x - 11).toFixed(2), y: (y - 6).toFixed(2), width: 17, height: 12,
          fill: "transparent", class: "tick-hit",
        }, gTicks);
        hit.style.pointerEvents = "all";
        hit.style.cursor = "pointer";
        hit.addEventListener("mouseenter", () => { if (!hovered.has(gid)) { hovered.add(gid); applyActive(); } });
        hit.addEventListener("mouseleave", () => { if (hovered.has(gid)) { hovered.delete(gid); applyActive(); } });
        hit.addEventListener("click", () => { pinned.add(gid); FOCUS_GID = gid; hovered.delete(gid); applyActive(); });
      }
    }
    return;
  }

  inked.forEach((gid, i) => {
    const G = GIDS[gid];
    const members = G.anchors.map((anchor) => measureAnchor(M, anchor)).filter(Boolean);
    if (members.length < 2) return;
    const isFocus = gid === localFocus;
    const lane = isFocus ? 0 : i + 1;
    const g = S("g", {
      class: "reading-annotation",
      "data-gid": gid,
    }, svg);
    g.dataset.kind = G.kind;
    const marginLaneX = M.textLeft - 46;
    if (G.conn === "thread") drawThread(g, members, G.hue, marginLaneX - lane * 10, lineHeight);
    else drawArc(g, members[0], members[members.length - 1], G.hue, lane * 10, marginLaneX, lineHeight);
  });
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

/* pattern card — the pinned pattern, condensed to one glance.
 * Docked in the study's right rail like an app inspector: every member as
 * ref + phrase, off-screen rows dim with a direction arrow, click to jump.
 * One card per study, visible only while one of its patterns is pinned. */
const CARDS = {};
const TRACE_STAGES = {};
for (const sid of Object.keys(SHEETS)) {
  const rail = document.querySelector(`[data-rail="${sid}"]`);
  const card = document.createElement("div");
  card.className = "pcard";
  rail.prepend(card);
  CARDS[sid] = card;
  const stage = document.createElement("section");
  stage.className = "trace-stage";
  stage.dataset.traceStage = sid;
  stage.setAttribute("aria-label", `${SHEETS[sid].title} traces`);
  rail.prepend(stage);
  TRACE_STAGES[sid] = stage;
}

function traceTitle(G) {
  const prefix = `${KIND_LABEL[G.kind]} · `;
  return G.label.startsWith(prefix) ? G.label.slice(prefix.length) : G.label;
}

function traceKindClass(kind) {
  return kind.replace("link:", "").replace(/[^a-z-]/g, "-");
}

function traceKindMark(kind, hue) {
  /* one line type — the kind speaks as hue, named in the row's own text */
  const common = `fill="none" stroke="${hue}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"`;
  return `<svg class="trace-kind-mark" viewBox="0 0 44 14" aria-hidden="true"><path d="M2 7 H42" ${common}/></svg>`;
}

function traceOverview(G) {
  const sheet = document.querySelector(`[data-sheet="${G.study}"]`);
  const rows = [...sheet.querySelectorAll(".vrow")];
  const indexes = G.anchors.map((a) => Math.max(0, rows.indexOf(a.el.closest(".vrow"))));
  const denom = Math.max(1, rows.length - 1);
  const totals = new Map();
  const seen = new Map();
  indexes.forEach((n) => totals.set(n, (totals.get(n) || 0) + 1));
  const xs = indexes.map((n) => {
    const base = 7 + (n / denom) * 78;
    const total = totals.get(n) || 1;
    if (total === 1) return base;
    const ordinal = seen.get(n) || 0;
    seen.set(n, ordinal + 1);
    const spread = Math.min(14, total * 5);
    const start = Math.max(7, Math.min(85 - spread, base - spread / 2));
    return start + (ordinal / (total - 1)) * spread;
  });
  const min = Math.min(...xs), max = Math.max(...xs);
  const hue = G.hue;
  const cls = traceKindClass(G.kind);
  const stops = xs.map((x) => `<path d="M${x.toFixed(1)} 5 V13"/>`).join("");
  return `<svg class="trace-overview is-${cls}" viewBox="0 0 92 18" aria-hidden="true" style="--trace-hue:${hue}">
    <path class="trace-overview-rule" d="M${min.toFixed(1)} 9 H${max.toFixed(1)}"/>
    <g class="trace-overview-stops">${stops}</g>
  </svg>`;
}

function focusTrace(gid, { pin = true } = {}) {
  if (!GIDS[gid]) return;
  if (pin) {
    /* Set insertion order is our deterministic recency order for the three
     * quiet comparison lanes. Refocusing a held trace makes it recent. */
    pinned.delete(gid);
    pinned.add(gid);
  }
  FOCUS_GID = gid;
  hovered.clear();
  applyActive();
}

function updateTraceStages() {
  for (const sid of Object.keys(SHEETS)) {
    const stage = TRACE_STAGES[sid];
    const priorScroll = stage.scrollTop;
    const priorActive = stage.dataset.active || null;
    const focusedControl = stage.contains(document.activeElement)
      ? document.activeElement.closest("[data-trace-focus]")
      : null;
    const focusedTrack = focusedControl?.closest(".trace-track");
    const priorFocus = focusedTrack
      ? { gid: focusedTrack.dataset.gid, key: focusedControl.dataset.traceFocus }
      : null;
    const all = Object.values(GIDS).filter((G) => G.study === sid && G.anchors.length > 1);
    const held = [...pinned].filter((gid) => GIDS[gid]?.study === sid);
    const preview = [...hovered].filter((gid) => GIDS[gid]?.study === sid).at(-1) || null;
    const active = preview || (FOCUS_GID && held.includes(FOCUS_GID) ? FOCUS_GID : held.at(-1)) || null;
    stage.dataset.active = active || "";
    stage.innerHTML = "";

    const head = document.createElement("header");
    head.className = "trace-stage-head";
    const heading = document.createElement("div");
    heading.innerHTML = `<span class="trace-kicker">Passage score</span><h3>${SHEETS[sid].title}</h3>`;
    const meta = document.createElement("span");
    meta.className = "trace-stage-meta";
    meta.textContent = `${all.length} ${all.length === 1 ? "trace" : "traces"}${held.length ? ` · ${held.length} held` : ""}${held.length > MAX_MARGIN_TRACES ? ` · ${MAX_MARGIN_TRACES} lined` : ""}`;
    head.append(heading, meta);
    stage.appendChild(head);

    if (!all.length) {
      const empty = document.createElement("p");
      empty.className = "trace-stage-empty";
      empty.textContent = "Select words in the passage to begin its first trace.";
      stage.appendChild(empty);
      continue;
    }

    const intro = document.createElement("p");
    intro.className = "trace-stage-intro";
    intro.textContent = active
      ? "The active annotation owns the nearest margin lane. Choose any source moment to return."
      : "Choose an annotation to draw its source path through the passage margin.";
    stage.appendChild(intro);

    const list = document.createElement("div");
    list.className = "trace-list";
    for (const G of all) {
      const isHeld = held.includes(G.gid);
      const isActive = G.gid === active;
      const track = document.createElement("article");
      track.className = `trace-track is-${traceKindClass(G.kind)}${isHeld ? " is-held" : ""}${isActive ? " is-active" : ""}`;
      track.style.setProperty("--trace-hue", G.hue);
      track.dataset.gid = G.gid;
      if (G.qaKind) track.dataset.qaKind = G.qaKind;
      if (G.qaDistance) track.dataset.qaDistance = G.qaDistance;
      if (G.qaPlacement) track.dataset.qaPlacement = G.qaPlacement;

      const trackHead = document.createElement("button");
      trackHead.className = "trace-track-head";
      trackHead.type = "button";
      trackHead.dataset.traceFocus = "head";
      trackHead.setAttribute("aria-expanded", isActive);
      trackHead.innerHTML = `<span class="trace-track-sign">${traceKindMark(G.kind, G.hue)}</span>
        <span class="trace-track-copy"><span class="trace-track-kind">${KIND_LABEL[G.kind]}</span><strong>${traceTitle(G)}</strong></span>
        <span class="trace-track-count">${G.anchors.length}</span>${traceOverview(G)}`;
      trackHead.addEventListener("click", (e) => { e.stopPropagation(); focusTrace(G.gid); });
      track.appendChild(trackHead);

      if (isActive) {
        const detail = document.createElement("div");
        detail.className = "trace-detail";
        /* the route explains itself: label + one honest sentence from
         * the Loom plan that actually drew (or declined) this trace */
        const planNote = explainShapesPlan(LAST_PLANS.get(sid)?.get(G.gid));
        if (planNote) {
          const note = document.createElement("p");
          note.className = "trace-route-note";
          note.innerHTML = `<strong>${planNote.label}</strong> — ${planNote.reason}`;
          detail.appendChild(note);
        }
        if (G.gid.startsWith("u-")) {
          const rec = USER.find((pattern) => pattern.id === G.gid);
          const renameLabel = document.createElement("label");
          renameLabel.className = "trace-rename";
          renameLabel.appendChild(Object.assign(document.createElement("span"), { textContent: "Trace name" }));
          const rename = document.createElement("input");
          rename.type = "text";
          rename.value = rec?.label || traceTitle(G);
          rename.autocomplete = "off";
          rename.dataset.traceFocus = "rename";
          rename.setAttribute("aria-label", `Trace name for ${traceTitle(G)}`);
          rename.addEventListener("click", (e) => e.stopPropagation());
          rename.addEventListener("input", () => {
            trackHead.querySelector("strong").textContent = rename.value.trim() || traceTitle(G);
          });
          const commitRename = () => {
            if (!rename.value.trim()) { rename.value = rec?.label || traceTitle(G); return; }
            renameUser(G.gid, rename.value);
            const nextTitle = traceTitle(G);
            trackHead.querySelector("strong").textContent = nextTitle;
            rename.setAttribute("aria-label", `Trace name for ${nextTitle}`);
            const legendChip = [...document.querySelectorAll(".legend .chip")]
              .find((chip) => (chip.dataset.gids || "").split(" ").includes(G.gid));
            const legendText = legendChip
              ? [...legendChip.childNodes].find((node) => node.nodeType === Node.TEXT_NODE)
              : null;
            if (legendText) legendText.textContent = G.label;
          };
          rename.addEventListener("keydown", (e) => {
            if (e.key === "Enter") { e.preventDefault(); commitRename(); }
          });
          rename.addEventListener("change", commitRename);
          renameLabel.appendChild(rename);
          detail.appendChild(renameLabel);
        }
        const actions = document.createElement("div");
        actions.className = "trace-actions";
        const exportBtn = document.createElement("button");
        exportBtn.type = "button"; exportBtn.textContent = "Export SVG"; exportBtn.dataset.traceFocus = "export";
        exportBtn.addEventListener("click", (e) => { e.stopPropagation(); exportCard(G.gid); });
        const release = document.createElement("button");
        release.type = "button"; release.textContent = isHeld ? "Release" : "Close"; release.dataset.traceFocus = "release";
        release.addEventListener("click", (e) => {
          e.stopPropagation();
          pinned.delete(G.gid);
          hovered.delete(G.gid);
          FOCUS_GID = [...pinned].filter((gid) => GIDS[gid]?.study === sid).at(-1) || null;
          applyActive();
        });
        actions.append(exportBtn, release);
        if (G.gid.startsWith("u-")) {
          const add = document.createElement("button");
          add.type = "button"; add.textContent = "Add words"; add.dataset.traceFocus = "add";
          add.addEventListener("click", (e) => { e.stopPropagation(); startExtend(G.gid); });
          const del = document.createElement("button");
          del.type = "button"; del.className = "is-danger"; del.textContent = "Delete"; del.dataset.traceFocus = "delete";
          del.addEventListener("click", (e) => { e.stopPropagation(); deleteUserPattern(G.gid); });
          actions.prepend(add); actions.append(del);
        }
        detail.appendChild(actions);

        const score = document.createElement("ol");
        score.className = `trace-score is-${traceKindClass(G.kind)}`;
        score.setAttribute("aria-label", `${traceTitle(G)} source path`);
        G.anchors.forEach((a, index) => {
          const member = document.createElement("li");
          member.className = "trace-member";
          member._el = a.el;
          const jump = document.createElement("button");
          jump.type = "button";
          jump.className = "trace-member-jump";
          jump.dataset.traceFocus = `member-${index}`;
          const [book, ch, v] = a.ref.split(".");
          jump.setAttribute("aria-label", `${book} ${ch}:${v}, ${a.phrase}`);
          jump.innerHTML = `<span class="trace-stop" aria-hidden="true">${String(index + 1).padStart(2, "0")}</span>
            <span class="trace-member-copy"><span class="trace-member-ref">${book} ${ch}:${v}</span><span class="trace-member-phrase">${a.phrase}</span></span>
            <span class="trace-member-state" aria-hidden="true"></span>`;
          jump.addEventListener("click", (e) => {
            e.stopPropagation();
            a.el.scrollIntoView({ behavior: REDUCED_MOTION ? "auto" : "smooth", block: "center" });
            requestAnimationFrame(() => { FOCUS_GID = G.gid; applyActive(); });
          });
          member.appendChild(jump);
          if (G.gid.startsWith("u-")) {
            const remove = document.createElement("button");
            remove.type = "button"; remove.className = "trace-member-remove";
            remove.dataset.traceFocus = `remove-${index}`;
            remove.textContent = "Remove";
            remove.addEventListener("click", (e) => { e.stopPropagation(); removeMember(G.gid, a.ref, a.phrase, a.occ); });
            member.appendChild(remove);
          }
          score.appendChild(member);
        });
        detail.appendChild(score);

        const noteLabel = document.createElement("label");
        noteLabel.className = "trace-note";
        noteLabel.appendChild(Object.assign(document.createElement("span"), { textContent: "Observation" }));
        const note = document.createElement("textarea");
        note.rows = 2;
        note.dataset.traceFocus = "note";
        note.placeholder = "Why do these moments belong together?";
        note.value = getNote(G.gid);
        /* The score is rebuilt when another trace receives focus. Persist on
         * input so that rebuild cannot outrun a pending blur/change event. */
        note.addEventListener("input", () => setNote(G.gid, note.value));
        note.addEventListener("click", (e) => e.stopPropagation());
        noteLabel.appendChild(note);
        detail.appendChild(noteLabel);
        track.appendChild(detail);
      }
      list.appendChild(track);
    }
    stage.appendChild(list);
    if (priorFocus) {
      const nextTrack = [...list.querySelectorAll(".trace-track")]
        .find((track) => track.dataset.gid === priorFocus.gid);
      const nextFocus = nextTrack?.querySelector(`[data-trace-focus="${priorFocus.key}"]`)
        || nextTrack?.querySelector(".trace-track-head");
      nextFocus?.focus({ preventScroll: true });
    }
    if (active && active !== priorActive) {
      const activeTrack = [...list.querySelectorAll(".trace-track")].find((track) => track.dataset.gid === active);
      requestAnimationFrame(() => {
        const stageRect = stage.getBoundingClientRect();
        const trackRect = activeTrack?.getBoundingClientRect();
        const trackTop = trackRect ? trackRect.top - stageRect.top + stage.scrollTop : 0;
        stage.scrollTop = Math.max(0, trackTop - head.offsetHeight);
        updateCardView();
      });
    } else {
      stage.scrollTop = priorScroll;
    }
  }
  updateCardView();
}

function updateCard() {
  const inTraces = ROUTE === "traces";
  for (const stage of Object.values(TRACE_STAGES)) stage.hidden = !inTraces;
  for (const card of Object.values(CARDS)) card.hidden = inTraces;
  if (inTraces) {
    updateTraceStages();
    return;
  }
  for (const sid of Object.keys(SHEETS)) {
    const card = CARDS[sid];
    const gids = [...pinned].filter((g) => GIDS[g].study === sid);
    if (!gids.length) { card.classList.remove("on"); continue; }
    card.innerHTML = "";
    for (const gid of gids) {
      const G = GIDS[gid];
      const sec = document.createElement("div"); sec.className = "pcard-sec";
      const head = document.createElement("div"); head.className = "pcard-head";
      head.innerHTML = `<svg width="8" height="8"><circle cx="4" cy="4" r="3" fill="${G.hue}"/></svg>`;
      const title = document.createElement("span"); title.className = "pcard-title";
      if (gid.startsWith("u-")) {
        const rec = USER.find((p) => p.id === gid);
        title.textContent = rec?.label || G.label;
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
        title.textContent = G.label;
      }
      const exp = document.createElement("button"); exp.className = "pcard-x"; exp.textContent = "⤓";
      exp.title = "export as card";
      exp.addEventListener("click", (e) => { e.stopPropagation(); exportCard(gid); });
      head.append(title, exp);
      if (gid.startsWith("u-")) {
        const del = document.createElement("button"); del.className = "pcard-x pcard-del";
        del.innerHTML = `<svg width="11" height="12" viewBox="0 0 14 15" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M2 4h10M5.5 4V2.5h3V4M3.5 4l.7 9h5.6l.7-9M5.8 6.5v4M8.2 6.5v4"/></svg>`;
        del.title = "delete this mark";
        del.addEventListener("click", (e) => { e.stopPropagation(); deleteUserPattern(gid); });
        head.appendChild(del);
      }
      const close = document.createElement("button"); close.className = "pcard-x"; close.textContent = "×";
      close.title = "unpin (esc)";
      close.addEventListener("click", (e) => {
        e.stopPropagation();
        pinned.delete(gid);
        applyActive();
      });
      head.appendChild(close);
      sec.appendChild(head);
      for (const a of G.anchors) {
        const row = document.createElement("div"); row.className = "pcard-row";
        const [, ch, v] = a.ref.split(".");
        const ref = document.createElement("span"); ref.className = "pr-ref"; ref.textContent = `${ch}:${v}`;
        const txt = document.createElement("span"); txt.className = "pr-txt"; txt.textContent = a.phrase;
        const dir = document.createElement("span"); dir.className = "pr-dir";
        row.append(ref, txt, dir);
        if (gid.startsWith("u-")) {
          const rm = document.createElement("button"); rm.className = "pr-rm"; rm.textContent = "–";
          rm.title = "remove these words from the pattern";
          rm.addEventListener("click", (e) => { e.stopPropagation(); removeMember(gid, a.ref, a.phrase, a.occ); });
          row.appendChild(rm);
        }
        row.addEventListener("click", (e) => {
          e.stopPropagation();
          a.el.scrollIntoView({ behavior: "smooth", block: "center" });
        });
        row._el = a.el;
        sec.appendChild(row);
      }
      if (gid.startsWith("u-")) {
        const add = document.createElement("button"); add.className = "pcard-add";
        add.textContent = "+ add words";
        add.addEventListener("click", (e) => { e.stopPropagation(); startExtend(gid); });
        sec.appendChild(add);
      }
      const note = document.createElement("textarea");
      note.className = "pcard-note";
      note.rows = 1;
      note.placeholder = "why these? note an observation…";
      note.value = getNote(gid);
      const grow = () => { note.style.height = "auto"; note.style.height = note.scrollHeight + "px"; };
      note.addEventListener("input", grow);
      note.addEventListener("change", () => setNote(gid, note.value));
      note.addEventListener("click", (ev) => ev.stopPropagation());
      note.addEventListener("mouseup", (ev) => ev.stopPropagation());
      sec.appendChild(note);
      requestAnimationFrame(grow);
      card.appendChild(sec);
    }
    card.classList.add("on");
  }
  updateCardView();
}
function updateCardView() {
  document.querySelectorAll(".pcard.on .pcard-row").forEach((row) => {
    const r = row._el.getBoundingClientRect();
    const off = r.bottom < 60 ? "↑" : r.top > innerHeight - 30 ? "↓" : "";
    row.classList.toggle("off", !!off);
    row.querySelector(".pr-dir").textContent = off;
  });
  const members = [...document.querySelectorAll(".trace-track.is-active .trace-member")];
  let closest = null;
  let closestDistance = Infinity;
  members.forEach((member) => {
    const r = member._el.getBoundingClientRect();
    const off = r.bottom < 72 ? "↑" : r.top > innerHeight - 36 ? "↓" : "";
    member.classList.toggle("is-away", !!off);
    const state = member.querySelector(".trace-member-state");
    state.textContent = off || "here";
    const distance = Math.abs((r.top + r.bottom) / 2 - innerHeight * 0.42);
    if (!off && distance < closestDistance) { closest = member; closestDistance = distance; }
  });
  members.forEach((member) => member.classList.toggle("is-current", member === closest));
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
const DEF_RESTING = "what kind of connection is this?";

function showKindPalette(info) {
  authbar.innerHTML = "";
  authbar.classList.add("palette");
  const row = document.createElement("div"); row.className = "authrow";
  const def = document.createElement("div"); def.className = "authdef";
  def.textContent = DEF_RESTING;
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
  authbar.append(row, def);
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
    const activeTrace = G.extend && ROUTE === "traces"
      ? [...rail.querySelectorAll(".trace-track")]
        .find((track) => track.dataset.gid === G.extend)?.querySelector(".trace-track-head")
      : null;
    const target = activeTrace || rail.querySelector(".pcard:not([hidden])");
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

function wire() {
  document.querySelectorAll(".study").forEach((scope) => {
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
  addEventListener("resize", () => {
    /* Responsive reflow changes every track's offset. Force the active row to
     * reclaim the visible score position instead of restoring stale scrollTop. */
    for (const stage of Object.values(TRACE_STAGES)) stage.dataset.active = "";
    requestAnimationFrame(redrawActive);
  });
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
  for (const s of Object.keys(SHEETS)) {
    const pre = document.querySelector(`[data-payload="${s}"]`);
    if (!pre) continue;
    const mine = USER.filter((p) => refStudy(p.members[0].ref) === s);
    const builtIn = s === "qa" ? (ANGLE_MODE ? GEOMETRY_FIXTURE.patterns : []) : PATTERNS[s];
    pre.textContent = JSON.stringify(mine.length ? { builtIn, yours: mine } : builtIn, null, 2);
  }
  warmBlocks();
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
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { redrawActive(); warmBlocks(); });
