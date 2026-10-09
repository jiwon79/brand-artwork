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

All 80 reachable a/h/i/m/t/u/w/y forms also have one ordered body, with separate
i dots and t crossbars. a completes its bowl counterclockwise before climbing
and descending its right upright; h completes its ascender before its stem and
shoulder. These choices follow French cursive instruction for
[a](https://clicmaclasse.fr/ecriture-de-la-lettre-a/) and
[h](https://l-education.com/ecrire-la-lettre-h-minuscule-cursive), consistent with
[Borel's French school-cursive basis](https://github.com/RosaWagner/Borel/blob/main/README_en.md).
Short stem returns stay on the same upright. They are part of the continuous
painted path, so restarting a round-capped fragment cannot add a side nub.

The remaining 130 c/e/g/j/l/n/o/p/q/r/s/v/z forms now also use one authored
body each. All 260 reachable lowercase forms retain their contextual entries
and exits. e/l/o loops run counterclockwise; g/j/z descend on the right before
returning around the left of the lower loop. n/p finish their first stem before
the right shoulder. q ends at the bottom and lifts to the following letter,
following the [French q ductus](https://l-education.com/ecrire-la-lettre-q-minuscule-cursive).
Small branch patches and complete-loop returns have been removed. Curve joins
share tangents; deliberate direction changes use a short rounded turn within
the same painted path or retrace the same upright. These curves were fitted
with continuity constraints as well as the separate 95% foreground-IoU gate.
A locally rounded turn is not a separately painted patch or a nib-width spike.

h's low-entry ascender and later shoulder remain independent cubic curves.
The shoulder meets the original ascender at one exact point with the same
tangent and nib width, then separates naturally. Its two cubic spans also
match signed curvature at that contact. Keeping the arch's inside edge beyond
the earlier ink prevents a protruding gradient sliver without copying a shared
curve. Eight low-entry/initial/final forms use this contact fit; the two cv02
high-entry forms retain their genuine crossing. Every original upward-entry
command stays unchanged; only the later shoulder is refitted, within one
ordered writing run.

b's non-final beak now completes its outgoing curve, keeping the high entries
in bm/bn/bv/bw connected. All nine tt ligatures use one continuous two-stem body
and one deferred crossbar. Lowercase x retains the requested two diagonals.

All 26 roman capitals and all ten digits have been reviewed against the
DGESCO [Écriture A ductus diagrams, p.21](https://eduscol.education.fr/document/15805/download#page=21).
A uses the separate descending arms from
[La forme des lettres, p.5](https://eduscol.education.gouv.fr/sites/default/files/document/ressc1ecritureforme-lettres456435pdf-74256.pdf#page=5).
The sources allow more than one capital ductus; this is the selected model,
not a claim of one mandatory French standard. As requested, Borel's shapes
remain: no ornamental capital flourishes, no middle bar added to 7, and no
extra terminal stem added to U. Borel I/J retain their existing horizontal bars.

D now draws its bowl clockwise, after lifting from its descending stem.
E writes the stem/bottom first, then top and middle; H writes left, crossbar,
right; I writes stem, bottom, top; J and T write the stem before the top bar.
K writes stem, lower arm, upper arm, and R has a separate final leg. M/N
descend the left stem before lifting for the connected remainder. X starts
with the right-to-left diagonal, and Y finishes its upright on the second run.
Each authored capital stroke is explicitly ordered.

Digits use one continuous body, except 4 and 5 which require two strokes.
0 turns counterclockwise; 1 rises to its apex before descending; 2/3 turn
clockwise; 4 completes its diagonal and horizontal before its right upright;
5 draws its left-to-right top bar before its descending body; 6 completes a
counterclockwise lower loop; 8 starts at the top and follows a continuous
figure eight; 9 closes its counterclockwise bowl before a local return into
the descender. Smooth joins share tangents and continuous width profiles.
There are 58 cubic segments across the ten digits, down from 515, without
tiny cap patches or new source-outline masks.

`pen-geometry.ts` advances the pen along these curves and adds short SVG brush
segments with round ends. Each segment covers the space swept by the nib;
their filled areas combine so crossing a previous stroke cannot cancel old ink.
Playback uses neither font-outline
clipping, native text pixels, alpha reveal maps, nor captured frames. The debug
panel can separately overlay exact font outlines or the center trajectories.
Changing a pen curve changes the visible ink itself.

The visible **획순 경로** mode overlays the actual playback centerline with
ordered colors, direction arrows, interval numbers and a moving pen marker.
Numbers divide long paths into inspection intervals, not handwriting strokes.
Dashed lines indicate scheduled pen lifts; their straight travel is illustrative
and never paints ink. Previous/next interval and frame controls pause playback.
The letter selector covers A–Z/a–z/0–9 and discovers all 260 lowercase contextual
forms through actual shaping witnesses. The context menu renders the complete
witness word so entry/exit routing remains the same as normal playback.
Capital and digit selections show the selected teaching movements and link to
the matching diagram page, rather than an ornamental capital of another shape.
The 7 and lowercase x selections explain their intentional shape/ductus
differences. Lowercase links remain comparison references. The overlay does not change
the authored pen paths or their order. Tests keep its marker synchronized with
actual ink timing, including separate dots, retracing and pen lifts.

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
directly from the example menu and checks every 60 fps state, alongside A–Z/0–9:
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

`contextual-flow.test.ts` checks all 80 a/h/i/m/t/u/w/y forms for authored order,
compact bodies and smooth stem silhouettes at four pixels per font unit. It
also replays every frame of th, la, aia, ma, ta, wa, ya and bua. A geometric
return check distinguishes a short reversal over an existing upright from an
unintended corner or a return that veers off the stem. The silhouette test is
separate: two locally aligned centerlines can still leave a visible edge seam.

Word regressions in `word-corpus.ts` include 932 everyday/connection-focused
words and 1,300 dictionary words (50 per initial letter, stratified by length).
Title-case and uppercase versions of the 932 words, plus 75 phrases with
punctuation, numbers and wrapping, bring the total to 4,171 complete-text cases.
The fixed dictionary fixtures are drawn from macOS `/usr/share/dict/words`
(`web2`), rather than depending on a machine's dictionary at test time.

`ductus.test.ts` checks the newly authored contextual forms for loop direction,
stem-before-shoulder order, q's descender finish, compact bodies and continuous
curve tangents. Every body in 676 lowercase pair contexts must connect, except
for a deliberate lift after q. Nine tt forms must complete both uprights before
their single crossbar. It also checks every 60 fps playback frame of the 130
newly reviewed lowercase forms and all nine ligatures for ink preservation and
nib-local drawing. `teaching-model.test.ts` adds independent, normalized movement
waypoints for every capital and digit, start/finish positions, stroke order,
pen lifts, loop winding and continuous nib profiles. Every reviewed glyph
must still pass the separate 95% source-ink IoU gate. Full uppercase and digit
playback also pass the same gradient/silhouette checks as lowercase words.
Existing source-font, 4,171-text, sentence, dot-timing and
magnified-edge regressions remain separate gates.

`h-overlap.test.ts` separately checks the common point, tangent and nib width
of all eight independent h contacts, plus a smooth arch and distinct curvatures.
Contrasting first/second-pass colors expose residual
ink at 50%, 100% and 150% weight, with a deliberately offset negative control.
This detects internal color slivers that final silhouette overlap cannot catch.
Independent entry samples prevent the contact fit from warping the first pass.
