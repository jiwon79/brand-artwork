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
nib for small dots. `mark` delays an i/j dot, a t/tt crossbar or the second x
diagonal until its word body has been written. `retrace` moves the pen over
existing ink without painting. `ordered` preserves a glyph's authored stroke
sequence and direction instead of finding a route through its pieces. All 40
supported f/d/b/x forms use these compact, authored runs; adjacent letters still
use the font's contextual shaping and matching entry/exit positions.
All 10 supported k forms also use a single authored path of nine cubics: the
large ascender loop, downward stem, shoulder loop and outgoing foot. Only the
short straight stem and crossbar are repeated as the pen changes direction;
the pen no longer returns around a completed loop to find another fragment.
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

`pen-playback.ts` schedules writing and pen lifts separately. Near-stationary
dot paths receive 160 ms of contact time at the default speed, independent of
their almost-zero arc length. Their round nib grows as it presses down; the
completed geometry is unchanged. Moving between disconnected strokes takes
100–320 ms without painting, so adjacent i/j dots appear one at a time.
The duration and speed controls scale this entire schedule together.
`pen-playback.test.ts` checks dot spacing, gradual contact area, pen-up travel
and identical completed geometry. Sentence-frame checks use this same schedule.

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

`lowercase-order.test.ts` checks all reachable f/d/b/x/k forms, including isolated
letters, for complete strokes, loop direction, d's stem-before-exit order and
x's two diagonals. k's stem must finish before its shoulder loop and foot.
A raster pause detector rejects complete-loop retracing even
when the repeated path is painted again rather than tagged as a retrace.

Word regressions in `word-corpus.ts` include 932 everyday/connection-focused
words and 1,300 dictionary words (50 per initial letter, stratified by length).
Title-case and uppercase versions of the 932 words, plus 75 phrases with
punctuation, numbers and wrapping, bring the total to 4,171 complete-text cases.
The fixed dictionary fixtures are drawn from macOS `/usr/share/dict/words`
(`web2`), rather than depending on a machine's dictionary at test time.
