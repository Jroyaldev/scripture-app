import assert from "node:assert/strict";
import { test } from "node:test";
import type React from "react";
import * as ReactModule from "react";
import { LivingMargin } from "../src/renderer/components/LivingMargin.js";
import type { QueryResult } from "../src/renderer/api.js";

(globalThis as unknown as { React: typeof ReactModule }).React = ReactModule;

function walkElements(node: React.ReactNode, visit: (element: React.ReactElement) => void): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walkElements(child, visit);
    return;
  }
  if (!("props" in node)) return;

  const element = node as React.ReactElement<{ children?: React.ReactNode }>;
  visit(element);
  walkElements(element.props.children, visit);
}

test("LivingMargin removes highlights by the persisted highlight id from the pinned-passage panel", () => {
  const internals = (ReactModule as unknown as {
    __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: {
      H: unknown;
    };
  }).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const previousDispatcher = internals.H;
  internals.H = {
    useState<S>(initial: S | (() => S)): [S, () => void] {
      return [typeof initial === "function" ? (initial as () => S)() : initial, () => undefined];
    },
    useRef<T>(initial: T): { current: T } {
      return { current: initial };
    },
    useEffect(): void {
      // Pinned-range AI-insight effect intentionally not run in this render-only test.
    },
  };

  const marginData = {
    anchors: [],
    notes: [],
    highlights: [
      {
        id: "hl_01HIGHLIGHT",
        book: "ACT",
        chapter: 19,
        verse_start: 1,
        verse_end: 2,
        package: "web",
        char_start: null,
        char_end: null,
        color: "yellow",
        kind: "highlight",
        note_id: null,
        deleted: 0,
      },
    ],
  } as unknown as QueryResult;

  try {
    let removedId: string | null = null;
    // Pinning verse 1 (within the highlight's range) surfaces the highlight
    // palette + Remove control in the "Selected Passage" state.
    const tree = LivingMargin({
      book: "ACT",
      chapter: 19,
      packageId: "bsb",
      marginData,
      crossRefs: null,
      bookNames: { ACT: ["Acts"] },
      pinnedRange: { start: 1, end: 1 },
      onRemoveHighlights: (ids) => {
        removedId = ids[0] ?? null;
      },
    });

    let removeButton: React.ReactElement<{ onClick?: () => void }> | null = null;
    walkElements(tree, (element) => {
      const props = element.props as { className?: string; onClick?: () => void };
      if (props.className === "margin-hl-remove") {
        removeButton = element as React.ReactElement<{ onClick?: () => void }>;
      }
    });

    assert.ok(removeButton, "expected highlight remove button to render in the pinned-passage panel");
    removeButton.props.onClick?.();
    assert.equal(removedId, "hl_01HIGHLIGHT");
  } finally {
    internals.H = previousDispatcher;
  }
});
