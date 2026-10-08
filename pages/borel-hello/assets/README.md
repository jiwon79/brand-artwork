# Borel source font

- Typeface: Borel Regular by Rosalie Wagner / The Borel Project Authors.
- Source: https://github.com/google/fonts/tree/main/ofl/borel
- Downloaded: 2026-10-07.
- Font blob SHA: `4b440768cc833cd29ee1dc88d4b9fd4d09702336`.
- License: SIL Open Font License 1.1; see `OFL.txt`.

The bundled font contains 351 encoded codepoints and 1,514 glyphs, including
contextual forms. Input supports its Latin uppercase/lowercase, accented letters,
combining marks, digits, punctuation, and symbols. Characters absent from this
font, including Hangul, produce an explicit input error. Nothing is sent to a
server; the font and HarfBuzz WebAssembly module load from this site.

`stroke-alphabet.ts` contains authored pen trajectories for letter bodies, marks,
and symbols. `font-catalog.json` retains the source font's glyph IDs, metrics,
composite transforms, and registration of contextual letter bodies. Regenerate
it with `python3 scripts/generate-borel-catalog.py` (requires `fonttools`).
HarfBuzz shapes each line with the font's default OpenType features, including
contextual substitutions, positioning, mark placement, and the `tt` ligature.
The layout joins lowercase pen endpoints, writes dots/accents after their word,
and wraps long input. Roman capitals retain Borel's separate strokes.

The visible ink is a round, 90-font-unit stroke following the pen trajectories;
the previous `hello` study's 36-unit SVG stroke used a 0.4 font scale. The verified
`h`, `e`, `l`, and final `o` trajectories are reused as canonical letter paths.
A regression test samples the original `hello` curves to retain their shape.

This remains a Borel-based lettering interpretation, not exact font contours or
the font designer's prescribed stroke order. The debug panel overlays the exact
shaped font outlines for comparison. No outline mask or pre-rendered animation
frames are used in playback. Tests cover every drawable glyph and all 676 basic
lowercase pairs; visual QA captures are temporary and are not shipped.
