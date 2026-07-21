# TASK D2: Six Pericope atmospheres on Smart Shapes

STATUS: COMPLETE.

## Objective

Add Porcelain and Onyx without changing Smart Shapes geometry, interaction,
selection, or durable authored records.

## Delivered contract

- `AppTheme` contains six atmospheres; the existing system light/dark default
  and all four persisted legacy choices remain stable.
- Porcelain uses bright brand gold for fills and `#B87D1C` for thin non-text
  strokes (3.51:1 on white). Onyx participates in every dark portal and
  marking surface.
- All Shape, margin, map, focus, picker, and marking-surface UI consumes the
  semantic token layer rather than theme-specific geometry.

## Verification

- Type, token, picker, portal, settings, and contrast contracts.
- Full lint, tests, renderer/Electron builds, and six-theme QA tour syntax.
