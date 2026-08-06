# Color Changes — Design QA

## Comparison target

- Source visual truth: `pages/color-changes/assets/reference-frame.png`
- Source motion truth: `pages/color-changes/assets/reference.mp4`
- Browser-rendered desktop screenshot:
  `pages/color-changes/qa/implementation-hq-final-full.png`
- Density-normalized implementation crop:
  `pages/color-changes/qa/implementation-hq-final.jpg`
- Combined source/implementation evidence:
  `pages/color-changes/qa/compare-hq-final.jpg`
- Motion evidence: `pages/color-changes/qa/motion-delay-contact-final.jpg`
- Responsive evidence: `pages/color-changes/qa/responsive-mobile-hq-final.png`
- Route: `/pages/color-changes/?qa=1`
- Browser: the existing user Chrome window
- State: palette frozen at the source's opening pink/yellow phase.

## Normalization

- Source pixels: 480 × 600 at 1×.
- Desktop browser viewport: 1265 × 694 CSS px at device pixel ratio 2.
- Desktop browser screenshot: 1265 × 694 pixels as returned by Chrome.
- Contained artwork region: 555 × 694 pixels, cropped from the browser screenshot
  and Lanczos-normalized to 480 × 600 for the combined comparison.
- Mobile viewport: 390 × 844 CSS px at device pixel ratio 1.
- Internal text and density fields: 1440 × 1800 half-float pixels, with
  trilinear mipmapped sampling when reduced to the output canvas.
- Static comparison pointer: reference-space `(177.6, 325.2)` from the top-left
  of the 480 × 600 artwork.

## Full-view comparison

`pages/color-changes/qa/compare-hq-final.jpg` places the source on the left and
the final browser render on the right at equal 480 × 600 pixel dimensions.

- Copy, nine-line wrapping, alignment, text size, and overall composition remain
  aligned with the source.
- The final colored field preserves the same central connected silhouette,
  negative-space channels, pink body, yellow density centers, and dark fringe.
- The implementation is intentionally cleaner than the compressed MP4 but no
  longer shows the square texels, hard 8-bit density steps, or jagged upscaling
  visible in the earlier implementation.

The artwork is already legible at the full 480 × 600 comparison size. A separate
focused crop was not necessary; the mobile evidence additionally stresses the
high-density center where the earlier aliasing was most visible.

## Required fidelity surfaces

### Fonts and typography

- Result: passed.
- Helvetica Neue Light with manual 31.8 px character advance continues to match
  the reference's thin uppercase rhythm, line height, and centered widths.
- Colored density now occludes the underlying dark glyphs inside the main field,
  avoiding the earlier comb-like colored stroke artifacts.
- P3: exact terminal shapes remain limited by the unavailable source font file.

### Spacing and layout rhythm

- Result: passed.
- The 480 × 600 artwork coordinate system still scales with `contain` and shows
  no overflow at 1265 × 694 or 390 × 844.
- The mobile check measured `scrollWidth: 390` and `scrollHeight: 844`, matching
  the viewport without unintended scrolling or clipping.

### Colors and visual tokens

- Result: passed.
- The opening state keeps the source hierarchy of dark magenta fringe, soft pink
  body, and yellow high-density centers.
- Hue and hotspot interpolation now spans a wider density interval, avoiding the
  hard contour rings found during the intermediate mobile pass.
- P3: isolated cyan/red edge fragments vary with the live palette phase and are
  not identical to every compressed source frame.

### Image quality and asset fidelity

- Result: passed.
- Text, activation, history, blur, and density are evaluated at 3× reference
  resolution. Intermediate density uses single-channel half-float targets rather
  than the previous 8-bit 480 × 600 buffers.
- Trilinear mipmaps remove the downsampling moire found at the 390 px viewport.
- Density derivatives provide edge antialiasing and low-amplitude in-field
  dithering removes residual output banding without adding noise to the white
  background or charcoal text.
- The procedural WebGL artwork uses the supplied MP4 as its visual source; no
  placeholder raster, SVG, or CSS substitute is present.

### Copy and content

- Result: passed.
- Copy and line breaks remain exactly:
  `COLOR / CHANGES / EVERYTHING / DEPENDING / ON / THE LIGHT / THAT / TOUCHES / IT`.

### States, interactions, and accessibility

- Result: passed.
- `pages/color-changes/qa/motion-delay-contact-final.jpg` shows four matched
  states: settled upper-left, immediately after a lower-right pointer jump,
  250 ms after the jump, and 1400 ms after the jump.
- The immediate frame remains at the previous location. The 250 ms frame shows
  controlled movement without an artwork-wide smear. By 1400 ms the previous
  activation has crossed the density threshold and disappeared.
- Tracking uses a 360 reference-pixel-per-second cap and 0.22 second half-float
  history persistence. Pointer-down no longer snaps the light.
- Pointer movement, the delayed transition, the final settled state, desktop,
  and mobile rendering were tested in the existing Chrome window.
- Chrome console was checked after desktop, mobile, and motion tests; no warnings
  or errors were present.
- The semantic artwork label and WebGL fallback remain intact. Reduced-motion
  mode continues to freeze palette cycling and restore the platform cursor.

## Comparison history

1. Baseline quality finding — P1
   - Earlier evidence: `pages/color-changes/qa/implementation-final.jpg`.
   - Finding: a 480 × 600 unsigned-byte density target was enlarged on a DPR 2
     canvas, exposing square texels and quantized color bands.
   - Fix: moved the mask and render targets to 1440 × 1800, switched density to
     half-float, added derivative antialiasing, and limited dithering to color.
2. Initial delay pass — P2
   - Earlier evidence: `pages/color-changes/qa/motion-delay-contact.jpg`.
   - Finding: temporal retention worked, but a large pointer jump painted an
     excessive vertical trail through most of the text block.
   - Fix: added a 360 px/s light-speed cap and reduced persistence to 0.22 s.
3. Narrow-viewport pass — P1
   - Earlier browser evidence showed comb-like downsampling at 390 × 844.
   - Finding: the 3× text and density textures used bilinear sampling without
     mip levels when reduced by more than 3×.
   - Fix: enabled trilinear mipmapped sampling for the text and final density,
     and removed the redundant direct-stroke color layer.
4. Final pass
   - Post-fix evidence: `compare-hq-final.jpg`,
     `motion-delay-contact-final.jpg`, and `responsive-mobile-hq-final.png`.
   - No actionable P0, P1, or P2 mismatch remains for the requested motion delay
     and gradient/image-quality corrections.

## Findings

- No actionable P0, P1, or P2 findings remain.
- P3: source compression and unavailable original font outlines prevent literal
  pixel identity, but they do not affect the corrected interaction or quality.

## Implementation checklist

- [x] Add delayed, speed-limited cursor tracking
- [x] Add short temporal persistence with threshold cutoff
- [x] Replace 8-bit reference-sized density with 3× half-float rendering
- [x] Add mipmapped downsampling for narrow/low-DPR viewports
- [x] Smooth color and hotspot interpolation
- [x] Test desktop, mobile, and a large pointer jump
- [x] Check Chrome console errors
- [x] Compare source and final implementation in one combined image

final result: passed
