# Scripture Desktop Visual System

This document is the living visual contract for the desktop app. It does not replace the frozen product specification or alter data, authorship, or trust invariants.

## Direction

Scripture should feel calmer than Logos, simpler than a general-purpose research suite, and more study-specific than Shepherdly. The interface is not a dashboard wrapped around a Bible. It is a quiet reading desk whose tools appear at the moment they become useful.

The system borrows Shepherdly's strongest discipline—warm material, sparse elevation, and restrained gold—but adapts it to continuous reading, original-language study, and source-backed diagrams.

## Visual laws

1. **Gold is a verb.** Gold means current, actionable, focused, or selected. It is not decoration and never substitutes for a data category.
2. **Data keeps its color.** Highlights, syntax roles, and measured chart series may use semantic hues. Chrome, navigation, and generic cards do not.
3. **Material may change; meaning may not.** Every atmosphere shares geometry, hierarchy, copy, and interaction. Only light, depth, and surface opacity change.
4. **Typography carries hierarchy.** Source Serif is for Scripture, original-language content, and meaningful display text. Inter is for controls and explanations. JetBrains Mono is for compact provenance, coordinates, counts, and telemetry.
5. **One geometry register.** Controls use 6px corners, panels 12px, and large cards/dialogs 20px. Pills remain fully rounded only when their shape communicates a compact state.
6. **Elevation is scarce.** Most relationships use spacing, a material shift, or one hairline. Shadows are reserved for floating layers and deliberate focus.
7. **Motion explains.** The default transition is 150ms. Motion may reveal origin, continuity, or state change; it does not decorate idle surfaces.
8. **Refuse visual falsehood.** A beautiful diagram, label, or color must still reflect the underlying source and measurement. Existing language and Structure truth contracts remain authoritative.

## Reading atmospheres

| Stored id | Name | Promise |
|---|---|---|
| `light` | Paper | Warm, quiet, and effortless to read. |
| `dark` | Ink | Low-glare focus for long study. |
| `glass` | Glass | Soft daylight with translucent depth. |
| `dark-glass` | Candlelight | Warm dark glass with a gentle glow. |

The picker is named **Reading atmosphere**, not Theme. Its compact explanation is **Material changes. Meaning does not.** The two glass images are suite-owned assets copied from the sibling Shepherdly project (`public/dashboard/glass-light.png` and `glass-dark.png`); no external image dependency is introduced.

## Surface hierarchy

- **Shell:** background atmosphere and application boundary.
- **Reading sheet:** the highest-legibility continuous surface for Scripture and long-form controls.
- **Sidebar / Living Margin:** quieter adjacent materials separated by one hairline.
- **Inset:** grouped controls and local selected states.
- **Float:** popovers, menus, transient palettes, and dialogs. Floating content is intentionally more opaque than glass canvases.

## Interaction language

- Hover changes surface or text tone without lifting the entire component.
- Focus uses one visible gold ring and never depends on color alone.
- Selected state combines a material change with a restrained gold mark.
- Disabled state reduces emphasis without making essential text illegible.
- Empty states say what is absent and give the next useful action.
- Keyboard behavior and focus return are part of polish, not later accessibility cleanup.

## Component refinement sequence

Each item is a separate bounded B2 pass with before/after desktop captures in all four atmospheres. No mobile-specific work belongs in this worktree.

1. **Global shell and atmosphere system — landed.** Tokens, Paper/Ink/Glass/Candlelight, picker, portal-safe floating layers, Settings gallery, and automated all-look QA.
2. **Sidebar and primary navigation.** Remove the visible layout lab, choose the final density, refine brand/library identity, active/hover/focus states, shortcuts, and footer status.
3. **Reading topbar.** Passage/version selection, previous/next, jump field, reading controls, Living Margin control, and atmosphere trigger.
4. **Reading canvas.** Chapter hierarchy, verse rhythm, selection, hover, highlights, loading/error/empty states, and focus mode.
5. **Living Margin frame.** Section hierarchy, disclosure, provenance, action affordances, and card rhythm while preserving the proven language, cross-reference, and Structure visualizers.
6. **Shared controls and floating layers.** Button, input, segmented control, card, tooltip, menu, popover, toast, and dialog states.
7. **Settings, onboarding, and import.** Information architecture, first-run guidance, library choice, sources, progress, failure, and recovery.
8. **Write, Notes, and Search.** Calm working surfaces, strong empty states, save feedback, results hierarchy, and keyboard flow.
9. **Study overlays.** Language cards, Structure, note capture, highlight palette, and cross-reference previews receive final system alignment without changing source truth.
10. **Consolidation.** Remove remaining static inline styles and unjustified color/radius/shadow literals; run full four-atmosphere regression tours and interaction checks.

## Quality gate for every pass

- The component is visually inspected in Paper, Ink, Glass, and Candlelight.
- Hover, pressed, selected, disabled, loading, empty, error, and keyboard-focus states are checked when applicable.
- No visual change alters data semantics or trust boundaries.
- Existing screenshots and automation are updated rather than replaced with one-off manual claims.
- Renderer typecheck, relevant focused tests, full tests in proportion to risk, and `git diff --check` pass.
