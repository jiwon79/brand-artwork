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
nib for small dots. `mark` delays an i/j dot or a t/tt crossbar until its word
body has been written. `retrace` moves the pen over existing ink without painting.
Initial, medial, final and isolated forms have their own curves. The original
hand-authored alphabet in `stroke-alphabet.ts` supplied stroke-order guides;
center curves and width controls were fitted against the licensed source font
and refined using foreground overlap tests. These paths are an interpretation
of handwriting order, not a prescribed order from the font designer.

`pen-geometry.ts` advances the pen along these curves and adds short SVG brush
segments with round ends. Each segment covers the space swept by the nib;
their filled areas combine so crossing a previous stroke cannot cancel old ink.
Playback uses neither font-outline
clipping, native text pixels, alpha reveal maps, nor captured frames. The debug
panel can separately overlay exact font outlines or the center trajectories.
Changing a pen curve changes the visible ink itself.

Vitest rasterizes the actual brush geometry and the independently shaped source
font with the same SVG renderer. Every supported contextual glyph must achieve
at least 95% soft-alpha foreground intersection-over-union; blank background is
excluded. Separate sentence tests cover wrapping, mixed case, punctuation and
word-initial n/w forms. `sentence-motion.test.ts` reads the 12 test sentences
directly from the example menu and checks every 60 fps state, alongside A–Z:
new ink must stay inside the traveled nib footprint and old ink must remain.
Letter-specific guards preserve complete capital strokes, l/f loop order,
deferred t crossbars and compact curves without pressure knots or needle tips.
These checks supplement visual inspection; source overlap alone cannot prove
natural stroke order for every possible text. Chrome verification checks native text
rendering and the live controls; temporary QA output is not shipped.

Word regressions in `word-corpus.ts` include 932 everyday/connection-focused
words and 1,300 dictionary words (50 per initial letter, stratified by length).
Title-case and uppercase versions of the 932 words, plus 75 phrases with
punctuation, numbers and wrapping, bring the total to 4,171 complete-text cases.
The fixed dictionary fixtures are drawn from macOS `/usr/share/dict/words`
(`web2`), rather than depending on a machine's dictionary at test time.
