# Proper names (people & places)

## TIPNR (primary identity layer)

- **Source:** [STEPBible TIPNR](https://github.com/STEPBible/STEPBible-Data) — *Translators Individualised Proper Names with all References*
- **License:** CC BY 4.0 (credit STEP Bible / www.STEPBible.org)
- **Raw:** `TIPNR-STEPBible-CC-BY.txt`
- **Index:** `tipnr-index.json` (generated)

```bash
npx tsx scripts/import-tipnr.ts
```

### Design

| Layer | Role |
|-------|------|
| MACULA / OSHB token | *This word* in *this verse* is a proper name |
| TIPNR entity | *Which individual* (John Baptist ≠ John Apostle) + their refs |

Never resolve people by bare Strong’s alone (G2491 buckets all Johns).

Resolution order: **verse ∩ Strong** → verse only → Strong + name hint.
