# Borel source font and pen paths

- Typeface: Borel Regular by Rosalie Wagner / The Borel Project Authors.
- Source: https://github.com/google/fonts/tree/main/ofl/borel
- Downloaded: 2026-10-07.
- Font blob SHA: `4b440768cc833cd29ee1dc88d4b9fd4d09702336`.
- License: SIL Open Font License 1.1; see `OFL.txt`.

| Asset | Role |
| --- | --- |
| `Borel-Regular.ttf` | Contextual glyph selection, metrics and reference outlines via HarfBuzz |
| `font-catalog.json` | Glyph IDs, metrics and component metadata |
| `pen-paths.json` | Independently authored centerlines and nib-width profiles keyed by glyph ID |
| `OFL.txt` | Font license |
| `og-artwork.png`, `og-image.png` | Artwork capture and final social preview card |

Regenerate the font catalog with `python3 scripts/generate-cursive-catalog.py`
(requires fonttools). This does not regenerate the independently authored pen paths.

Runtime terminology, coordinate units, asset fields and the complete rendering
flow live in [Cursive architecture](../../../docs/artworks/cursive/architecture.md).
The selected letter trajectories and their reference/validation records live in
[pen path authoring](../../../docs/artworks/cursive/pen-paths.md).
See [social share image production](../../../docs/artworks/cursive/social-share-image.md)
for the preview PNGs.
