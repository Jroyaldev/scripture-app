# Shepherdly Resource Node — v1

> **Decision:** use a versioned project-resource attachment contract before deciding whether the Scripture surface remains a separate desktop app or is embedded in Shepherdly. The contract survives either shell choice.

## Product contract

A Scripture research item is a **resource node**, not sermon content.

- The user explicitly attaches it to a sermon, class, or general project.
- It lands in that project's research/resources surface.
- It carries a stable source locator, translation-free Scripture coordinate, concise preview, and full provenance.
- It never enters a sermon manuscript, lesson body, outline, or slide automatically.
- Copy, quote, adapt, or insert are later explicit actions owned by the receiving editor.
- Shepherdly can open the node back in the Scripture research view at the saved entity and opening passage.

This preserves the distinction between **material I may use** and **words I have authored**.

## V1 envelope

The pure core contract is implemented in `src/core/integrations/shepherdly-resource-node.ts` and refuses unknown fields at the trust boundary.

```ts
type ShepherdlyResourceNodeV1 = {
  schema: "shepherdly.resource-node";
  version: 1;
  intent: "attach-resource";
  delivery: {
    surface: "project-resources";
    projectKinds: Array<"sermon" | "class" | "project">;
    editorInsertion: "explicit-only";
  };
  resource: {
    kind: "scripture.entity";
    sourceId: string;
    title: string;
    summary: string;
    entityKind: "person" | "place" | "other";
    canonicalAnchor: string;
  };
  context: {
    originBref: string;
    scope: "selection" | "chapter";
    relationship: "direct-mention" | "research-context";
    mentionBrefs: string[];
    renderedExcerpt?: {
      packageId: string;
      bref: string;
      text: string;
    };
  };
  locator: {
    app: "scripture-library";
    view: "entity-research";
    entityId: string;
    originBref: string;
  };
  provenance: Array<{
    sourceId: string;
    name: string;
    license: string;
    sourceUrl?: string;
    attribution: string;
  }>;
};
```

V1 deliberately produces only `scripture.entity`. Passage, word-study, cross-reference-set, source-excerpt, and map nodes should get explicit discriminants and tests when their receiving workflows exist; they must not be smuggled through generic prose fields.

## Direct mention versus research context

The opening coordinate is evidence, not decoration:

- `direct-mention` requires at least one TIPNR reference inside the exact saved selection or chapter. Every `mentionBref` must be contained by `originBref`.
- `research-context` requires an empty mention list. It means the pastor opened broader research while reading that passage; it does not claim the entity occurs there.
- The optional excerpt is a small rendering snapshot tied to a package ID and one direct-mention `bref`. Translation remains separate from the canonical anchor.

## Receiving flow

The first real transport should be a narrow, authenticated two-way bridge:

1. The user chooses **Attach to Shepherdly** from a real Scripture research object.
2. Shepherdly validates the V1 packet and presents its own sermon/class/project picker.
3. The user confirms the target; Shepherdly writes a project-resource attachment and returns a receipt.
4. The resource tray offers **Open in Scripture**, using the opaque locator to restore the entity and saved origin.
5. Editor actions such as **Copy**, **Quote**, or **Adapt** remain separate and explicit.

The Scripture app must not write Shepherdly storage directly, guess a destination, or treat network availability as permission. An embedded future shell may replace the transport, but not the validation or explicit-action boundary.

## Current Shepherdly receiver reality

Read-only inspection on 2026-07-15 found:

- `sermonResources` already stores `sermonId`, `type`, `label`, `content`, and optional `source`.
- `sermons.addResource` already enforces authenticated sermon ownership and an editor role.
- No current UI consumes those resources as a deliberate research tray.
- Classes and general projects have no corresponding resource-attachment collection.
- The current string `content` boundary has no V1 runtime validation or structured provenance.

Therefore this Scripture task ships the producer/validator and truthful opening-context UI, not a dead integration control. The Shepherdly receiver follow-up should add a runtime-validated structured resource model, project picker, deduplication/receipts, and a visible resource tray before the command is exposed here.

## Invariants

- INV-1: attachment is an explicit user action; no autonomous Substrate write.
- INV-3: bundled reference data remains read-only.
- INV-5: every Scripture anchor uses translation-free `bref:v1` coordinates.
- INV-14/15: integrations receive no undeclared write capability and cannot write authored content autonomously.
- INV-17: the envelope carries a refusing schema version.
- INV-18: the builder and validator are pure platform-agnostic TypeScript.
