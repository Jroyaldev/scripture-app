# Morphology expansion tables (evaluation / optional runtime)

Source: [STEPBible/STEPBible-Data](https://github.com/STEPBible/STEPBible-Data)  
- `TEGMC` — Translators Expansion of Greek Morphology Codes  
- `TEHMC` — Translators Expansion of Hebrew Morphology Codes  

License: **CC BY 4.0** (Tyndale House / STEPBible).  
Prefer linking to the upstream repo for redistribution; update by re-fetching from GitHub.

Used for:
- Offline audit: `npx tsx scripts/compare-step-morph.ts`
- **Runtime Approach A:** open form-notes overlay only (chips stay on our expanders)

Loaded once at app start from this folder (`TEGMC-*.txt`, `TEHMC-*.txt`).
