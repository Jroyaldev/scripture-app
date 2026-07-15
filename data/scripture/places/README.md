# Biblical place research artifact

This directory is a deterministic, read-only reference artifact for the Living Margin entity research view.

## Sources and attribution

- `openbible-places.json` joins STEPBible TIPNR identities to [OpenBible Bible Geocoding Data](https://github.com/openbibleinfo/Bible-Geocoding-Data) at commit `7eb18a5ee62f27b9b93bd6689ea272d76dd23b8f`. OpenBible data is CC BY 4.0.
- `pleiades-4.1.json` preserves the 96 Pleiades records linked by OpenBible from numbered [Pleiades Gazetteer release 4.1](https://github.com/isawnyu/pleiades.datasets/releases/tag/v4.1), dated 2025-05-28 at commit `b6a6790f71c45e4a4ef60fce296c506f28f458bf` (DOI `10.5281/zenodo.1193921`). Pleiades is CC BY 3.0. It remains a separate ancient-gazetteer layer: names, dated assertions, geometries, connections, and bibliography are not merged into OpenBible's modern location proposal.
- `natural-earth-50m-land.geojson` is Natural Earth 5.1.2 land geometry. Natural Earth data is public domain.
- `media/` contains only the exact OpenBible thumbnail files selected for shipped place records. Every image record retains its creator, source URL, license, license URL, dimensions, alt text, and SHA-256 hash. The importer accepts only public-domain, CC0, CC BY, CC BY-SA, Free Art License, or Open Government Licence media; unapproved media falls back to the map treatment. Descriptions are conservatively classified as proposed site, geographic context, associated artifact, or later reception so a church, model, landscape, or museum object is never presented as an archaeological photograph of the named place.
- `doctor-report.json` records source hashes, coverage, coordinate validity, identity uniqueness, media licensing and hashes, Natural Earth provenance, and unresolved or ambiguous joins for review.
- `pleiades-doctor-report.json` pins the numbered release, date, commit, DOI, source-manifest hash, license, linked-ID coverage, coordinates, geometry, source rights, and normalized-artifact hash. Coordinate differences are retained for review rather than collapsed into one supposed best location.

The original JSONL files and thumbnail archive are external source originals and are not committed (INV-13). To regenerate the normalized artifact from the pinned snapshot:

```sh
npm run import:openbible-places -- /path/to/openbible-data /path/to/thumbnails.zip /path/to/ne_50m_land.geojson

# Fetch only the 96 linked raw records into an external installed-artifact directory,
# then normalize them into the committed read-only artifact.
npm run fetch:pleiades -- /tmp/pleiades-4.1
npm run import:pleiades -- /tmp/pleiades-4.1
```

The app never writes this directory. It is safe to replace only by rerunning the importer and passing the Doctor checks.
