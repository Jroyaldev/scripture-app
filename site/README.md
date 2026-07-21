# Pericope — marktheword.com

Standalone marketing landing page for **Pericope**, a Shepherdly product
(from the people behind [churchdesk.app](https://churchdesk.app)).

Zero dependencies, zero build step. Three files plus an `assets/` folder of
product screenshots (downscaled from `docs/ui-audit/`):

```
index.html    — structure and copy
styles.css    — white/minimal design system, iOS pill nav, bento, reveals
script.js     — nav scroll state, IntersectionObserver reveals, hero parallax
assets/       — product screenshots (PNG, ≤1920w)
```

## Preview

```sh
cd site
python3 -m http.server 8199
open http://localhost:8199
```

## Deploy

It's a static folder — drop it on any static host (Cloudflare Pages, Netlify,
S3 + CDN, nginx). Point `marktheword.com` at it and it is live as-is.

## Notes

- The early-access form is a `mailto:` placeholder. Swap the `<form>` action
  for a real list provider (Buttondown, Loops, a Workers endpoint) when ready.
- Screenshots are regenerated from `docs/ui-audit/` with `sips -Z <width>`;
  re-run the same commands to refresh them after UI changes.

## Brand assets

Source renders live in `~/Desktop/Pericope Assets` (off-white background, no
alpha). `process-brand.py` (PIL + numpy) measures the background level,
unblends it out, trims to content, and writes `assets/brand/`:

- `mark.png` / `mark-white.png` — the ¶-mark on transparency (light/dark use)
- `lockup.png` — full mark + gold divider + wordmark on transparency (nav, footer)
- `app-icon.png`, `favicon-32.png`, `apple-touch-icon.png` — squircle variants
- `brand-*.png` — trimmed archival copies on their original background

Re-run with `cd site && python3 process-brand.py` after the source art changes.
