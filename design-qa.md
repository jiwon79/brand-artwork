# Color Changes — Design QA

## Comparison target and evidence

- Source visual truth: `pages/color-changes/assets/reference-frame.png`
- Source motion truth: `pages/color-changes/assets/reference.mp4`
- Final deterministic implementation:
  `pages/color-changes/qa/implementation-distance-final.png`
- Equal-size reference/implementation comparison:
  `pages/color-changes/qa/compare-distance-final.jpg`
- Focused `Y`-junction evidence:
  `pages/color-changes/qa/y-stroke-distance-final.png`
- User-reference legibility crop:
  `pages/color-changes/qa/y-legibility-final.jpg`
- Four-state motion evidence:
  `pages/color-changes/qa/motion-distance-final.jpg`
- Route: `/pages/color-changes/?qa=1&qaX=0.37&qaY=0.458`
- Browser: existing user Chrome window

The browser viewport was 1265 × 746 CSS px at DPR 2. The contained artwork
occupied 597 × 746 px and was Lanczos-normalized to the source's 480 × 600
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
  hotspot at the junction. Geometry still comes from distance to the nearest
  active glyph seed, while the fine carrier adds only a directional bias inside
  a broader low-frequency color field. The 1.55 px derivative antialiasing shows
  no square texels or stepped contours at native output or in the DPR 2 capture.
- The 1440 × 1800 text mask remains high resolution. The 480 × 600 half-float
  geometry field matches the native source resolution. A local 16 px jump flood
  covers the 13.4 px body radius and receives a second one-pixel cleanup pass.

### Color and gradients

- Result: passed.
- Color is no longer derived from the silhouette density. A normalized field
  separately blurs `activation × glyph` and `glyph`, divides them, and uses the
  blurred glyph denominator as its main low-frequency carrier.
- The six-pixel carrier merges individual character details before palette
  mapping. Only 16% of the fine nearest-stroke signal remains, enough to preserve
  directional junction behavior without making `THE`, `ON`, or `DEPENDING`
  legible as thick colored typography.
- The dark rim now comes from erosion of the union coverage, rather than from a
  distance band around every seed. Internal seams between neighboring letters
  therefore disappear while the outer silhouette and true holes retain a rim.
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
  the 0.085 seed threshold.
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

## Findings

- No actionable P0, P1, or P2 findings remain.
- P3: the MP4 begins with activation history from before its first encoded
  frame, so a freshly loaded deterministic frame cannot reproduce every detached
  trail fragment at the exact same coordinates.
- P3: exact source font outlines are unavailable; the existing Helvetica Neue
  Light fallback remains the closest installed match.

final result: passed
