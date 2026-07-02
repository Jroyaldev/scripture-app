/**
 * B3 test corpus — seeds Library-demo with realistic study notes (Gate 2/3
 * verification data). Fixed IDs make re-runs idempotent (same files rewritten).
 *
 * The corpus is deliberately structured for retrieval testing:
 *  - a Spirit/baptism cluster (Acts) that should inter-resurface
 *  - a new-birth cluster (John 3 / Titus 3 / 1 Peter 1) semantically close
 *    to the baptism cluster but with little keyword overlap
 *  - a justification cluster (Romans / Galatians)
 *  - a lament cluster (Psalms)
 *  - two distractor notes (reading plan, admin) that must NOT surface
 *    for theological queries
 *
 * Run: node --import tsx scripts/seed-test-notes.ts
 */

import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";
import { LibraryEngine } from "../src/host/library.js";
import type { BackboneData, BookNameMap } from "../src/core/reference/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "../data/scripture");
const LIBRARY_PATH = process.env["LIBRARY_PATH"] ?? resolve(__dirname, "../Library-demo");

type SeedNote = { id: string; title: string; body: string; tags: string[] };

// Fixed 26-char Crockford IDs (ULID-shaped) for idempotent re-seeding.
export const SEED_NOTES: SeedNote[] = [
  {
    id: "01SEEDNOTE0000000000000001",
    title: "Acts 19 — Disciples at Ephesus",
    body: `Paul's question in Acts 19:2 ("Did you receive the Holy Spirit when you believed?") assumes reception of the Spirit is verifiable. These disciples knew John's baptism (Acts 19:3) but were re-baptized in the name of the Lord Jesus (Acts 19:5), and the Spirit came with laying on of hands (Acts 19:6), with tongues and prophecy following. The sequence here matters: belief, baptism, hands, Spirit, manifestation.`,
    tags: ["pneumatology", "baptism"],
  },
  {
    id: "01SEEDNOTE0000000000000002",
    title: "Acts 2:38 — Peter's Pentecost formula",
    body: `Acts 2:38 gives the tightest formula: repent, be baptized in the name of Jesus Christ for the forgiveness of sins, and you will receive the gift of the Holy Spirit. Compare the order in Acts 10:44-48 where the Spirit falls BEFORE baptism at Cornelius's house — Luke seems unbothered by a fixed sequence.`,
    tags: ["pneumatology", "baptism"],
  },
  {
    id: "01SEEDNOTE0000000000000003",
    title: "Samaria anomaly — Acts 8",
    body: `In Acts 8:14-17 the Samaritans believed and were baptized, yet the Spirit had "fallen on none of them" until Peter and John laid hands on them. This delay is unique and possibly programmatic: the gospel's crossing of the Jew/Samaritan boundary needed apostolic witness. Simon's attempt to buy the ability (Acts 8:18-19) shows the giving was observable.`,
    tags: ["pneumatology"],
  },
  {
    id: "01SEEDNOTE0000000000000004",
    title: "Laying on of hands — survey",
    body: `Hands are laid for blessing (Genesis 48:14), commissioning (Numbers 27:18, Acts 6:6, Acts 13:3), healing (Mark 5:23), and imparting the Spirit (Acts 8:17, Acts 19:6, 2 Timothy 1:6). Hebrews 6:2 lists it among elementary teachings. The gesture marks continuity and transfer — identification of the giver with the receiver.`,
    tags: ["practice"],
  },
  {
    id: "01SEEDNOTE0000000000000005",
    title: "Born of water and Spirit — John 3:5",
    body: `Jesus tells Nicodemus in John 3:5 that entry to the kingdom requires birth "of water and Spirit." Options: (a) physical birth + spiritual birth; (b) baptism + Spirit; (c) hendiadys — one birth characterized by water-which-is-Spirit (cf. Ezekiel 36:25-27, where sprinkling and new spirit are one act of cleansing). I lean (c); Ezekiel is the background Nicodemus should have known (John 3:10).`,
    tags: ["regeneration", "john"],
  },
  {
    id: "01SEEDNOTE0000000000000006",
    title: "Regeneration language outside John",
    body: `Titus 3:5 — "washing of regeneration and renewing of the Holy Spirit." 1 Peter 1:23 — born again of imperishable seed through the living word. James 1:18 — brought forth by the word of truth. The new-birth metaphor is not uniquely Johannine; washing + Spirit + word cluster together across authors.`,
    tags: ["regeneration"],
  },
  {
    id: "01SEEDNOTE0000000000000007",
    title: "Water as judgment-and-rescue",
    body: `1 Peter 3:20-21 makes the flood an antitype of baptism: eight souls "saved through water." The same water that judged the world carried the ark. Exodus 14 repeats the pattern — Israel passes through the sea that drowns Egypt (cf. 1 Corinthians 10:1-2, "baptized into Moses in the cloud and in the sea"). Water in Scripture is rarely mere cleansing; it is ordeal passed through.`,
    tags: ["typology", "baptism"],
  },
  {
    id: "01SEEDNOTE0000000000000008",
    title: "Romans 6 — union, not symbol",
    body: `Romans 6:3-4: baptized into Christ Jesus = baptized into his death, buried with him, raised to walk in newness of life. Paul's argument against sin depends on this being real union, not illustration. Colossians 2:12 parallels: buried with him in baptism, raised through faith in the working of God.`,
    tags: ["baptism", "union"],
  },
  {
    id: "01SEEDNOTE0000000000000009",
    title: "Justification by faith — Romans core",
    body: `Romans 3:23-26 grounds justification in God's righteousness demonstrated at the cross. Romans 4 makes Abraham (Genesis 15:6) the paradigm — credited righteousness precedes circumcision, so it precedes all boundary markers. Galatians 2:16 states the negative: not by works of the law. The forensic frame is Paul's, but Romans 6 (see union note) guards it from becoming fiction.`,
    tags: ["justification", "paul"],
  },
  {
    id: "01SEEDNOTE0000000000000010",
    title: "How long, O LORD — Psalm 13 structure",
    body: `Psalm 13 moves in six verses from fourfold "how long" (Psalm 13:1-2) through petition (Psalm 13:3-4) to trust and song (Psalm 13:5-6). The lament form legitimizes complaint as prayer. Psalm 22:1 pushes the form to its extreme — the cry Jesus takes up on the cross (Matthew 27:46) — and still ends in praise (Psalm 22:22-31).`,
    tags: ["psalms", "lament"],
  },
  {
    id: "01SEEDNOTE0000000000000011",
    title: "Light and darkness in John's prologue",
    body: `John 1:5 — the light shines in the darkness, and the darkness has not overcome it. The verb katalambanō carries both "comprehend" and "seize." John 8:12 makes the claim personal: "I am the light of the world." Note how John 3:19-21 turns light into judgment — people loved darkness. The Nicodemus scene (John 3) sits inside this light/darkness frame.`,
    tags: ["john", "themes"],
  },
  {
    id: "01SEEDNOTE0000000000000012",
    title: "Pentecost and Babel",
    body: `Acts 2:1-13 reads as Babel reversed (Genesis 11:1-9): scattered languages become mutual hearing. But note it is not uniformity — each hears in his OWN language (Acts 2:8). The Spirit does not erase difference; he inhabits it. Joel 2:28-32 is Peter's warrant (Acts 2:17): Spirit on ALL flesh.`,
    tags: ["pneumatology", "acts"],
  },
  {
    id: "01SEEDNOTE0000000000000013",
    title: "Reading plan Q3",
    body: `July: finish Acts (chapters 15-28, two per day). August: Romans slowly with Moo's commentary, one chapter a week. September: Psalms of Ascent (Psalm 120 through Psalm 134) for morning readings. Order the replacement highlighters and a new notebook before August.`,
    tags: ["admin"],
  },
  {
    id: "01SEEDNOTE0000000000000014",
    title: "Small group logistics",
    body: `Rotate hosting: our place first and third weeks. Sarah brings coffee, Mike has the projector. Childcare fund needs $40 more this month. Send the scheduling poll by Friday. Topic vote result: study of Acts won over Philippians 9-3.`,
    tags: ["admin"],
  },
];

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

async function main(): Promise<void> {
  const backbone = loadJson<BackboneData>(join(DATA_DIR, "backbone.json"));
  const bookNames = loadJson<BookNameMap>(join(DATA_DIR, "book-names-en.json"));

  const engine = new LibraryEngine(LIBRARY_PATH, backbone, bookNames);
  if (!existsSync(join(LIBRARY_PATH, "config/library-manifest.json"))) {
    engine.initLibrary();
    engine.installBackboneData(join(DATA_DIR, "backbone.json"), join(DATA_DIR, "versification"));
    console.log(`initialized library at ${LIBRARY_PATH}`);
  }

  for (const note of SEED_NOTES) {
    engine.createNote(note.id, note.title, note.body, { type: "study", tags: note.tags });
  }
  const hash = engine.buildSqlite();
  const summary = engine.getSummary();
  console.log(`seeded ${SEED_NOTES.length} notes`);
  console.log(`notes in library: ${summary.notesFound}, anchors: ${summary.anchorsFound}`);
  console.log(`rebuild_hash: ${hash}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
