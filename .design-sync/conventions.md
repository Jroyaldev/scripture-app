# Pericope — how to build with these components

An offline Bible-study app. Ink on paper, two planes, no decoration. Read this before
styling anything.

## Wrapping and setup

Every component must render inside a shell element that carries the atmosphere, or it
will be unstyled — the tokens live on that class, not on `:root` alone:

```jsx
<div className="app-shell theme-porcelain">
  <ToastProvider>
    <LanguageWordsSection … />
  </ToastProvider>
</div>
```

- **Atmosphere** — four appearances, and the class you need differs per one. Copy these
  exactly; the ids and the labels are not the same word, and two of the four carry no
  stylesheet rules of their own:

  | appearance | wrapper classes | where its tokens live |
  |---|---|---|
  | **Paper** (id `light`) | `app-shell` | `:root` — the default, no theme class needed |
  | **Ink** (id `dark`) | `app-shell dark` | `.dark` — **`theme-dark` defines nothing** |
  | **Porcelain** | `app-shell theme-porcelain` | `.theme-porcelain` |
  | **Onyx** | `app-shell theme-onyx dark` | `.theme-onyx` **plus** `.dark` |

  The shell also emits `theme-<id>` for all four, but only `theme-porcelain` and
  `theme-onyx` carry rules — so a dark design styled with `theme-dark` alone silently
  renders as Paper. `dark` is the class that actually makes a dark atmosphere dark.
- **`ToastProvider` is required** by anything calling `useToast` — `App`, `ScripturePage`,
  and `SourcesDisclosure` (its "Cite" button). Omit it and those throw at render.
- **Optional shell modifiers**, all on the same element: `material-translucent`,
  `reading-size-s|m|l`, `verse-nums-faint|hover`, `focus-mode`.

## The styling idiom

**Hand-written semantic classes plus CSS custom properties. There are no utility
classes** — no `bg-*`, no `p-4`, no Tailwind. Do not invent a utility vocabulary; write
a real class and style it with the tokens below.

| family | members |
|---|---|
| surfaces | `--bg-reading` (paper), `--bg-canvas` (canvas), `--bg-float`, `--bg-primary`, `--bg-secondary` |
| ink | `--text-primary`, `--text-secondary`, `--text-tertiary`, `--text-link`, `--text-link-hover`, `--text-verse-number`, `--text-on-accent` |
| provenance accents | `--accent-seal` (the reader wrote it), `--accent-laurel` (named licensed source), `--accent-machine` (app inferred), plus `--accent-source`, `--accent-xref`, `--accent-current`, `--accent-warm` |
| space | `--sp-xs` `--sp-sm` `--sp-md` `--sp-lg` `--sp-xl` `--sp-2xl` `--sp-3xl` |
| type | `--fs-xs` `--fs-sm` `--fs-base` `--fs-lg` `--fs-xl` `--fs-2xl` `--fs-3xl` `--fs-reading`; leading `--lh-tight` `--lh-normal` `--lh-relaxed` `--lh-reading` |
| radius | `--radius-sm` `--radius-md` `--radius-lg` `--radius-mark` `--radius-pebble` `--radius-page` `--radius-modal` `--radius-window` |
| motion | `--transition-instant` `--transition-fast` (120ms, ink) `--transition-normal` (180ms, panes) `--transition-slow` |
| grammar roles | `--role-subj` `--role-verb` `--role-obj` `--role-pred` `--role-adv` `--role-conj` `--role-det` `--role-prep` |

**Two planes only.** Paper (`--bg-reading`) and canvas (`--bg-canvas`). Never introduce a
third fill for hover or selection — change ink, or draw a rule or underline instead.
Nothing moves on hover. Never write a raw hex or a bare `120ms`; use a token.

## Where the truth lives

- `_ds/<folder>/styles.css` and everything it `@import`s — the authority for tokens and
  component styles. Read it before styling.
- `components/<Group>/<Name>/<Name>.prompt.md` — per-component usage.
- `guidelines/` — **read these for this project**: `01-data-shape-old-vs-new.md` (what data
  exists) and `02-the-brief-word-card-and-entity-card.md` (the brief, and the rules for
  showing a lot of data in a 380 px panel without overload).

## One idiomatic snippet

A library component for the control, a real class plus tokens for your own layout glue:

```jsx
<div className="app-shell theme-porcelain">
  <ToastProvider>
    <aside className="study-panel">
      <RenderingOrbitView model={orbit} onSelectSegment={(i, s) => pick(s)} />
      <SourcesDisclosure sources={[{ name: "STEPBible TIPNR", license: "CC BY 4.0", detail: "Identity" }]} />
    </aside>
  </ToastProvider>
</div>
```

```css
.study-panel {
  width: 380px;
  padding: var(--sp-lg);
  background: var(--bg-reading);
  color: var(--text-primary);
  font-size: var(--fs-sm);
  line-height: var(--lh-normal);
  border-left: 1px solid var(--accent-source);
}
```
