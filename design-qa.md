# Color Text — Design QA

## Comparison target and evidence

- Source visual truth: `pages/color-text/assets/reference-frame.png`
- Source motion truth: `pages/color-text/assets/reference.mp4`
- Final deterministic implementation:
  `pages/color-text/qa/silhouette-final-default.png`
- Equal-size reference/implementation comparison:
  `pages/color-text/qa/silhouette-comparison-final.png`
- Three-class background/text/effect comparison:
  `pages/color-text/qa/silhouette-semantic-comparison-final.png`
- Focused three-class `Y` comparison:
  `pages/color-text/qa/silhouette-y-semantic-comparison-final.png`
- Reproducible metrics and analyzer:
  `pages/color-text/qa/silhouette-metrics-final.json` and
  `pages/color-text/qa/analyze-silhouette.mjs`
- Reference / previous constant-radius / final surface comparison:
  `pages/color-text/qa/surface-tension-final.jpg`
- Focused user-reference surface crop:
  `pages/color-text/qa/surface-tension-crop-final.jpg`
- Focused `Y`-junction evidence:
  `pages/color-text/qa/y-stroke-distance-final.png`
- User-reference legibility crop:
  `pages/color-text/qa/y-legibility-final.jpg`
- Four-state motion evidence:
  `pages/color-text/qa/motion-distance-final.jpg`
- Route: `/pages/color-text/?qa=1&qaX=0.37&qaY=0.52`
- Three-class route: append `&qaLabels=1`
- Browser: existing user Chrome window

The browser viewport was 1265 × 694 CSS px at DPR 2. The contained artwork
occupied 555 × 694 px and was Lanczos-normalized to the source's 480 × 600
frame before comparison. The reference and implementation in the combined
image therefore use the same crop, dimensions, and frozen palette state.

## Required fidelity surfaces

### Fonts, copy, spacing, and layout

- Result: passed.
- The nine source lines, manual 31.8 px character advance, 42.2 px line height,
  thin uppercase treatment, and 480 × 600 centered composition are unchanged.
- The WebGL canvas still uses a contained poster transform, so shader geometry
  cannot change page flow or introduce overflow.
- The previous 390 × 844 Chrome check remains applicable to layout because this
  revision changes only fixed-reference-space render targets and shaders; the
  canvas sizing, poster mapping, CSS, and input-coordinate mapping are unchanged.

### Geometry and image quality

- Result: passed.
- Reference evidence: at the `Y` junction the colored core follows both arms and
  continues through the stem at nearly constant width. Multiple strokes do not
  create a brighter round hotspot at their intersection.
- Baseline implementation evidence: thresholding one large Gaussian density
  accumulated neighboring stroke energy, enlarged intersections, exposed
  square density cells, and produced a cloudy center detached from the glyph.
- The nearest-stroke revision fixed the detached blur but still had a structural
  limitation: one output pixel retained only one closest glyph coordinate. At a
  `Y` junction this max/nearest construction could expand only outward and made
  a convex cap; it had no summed field in which an interior saddle could form.
- Final implementation evidence: the focused `Y` crop was accepted before the
  full silhouette was evaluated. Detected stroke alpha is sampled 192 times on
  a 30 px Fibonacci spiral and accumulated into a scalar metaball field. Both
  arms influence the same output region, so their gradients create a smooth,
  downward concavity through the junction. No `Y`-specific mask or hard-coded
  notch is used.
- `surface-tension-final.jpg` shows reference / previous constant-radius pass /
  final pass at equal size. The previous implementation has regularly repeated
  semicircles along every line; the final pass removes that rhythm while keeping
  the stroke-led topology and real interior openings.
- `surface-tension-crop-final.jpg` confirms the user-reported detail at 3×:
  the implementation now forms a continuous neck and gravity-like terminal
  rather than a circle merely stamped over a character.
- The 1440 × 1800 text mask remains high resolution. The 480 × 600 half-float
  geometry field matches the native source resolution. The 192-sample field is
  independently smoothed with a five-tap Gaussian at sigma 1.8, then a soft 0.07
  isosurface with 0.012 transition removes residual one-pixel steps. The
  nearest-stroke core is disabled, so no explicit outline remains.
- Palette-independent segmentation assigns background = 0, unaffected text = 1,
  and effect = 2. Reference / broad baseline / final effect areas are 25,180 /
  30,553 / 25,836 px; box occupancies are 0.457 / 0.569 / 0.511. The final area
  differs by +2.61% instead of +21.34%. Its median skeleton width is 31.80 px
  versus 32.14 px in the reference (-1.07%).

### Color and gradients

- Result: passed.
- Color is no longer derived from the silhouette density. A normalized field
  separately blurs `activation × glyph` and `glyph`, divides them, and uses the
  blurred glyph denominator as its main low-frequency carrier.
- The nine-pixel carrier merges individual character details before palette
  mapping. Only 4% of the fine nearest-stroke signal remains, enough to preserve
  directional junction behavior without making `THE`, `ON`, or `DEPENDING`
  legible as thick colored typography.
- The former erosion-derived rim and its fixed dark color were removed entirely.
  Rose, pale pink, and the hot color now overlap in RGB across the same scalar
  energy field. Low energy naturally darkens toward the boundary, so the result
  has depth without reading as a separately drawn outline.
- The enlarged Gaussian kernel and overlapping smoothstep ranges remove the
  discrete blue/pink/yellow bands seen in the previous pass while retaining the
  reference's pale transition zone around each hot core.
- The charcoal underprint is fully occluded inside colored coverage, removing
  the previous comb-line interference.

### States, interaction, and motion

- Result: passed.
- `motion-distance-final.jpg` is ordered settled / immediately after a jump /
  370 ms after the jump / 1300 ms after the jump.
- The immediate frame retains the old field. The intermediate frame shows the
  delayed light crossing the text. By 1300 ms the prior local seeds have crossed
  the cutoff and disappear rather than leaving an indefinitely fading raster
  cloud.
- Pointer tracking is eased and capped at 300 reference px/s. Glyph activation
  attacks over 55 ms, releases over 340 ms, and is removed from the geometry by
  the 0.02 input-detection threshold plus a 0.025 soft transition. The 0.05 seed
  threshold affects only the fine color carrier.
- During release, the same retained activation also contracts local pool radii,
  so trails neck down before the seed cutoff instead of retaining identical
  circles until they disappear.
- Deterministic QA coordinates are opt-in. A missing `qaX`/`qaY` pair no longer
  resolves to `(0, 0)` and disable live pointer interaction.

### Accessibility and resilience

- Result: passed.
- The semantic artwork label, WebGL fallback status, touch input, and
  reduced-motion palette freeze remain intact.
- TypeScript strict checks and the production Vite build pass.
- The final Chrome reload produced no new runtime or WebGL errors. Historical
  console entries were limited to transient hot-module states while the shader
  pipeline was being replaced.
- The existing ngrok tunnel returned HTTP 200 for the artwork route.

## Comparison history

1. Baseline — P1 geometry and image-quality mismatch.
   - One thresholded Gaussian field controlled both coverage and color.
   - `Y` intersections accumulated into center blobs and raw glyph underprint
     caused comb-like artifacts.
   - Fix: replace silhouette construction with nearest-seed jump flooding.
2. Distance-field pass 1 — P2 color discontinuity.
   - Geometry followed the glyph, but sampling activation only from a nearest
     seed made merged letters look like separately colored Voronoi cells.
   - Fix: add the normalized two-channel color field and sample it continuously
     at the output coordinate.
3. Distance-field pass 2 — P2 hard/cartoon edge.
   - The rim was too narrow and color transitions were too saturated.
   - Fix: widen the rim to 3.6 px, raise derivative antialiasing to 1.55 px,
     soften middle saturation, and include the reference's blue low-energy band.
4. Interaction pass — P1 live-input regression.
   - `Number(null)` made an absent QA coordinate appear valid and locked normal
     interaction at `(0, 0)`.
   - Fix: require both query keys before enabling deterministic pointer lock;
     live movement and delayed cutoff were then recaptured in Chrome.
5. Final comparison.
   - Finding after handoff — P1: nearest-stroke color modulation and a rim band
     around every expansion preserved complete word shapes; the effect read as
     a colored display font, while the reference obscures the source text.
   - Fix: derive the rim from the union silhouette, raise body radius to 13.4 px,
     and replace direct distance color with a six-pixel glyph-density carrier.
6. Final legibility comparison.
   - The colored region no longer exposes complete word shapes. Under the same
     page segmentation mode, Tesseract previously recovered several affected
     words including `DEPENDING`; the revised capture recovers only unaffected
     top copy and fragments outside the colored coverage, not words inside it.
   - No actionable P0, P1, or P2 mismatch remains for stroke-dependent geometry,
     non-legible color diffusion, smooth contours, gradient continuity, or delay.
7. Outline and continuity comparison.
   - Finding after handoff — P1: the union erosion still produced a uniform dark
     perimeter. Even without internal letter seams, it read as a literal outline,
     and the HSV ramp separated low- and high-energy colors too abruptly.
   - Fix: delete the rim pass and map the nine-pixel energy field through three
     overlapping RGB anchors. Increase silhouette antialiasing to 2.35 px and
     reduce the fine distance carrier from 16% to 4%.
   - Verification: in `compare-distance-final.jpg`, the implementation boundary
     now changes continuously from background to rose and then pale pink; there
     is no fixed-color contour. In `y-legibility-final.jpg`, the central color
     follows the junction region but does not reconstruct complete colored words.
8. Surface-tension comparison.
   - Finding after handoff — P1: constant 13.4 px dilation gave every active
     glyph pixel the same influence. Although the boundary was smooth, repeated
     semicircular caps made the effect read as large dots laid over the letters.
   - Fix: retain nearest-stroke topology but weight dilation radius by temporal
     activation, then blur only that constructed body and extract a soft
     isosurface. This separates stroke following from surface relaxation.
   - Three parameter passes compared 4.2–5.8 px relaxation kernels and 0.38–0.46
     isovalues. The selected 5.2 / 0.44 pair best preserves holes and thin necks
     while removing the per-character scallop rhythm.
   - Verification: the three-way and focused comparisons show unequal pool sizes,
     continuous necks, and tapered terminals. OCR on the final `Y` capture reads
     only unaffected copy below the colored area, not covered words.
9. Three-class silhouette and connected-stroke comparison.
   - Finding after handoff — P1: the total reach was close, but the previous
     30,553 px effect occupied 21.34% more area than the 25,180 px reference and
     filled 0.569 of its bounding box versus 0.457. It therefore remained wide
     and blunt. Reducing radius alone also erased the weak arms of `Y`.
   - Fix: narrow the distance body to 2.8–6 px, raise the isovalue, and add masked
     activation propagation that can travel only through connected pixels of a
     glyph. Use a 0.4–1.2 px continuity core so the propagated `Y` remains part of
     the surface without rebuilding all covered copy as thick colored type.
   - Verification: the final visible effect is 24,824 px with 0.449 box occupancy;
     bounding-box width/height differ from the reference by +3.26% / -2.73%.
     In the exact label map, the first `E·V` remain text while the following
     `E·R·Y` belong to the effect and the `Y` arms connect through its stem.
10. Source-informed metaball reconstruction and `Y`-first gate.
   - New evidence: the supplied Instagram caption names Shody's Metaball plugin
     and says the typography stroke is revealed with a falloff. The official
     Metaball manual describes input detection, Fibonacci sampling, threshold,
     falloff power, blur, and smoothing as separate stages.
   - Finding — P1: the nearest-stroke/surface-relaxation pass still created a
     convex lobe at the `Y` center. Because jump flooding stores only the closest
     seed, the two arms never coexist in one scalar field and cannot create the
     concave saddle seen in the reference.
   - Fix: detect falloff-masked text alpha, accumulate a 192-sample Fibonacci
     metaball field over 30 px, smooth it independently at sigma 1.8, and extract
     a soft isocontour. Disable the nearest-stroke geometry core; retain jump
     flooding only as a 4% color carrier.
   - `silhouette-y-semantic-comparison-final.png` was checked first. It shows the
     continuous white inlet descending through the `Y` junction instead of the
     former round protrusion. Only after this passed was
     `silhouette-semantic-comparison-final.png` checked as a whole.
   - Final semantic metrics: 25,836 effect pixels (+2.61%), 204 × 248 extent
     (-5.12% / -3.13%), 25.13 px equivalent strip width (-6.78%), and 31.80 px
     skeleton-width median (-1.07%) relative to the reference.

## Findings

- No actionable P0, P1, or P2 findings remain.
- P3: the MP4 begins with activation history from before its first encoded
  frame, so a freshly loaded deterministic frame cannot reproduce every detached
  trail fragment at the exact same coordinates.
- P3: exact source font outlines are unavailable; the existing Helvetica Neue
  Light fallback remains the closest installed match.

final result: passed

---

## Color distribution revision — 2026-08-08

## Evidence

- Source visual truth: `pages/color-text/assets/reference-frame.png`
- Browser-rendered implementation: `pages/color-text/qa/color-distribution-final-full.png`
- Normalized implementation crop: `pages/color-text/qa/color-distribution-final.png`
- Full-view comparison: `pages/color-text/qa/color-distribution-comparison-final.png`
- Focused color comparison: `pages/color-text/qa/color-distribution-focused-comparison.png`
- Source pixels: 480 × 600
- Implementation capture: 1265 × 694 CSS px at device pixel ratio 2; canvas buffer 2530 × 1388
- Density normalization: the centered 555 × 694 artwork region was cropped from the browser capture and downsampled to 480 × 600 with Lanczos filtering
- State: fixed QA palette, pointer locked at `qaX=0.37`, `qaY=0.52`
- Intentional state difference: the implementation falloff radii were reduced to approximately two-thirds of the previous values at the user's request, so effect extent is not expected to match the older source frame. The focused comparison judges the internal color topology and continuity.

## Findings

- No actionable P0, P1, or P2 differences remain for the requested change.
- Fonts and typography: family, weight, size, tracking, line height, line breaks, and copy remain unchanged from the established 480 × 600 implementation.
- Spacing and layout rhythm: poster centering and nine-line composition remain stable. The smaller activation footprint is intentional.
- Colors and visual tokens: the implementation now shows a dark outer body, a continuous pale transition, and localized bright oval centers. Color is sampled everywhere inside coverage, so there is no nearest-seed cutoff or rectangular discontinuity.
- Image quality and asset fidelity: the effect is rendered from half-float WebGL fields; the oval center mask is baked at 3× and linearly filtered. The focused comparison shows smooth center-to-edge transitions without block artifacts.
- Copy and content: all nine source lines are unchanged.
- [P3] Exact hotspot count and palette hue differ across animation frames and pointer positions. This is expected for the time-varying source; the structural requirement—separate oval peaks inside a connected liquid silhouette—is preserved.

## Comparison history

1. Earlier implementation used a Gaussian-blurred activation field divided by blurred glyph density, then gated color through nearest-seed validity. This flattened letter-local peaks into a broad blur and could end color abruptly.
2. Mapping color directly from the metaball surface removed the cutoff but merged a whole word into one color band. This remained a P2 mismatch with the reference's separate inner ovals.
3. Mapping raw glyph activation preserved local detail but made the bright region spell the letter shapes instead of forming soft centers.
4. Final fix: each non-space character now contributes a continuous 20 × 13 px radial ellipse to the temporal buffer. A 2.5 px horizontal / 2.0 px vertical Gaussian pass blends the low-energy halos while preserving separate high-energy centers. Post-fix evidence is recorded in both comparison images above.

## Interaction and runtime checks

- Pointer movement was tested at upper and lower artwork positions; the delayed light and oval color field followed correctly.
- The new `타원 가로 반경` lil-gui control was changed from 20 to 18 and restored to 20; the center mask rebuilt without reload.
- TypeScript typecheck and the production Vite build passed.
- Browser console warnings and errors: none.

## Implementation checklist

- [x] Reduce falloff radii to 107 / 80 / 160.
- [x] Replace density-normalized diffuse color with local oval center energy.
- [x] Preserve temporal attack and release for color centers.
- [x] Remove nearest-seed gating from visible color.
- [x] Expose ellipse radius and smoothing controls in lil-gui.
- [x] Verify fixed QA state, live pointer movement, GUI updates, build, and console.

## Follow-up polish

- P3 only: retune palette anchors for a particular frame if one exact animation timestamp becomes the acceptance target.

final result: passed

---

## Vertical variable color peaks revision — 2026-08-08

## Evidence

- Reference frame: `pages/color-text/qa/reference-color-vertical-06.png`
- Browser-rendered implementation: `pages/color-text/qa/color-vertical-final-full.png`
- Normalized implementation crop: `pages/color-text/qa/color-vertical-final.png`
- Side-by-side comparison: `pages/color-text/qa/color-vertical-comparison-final.png`
- Reference and normalized implementation: 480 × 600 px each
- Comparison input: 960 × 600 px, reference on the left and implementation on the right
- Browser capture: 1265 × 694 CSS px at device pixel ratio 2; canvas buffer 2530 × 1388
- State: fixed QA palette with pointer locked at `qaX=0.50`, `qaY=0.70`

## Findings

- No actionable P0, P1, or P2 differences remain for the requested color-peak geometry change.
- Typography, copy, spacing, line breaks, and the previously approved liquid silhouette are unchanged.
- The former fixed 20 × 13 px horizontal centers were visibly identical across letters and failed the reference's vertical, character-dependent variation.
- Each character now derives a distinct color center from its actual alpha-pixel mass, visible width, visible height, and alpha-weighted centroid. The baseline center is a 9 × 16 px vertical ellipse, then width and height vary independently per character.
- The final source mixes 80% character-statistics ellipse with 20% remembered glyph activation. This keeps the vertical oval readable while bending it slightly with each character's pixels.
- The side-by-side comparison confirms separate vertical peaks with differing widths, heights, positions, and intensities rather than repeated horizontal capsules.
- The half-float render targets, 3× baked center mask, and linear filtering preserve continuous gradients without rectangular or nearest-seed cutoffs.

## Experiment history

1. Raw remembered glyph activation produced varied vertical forms but made individual letters too legible, so it was rejected.
2. Metaball surface energy produced broad connected word bands and lost the reference's separate inner peaks, so it was rejected.
3. Character-statistics vertical ellipses produced the closest overall topology and were selected.
4. Glyph influence was compared at 0%, 20%, and 40%. At 0% the centers looked too regular; at 40% they became letter-shaped. The 20% hybrid was selected.

## Interaction and runtime checks

- Pointer movement was tested at two distant artwork positions; the captured frames differed and the delayed field followed the cursor.
- The `글자별 크기 차이` lil-gui control was changed from 1 to 0.75 and restored to 1 without reload.
- The color folder exposes the 9 px horizontal baseline, 16 px vertical baseline, per-character variation, and glyph-pixel deformation controls.
- TypeScript typecheck and the production Vite build passed.
- Browser console warnings and errors: none.

## Follow-up polish

- P3 only: if one exact source timestamp becomes the acceptance frame, the four geometry controls can be tuned against that frame without changing the rendering architecture.

final result: passed

---

## Touch-driven metaball field flow — 2026-08-08

## Evidence

- Fixed-time sequence: `pages/color-text/qa/interaction-drip-sequence.png`
- Fixed release sequence: `pages/color-text/qa/interaction-drip-release-sequence.png`
- Live state before touch: `pages/color-text/qa/interaction-drip-field-before-full.jpg`
- Live state 120 ms after a sustained press ended: `pages/color-text/qa/interaction-drip-field-early-full.jpg`
- Live state about 1 s after release: `pages/color-text/qa/interaction-drip-field-live-full.jpg`
- Hold sequence times: 0.18 s, 0.8 s, 1.6 s, and 2.4 s
- Release sequence: 1.6-second hold followed by 0 s, 0.4 s, 0.9 s, and 1.5 s of release
- Fixed QA anchor: `qaX=0.50`, `qaY=0.70`
- Live before/after captures used the normal reference falloff and palette.

## Findings

- A click or touch stores only the emitter position and elapsed time. No activated glyph-pixel snapshot is created.
- Holding emits a continuous age window of asymmetric cursor falloffs. A fresh age remains at the anchor while older ages accelerate downward, so the flow grows from the touched position instead of moving one ellipse as a rigid body.
- The shader evaluates 18 representative ages per output pixel. Older ages narrow to 44% width, the leading age bulges, and traveling neck, per-column speed, and center-meander terms remove the repeated-ellipse rhythm.
- Releasing stops new age-zero emission. The release sequence confirms that the source end clears first while the already emitted front continues downward.
- At every frame, the moved falloff is multiplied by the glyph mask at its new position. The sequence therefore changes from upper-line glyph pixels to newly encountered lower-line glyph pixels instead of translating the original silhouette.
- This new activation field enters the existing 192-sample metaball and smoothing passes, which still create the visible silhouette.
- No fallback color is injected at the anchor, and pointer-down no longer clears render targets outside the animation frame.
- A cursor-excluded 250 × 644 px left background region was pixel-identical immediately before the sustained press and 120 ms after release (infinite PSNR), confirming the full-screen color flash is gone.
- Touch drip is now the only interaction; the mode selector and interaction query are removed.
- The emitter follows a held drag continuously. Distance traveled shortens the old emission window, so the lowered portion clears instead of sliding sideways with the pointer.
- Drip energy attacks over 180 ms and is squared before field accumulation, avoiding a full silhouette on the first touched frame.
- Pointer capture and native callout/selection suppression keep long-press dragging inside the artwork interaction.

## Runtime checks

- A sustained pointer-down and release were tested in the existing Chrome artwork tab. The live held state connected the anchor to lower text rows; about one second after release, only the lower moving stream remained.
- Fixed QA frames were checked through both the growing hold window and the closing release window. The visible letter topology changes between frames, confirming that the initial glyph result is not being copied downward.
- The mode selector is gone and the normal page starts with only the charcoal text. Touch drip is the sole activation path.
- A held drag from the upper-left text area to a lower-right point produced its mature downward stream at the final pointer. The old lowered portion did not remain at the start point or slide across the page as a rigid body.
- At the 50 ms attack approximation, squared input energy stayed below the visible Metaball threshold. At 100 ms, a smaller glyph-dependent region had emerged; the same state at full energy produced the complete broad silhouette.
- Canvas pointer capture was exercised through a multi-point drag. A secondary-button context-menu attempt on the canvas showed no browser menu, and the canvas computed `touch-action` was `none`.
- The GUI contains no `<select>` and exposes the new `터치 시작 시간`, `드래그 따라가기`, and `이전 흐름 지우기` controls.
- Browser console warnings and errors: none.
- TypeScript typecheck and the production Vite build passed before final documentation updates.

final result: passed
