# Color Changes — Design QA

## Comparison target and evidence

- Source visual truth: `pages/color-changes/assets/reference-frame.png`
- Source motion truth: `pages/color-changes/assets/reference.mp4`
- Final deterministic implementation:
  `pages/color-changes/qa/silhouette-final-default.png`
- Equal-size reference/implementation comparison:
  `pages/color-changes/qa/silhouette-comparison-final.png`
- Three-class background/text/effect comparison:
  `pages/color-changes/qa/silhouette-semantic-comparison-final.png`
- Focused three-class `Y` comparison:
  `pages/color-changes/qa/silhouette-y-semantic-comparison-final.png`
- Reproducible metrics and analyzer:
  `pages/color-changes/qa/silhouette-metrics-final.json` and
  `pages/color-changes/qa/analyze-silhouette.mjs`
- Reference / previous constant-radius / final surface comparison:
  `pages/color-changes/qa/surface-tension-final.jpg`
- Focused user-reference surface crop:
  `pages/color-changes/qa/surface-tension-crop-final.jpg`
- Focused `Y`-junction evidence:
  `pages/color-changes/qa/y-stroke-distance-final.png`
- User-reference legibility crop:
  `pages/color-changes/qa/y-legibility-final.jpg`
- Four-state motion evidence:
  `pages/color-changes/qa/motion-distance-final.jpg`
- Route: `/pages/color-changes/?qa=1&qaX=0.39&qaY=0.458`
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
- Final implementation evidence: the focused `Y` crop has no isolated round
  hotspot at the junction. Activation first propagates along connected pixels of
  the same glyph, so touching the stem reaches both `Y` arms without crossing to
  adjacent letters. Nearest-stroke distance then varies the body radius from
  2.8 to 6 px. A 5.8 px surface relaxation forms the broad pools, while a
  0.4–1.2 px continuity core preserves the stroke-led branch and narrow neck.
- `surface-tension-final.jpg` shows reference / previous constant-radius pass /
  final pass at equal size. The previous implementation has regularly repeated
  semicircles along every line; the final pass removes that rhythm while keeping
  the stroke-led topology and real interior openings.
- `surface-tension-crop-final.jpg` confirms the user-reported detail at 3×:
  the implementation now forms a continuous neck and gravity-like terminal
  rather than a circle merely stamped over a character.
- The 1440 × 1800 text mask remains high resolution. The 480 × 600 half-float
  geometry field matches the native source resolution. Eight masked propagation
  passes follow axial, diagonal, and 2:1 stroke directions before the local
  16 px jump flood. The 5.8 px surface blur uses 13 taps per side, then a soft
  0.36 isosurface removes residual one-pixel steps.
- Palette-independent segmentation assigns background = 0, unaffected text = 1,
  and effect = 2. Reference / previous / final effect areas are 25,180 / 30,553 /
  24,824 px; box occupancies are 0.457 / 0.569 / 0.449. The final is 1.41%
  narrower in filled area than the reference instead of 21.34% wider.

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
  attacks over 55 ms, releases over 340 ms, and disappears geometrically below
  the 0.05 seed threshold.
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

## Findings

- No actionable P0, P1, or P2 findings remain.
- P3: the MP4 begins with activation history from before its first encoded
  frame, so a freshly loaded deterministic frame cannot reproduce every detached
  trail fragment at the exact same coordinates.
- P3: exact source font outlines are unavailable; the existing Helvetica Neue
  Light fallback remains the closest installed match.

final result: passed
