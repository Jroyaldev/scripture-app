# Biblical place research artifact

This directory is a deterministic, read-only reference artifact for the Living Margin entity research view.

## Sources and attribution

- `openbible-places.json` joins STEPBible TIPNR identities to [OpenBible Bible Geocoding Data](https://github.com/openbibleinfo/Bible-Geocoding-Data) at commit `7eb18a5ee62f27b9b93bd6689ea272d76dd23b8f`. OpenBible data is CC BY 4.0.
- `natural-earth-50m-land.geojson` is Natural Earth 5.1.2 land geometry. Natural Earth data is public domain.
- `media/` contains only the exact OpenBible thumbnail files selected for shipped place records. Every image record retains its creator, source URL, license, license URL, dimensions, alt text, and SHA-256 hash. The importer accepts only public-domain, CC0, CC BY, CC BY-SA, Free Art License, or Open Government Licence media; unapproved media falls back to the map treatment.
- `doctor-report.json` records source hashes, coverage, coordinate validity, identity uniqueness, media licensing and hashes, Natural Earth provenance, and unresolved or ambiguous joins for review.

The original JSONL files and thumbnail archive are external source originals and are not committed (INV-13). To regenerate the normalized artifact from the pinned snapshot:

```sh
npm run import:openbible-places -- /path/to/openbible-data /path/to/thumbnails.zip /path/to/ne_50m_land.geojson
```

The app never writes this directory. It is safe to replace only by rerunning the importer and passing the Doctor checks.
