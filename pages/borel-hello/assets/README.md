# Borel source font and pen paths

- Typeface: Borel Regular by Rosalie Wagner / The Borel Project Authors.
- Source: https://github.com/google/fonts/tree/main/ofl/borel
- Downloaded: 2026-10-07.
- Font blob SHA: `4b440768cc833cd29ee1dc88d4b9fd4d09702336`.
- License: SIL Open Font License 1.1; see `OFL.txt`.

Input supports ASCII English uppercase/lowercase, digits, and the font's
punctuation/symbols. Accented letters and combining accents are excluded.
Unsupported characters produce an input error. Text stays in the browser.

HarfBuzz shapes each line with Borel's default OpenType features. The original
font supplies contextual glyph selection, advances, positioning and the `tt`
ligature. `font-catalog.json` stores glyph IDs and metrics; regenerate the
catalog with `python3 scripts/generate-borel-catalog.py` (requires fonttools).

`pen-paths.json` stores independent, editable pen trajectories keyed by glyph ID.
Each `d` is an open cubic Bézier centerline, with one `widths` tuple per cubic:
start width, two width controls, end width. `nibScale` optionally sets an elliptical
nib for small dots. `mark` delays an i/j dot until its word has been written.
Initial, medial, final and isolated forms have their own curves. The original
hand-authored alphabet in `stroke-alphabet.ts` supplied stroke-order guides;
center curves and width controls were fitted against the licensed source font
and refined using foreground overlap tests. These paths are an interpretation
of handwriting order, not a prescribed order from the font designer.

`pen-geometry.ts` advances the pen along these curves and builds an SVG brush
ribbon from the traveled curve and its width. Playback uses neither font-outline
clipping, native text pixels, alpha reveal maps, nor captured frames. The debug
panel can separately overlay exact font outlines or the center trajectories.
Changing a pen curve changes the visible ink itself.

Vitest rasterizes the actual brush geometry and the independently shaped source
font with the same SVG renderer. Every supported contextual glyph must achieve
at least 95% soft-alpha foreground intersection-over-union; blank background is
excluded. Separate sentence tests cover wrapping, mixed case, punctuation and
word-initial n/w forms. All 60 fps frames of hello/name won are checked for loss
of already written ink. Chrome verification additionally checks native text
rendering and the live controls; temporary QA output is not shipped.
