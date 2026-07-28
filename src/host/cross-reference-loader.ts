/** Host-only loader for the normalized OpenBible JSONL artifact. */

import { readFileSyncInterruptible } from "./exec-sync.js";
import type {
  CrossReferenceData,
  CrossReferenceEdge,
  CrossReferenceMeta,
} from "../core/cross-references/index.js";

type MetaLine = { meta: CrossReferenceMeta };
type SourceLine = { source: string; targets: CrossReferenceEdge[] };

export function loadOpenBibleCrossReferences(path: string): CrossReferenceData {
  const lines = readFileSyncInterruptible(path, "utf-8").split("\n").filter(Boolean);
  const first = lines.shift();
  if (!first) throw new Error("OpenBible cross-reference artifact is empty");
  const metaLine = JSON.parse(first) as MetaLine;
  if (!metaLine.meta || metaLine.meta.formatVersion !== 1) {
    throw new Error("Unsupported OpenBible cross-reference format");
  }

  const refs: Record<string, CrossReferenceEdge[]> = Object.create(null) as Record<string, CrossReferenceEdge[]>;
  let rowCount = 0;
  let scoreSum = 0;
  let scoreMin = Number.POSITIVE_INFINITY;
  let scoreMax = Number.NEGATIVE_INFINITY;

  for (const line of lines) {
    const row = JSON.parse(line) as SourceLine;
    if (!row.source || !Array.isArray(row.targets) || refs[row.source]) {
      throw new Error(`Malformed or duplicate OpenBible source row: ${row.source || "unknown"}`);
    }
    for (const edge of row.targets) {
      if (!Array.isArray(edge) || typeof edge[0] !== "string" || !Number.isInteger(edge[1])) {
        throw new Error(`Malformed OpenBible edge under ${row.source}`);
      }
      rowCount++;
      scoreSum += edge[1];
      scoreMin = Math.min(scoreMin, edge[1]);
      scoreMax = Math.max(scoreMax, edge[1]);
    }
    refs[row.source] = row.targets;
  }

  const meta = metaLine.meta;
  if (
    Object.keys(refs).length !== meta.sourceVerseCount
    || rowCount !== meta.rowCount
    || scoreSum !== meta.scoreSum
    || scoreMin !== meta.scoreMin
    || scoreMax !== meta.scoreMax
  ) {
    throw new Error("OpenBible artifact metadata does not match its stored scores/coverage");
  }

  return { meta, refs };
}
