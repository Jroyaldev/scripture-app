/**
 * Note types — pure, platform-agnostic (INV-18).
 */

import type { CanonicalRef } from "../reference/types.js";

export type NoteFrontmatter = {
  id: string;
  title: string;
  created: string;
  modified: string;
  type?: string;
  tags?: string[];
};

export type NoteLink = {
  targetId: string;
  cachedLabel: string;
  raw: string;
};

export type ParsedNote = {
  frontmatter: NoteFrontmatter;
  body: string;
  noteLinks: NoteLink[];
  scriptureRefs: ScriptureRefMatch[];
  rawContent: string;
};

export type ScriptureRefMatch = {
  raw: string;
  ref: CanonicalRef;
};
