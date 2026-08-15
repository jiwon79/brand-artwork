# Afterbody Design QA

## Evidence

- Source visual truth: `pages/afterbody/qa/reference-start-photo.jpg`
- Source line assets: `pages/afterbody/assets/sori/figure-1.svg` through `figure-6.svg`
- Source video: `pages/afterbody/assets/reference.mp4`
- Browser-rendered implementation: `pages/afterbody/qa/implementation-sori-svg.png`
- Full-view comparison: `pages/afterbody/qa/comparison-sori-svg.png`
- Contact Burst state comparison: `pages/afterbody/qa/comparison-contact-burst.png`
- Interaction captures:
  - `pages/afterbody/qa/implementation-sori-svg-dissolve.png`
  - `pages/afterbody/qa/implementation-sori-svg-solid.png`
  - `pages/afterbody/qa/implementation-sori-svg-mobile.png`
  - `pages/afterbody/qa/implementation-original-mode.png`
  - `pages/afterbody/qa/implementation-contact-burst-impact.png`
  - `pages/afterbody/qa/implementation-contact-burst-mid.png`
  - `pages/afterbody/qa/implementation-contact-burst-right.png`
  - `pages/afterbody/qa/implementation-contact-burst-mobile.png`
- Source pixels: `576 × 318`
- Implementation pixels: `1152 × 636`
- Browser CSS viewport: `1152 × 636`, device pixel ratio `1`
- Mobile CSS viewport: `390 × 844`, device pixel ratio `1`
- Density normalization: the source is enlarged exactly `2×` to `1152 × 636`; the implementation is captured at that same size and vertically stacked in `comparison-sori-svg.png`.
- Compared states: six user-provided SVG line figures in idle, Original dissolve, and touch-centered Contact Burst states on a black background.
- Focused comparison: not needed in the final pass because each figure is large enough to inspect in the full-size `1152 × 1272` combined comparison; the dissolve and Solid modes have separate full-size captures.

## Findings

No actionable P0, P1, or P2 differences remain for the requested SVG asset replacement, preserved left-to-right dissolve, or new touch-centered Contact Burst.

- Fonts and typography: the source contains no artwork typography. The low-contrast `TAP TO DISSOLVE` and `TAP TO BURST` hints stay outside the figure and do not affect the source composition.
- Spacing and layout rhythm: the SVGs retain their authored dimensions, which already encode the progressive size reduction. Independent centers place them in the same left-to-right overlap rhythm as the reference. The landscape composition remains centered without overflow at `390 × 844` mobile.
- Colors and visual tokens: red, green, and blue are three copies of the same path with positional offset only. Additive overlap produces yellow, cyan, and white regions on pure black.
- Image quality and asset fidelity: `figure-1.svg` through `figure-6.svg` are the unchanged paths supplied in `SORI.zip`. Idle rendering uses their actual Bézier geometry and original progressive stroke widths. The first figure remains a continuous sparse line; the final figure has a surface-like torso and individually readable dense legs. Original and Contact Burst both convert sampled points from those same paths into square particles only after their respective wavefront reaches a segment.
- Copy and content: the hint reflects the lil-gui selection with `TAP TO DISSOLVE` or `TAP TO BURST`, then changes to `TAP TO REPLAY` after either sequence.
- Icons: none are required by the source or implementation.
- Interaction and accessibility: lil-gui `Interaction` switched between `Original` and `Contact Burst`. Pointer activation preserved the left-to-right dissolve in Original. In Contact Burst, separate center and right-side taps produced visibly different wave origins; the SVG segments converted to particles in radial distance order and moved away from the selected point. Both modes reached replay, `R` reset the sequence, and the canvas label describes both effects.
- Browser verification: the SVG starting state, preserved Original dissolve, Contact Burst impact and expanded wave, right-side touch origin, replay/reset, desktop view, and `390 × 844` mobile view were tested in the existing Chrome window. Chrome reported no warnings or errors.

## Comparison History

### Pass 1

- [P1] The idle figure was reconstructed from photographed pixels and drawn with `fillRect`, so it was pixelated before dissolution.
- Fix: replaced the idle point cloud with thinned, directionally merged, once-smoothed vector paths and moved the canvas to device-resolution rendering.
- Post-fix evidence: `implementation-continuous-final.png` shows uninterrupted rounded RGB strokes on the leftmost figure.

### Pass 2

- [P1] The first source crop came from a different pose in the video, producing the crouched silhouette shown in the user's second photo.
- Fix: extracted `figure-source-start.png` from the exact user-selected starting photo and recalibrated all six centers and non-uniform scales.
- Post-fix evidence: `comparison-continuous-final.png` shows the standing/bent-leg pose and matching left-to-right size progression.

### Pass 3

- [P1] Density copies initially moved only vertically, so the upper body thickened but near-vertical legs did not gain parallel strands.
- Fix: offset every density copy along the local path normal, then increased lower-body spacing so the last torso merges visually while the legs remain readable as dense lines.
- Post-fix evidence: `comparison-continuous-focused.png` shows progressive density across both upper and lower body regions.

### Pass 4

- No P0, P1, or P2 findings. Type checking, production build, pointer dissolve, replay completion, solid-mode toggle, mobile layout, and console checks passed.

### Pass 5

- [P1] The first SVG dissolve implementation sampled a multi-contour `<path>` as one continuous polyline, creating straight bridges between separated arm, torso, and leg contours during the transition.
- Fix: split every supplied path at each `M` command and sample the resulting subpaths independently.
- Post-fix evidence: `implementation-sori-svg-dissolve.png` keeps all authored gaps open while the right side converts into particles.

### Pass 6

- No P0, P1, or P2 findings. The normalized source/implementation comparison, SVG idle rendering, corrected dissolve, replay completion, Solid toggle, mobile layout, type checking, production build, and Chrome console checks passed.

### Pass 7

- The dissolve direction was intentionally reversed at the user's request. The leftmost sparse figure now enters the particle state first, and the sweep continues toward the rightmost dense figure.
- Post-change evidence: `implementation-sori-svg-dissolve.png` shows the left side dispersed while the right side remains intact.

### Pass 8

- Added lil-gui `Interaction` selection with `Original` and `Contact Burst`; Original retains the prior timing and rightward particle drift.
- Added a touch-centered radial spawn time based on the distance from the pointer to each sampled SVG point. The expanding RGB rings and bright path band share that radius, while converted particles receive radial and tangential velocity away from the touch point.
- Post-change evidence: `comparison-contact-burst.png` keeps the SVG-authored idle composition unchanged on the left and shows the path-derived radial particle wave on the right. `implementation-contact-burst-right.png` confirms that a different pointer coordinate moves the origin. Desktop, mobile, type checking, production build, and Chrome console checks passed.

## Open Questions

- The reference is a photographed TFT, so its optical bloom and camera softness merge neighboring lines more than the browser canvas. The implementation preserves the supplied SVG paths and uses a small glow rather than changing their geometry to imitate camera compression.

## Implementation Checklist

- [x] Add all six supplied SVG files as first-party Afterbody assets.
- [x] Render the supplied Bézier paths directly in the idle state.
- [x] Preserve their authored left-to-right size and density progression.
- [x] Keep a surface-like upper body and line-readable lower body on the final SVG.
- [x] Keep separate SVG subpaths disconnected during the dissolve.
- [x] Preserve RGB offset, left-to-right dissolve, particle drift, replay, and both figure modes.
- [x] Add selectable Original and Contact Burst interactions to lil-gui.
- [x] Drive Contact Burst timing and particle direction from the actual touch coordinate and sampled SVG path points.
- [x] Verify desktop/mobile rendering, interactions, build, and console output.

## Follow-up Polish

- [P3] The web rendering is intentionally cleaner than the photographed display; a stronger optical bloom can be added if exact camera softness becomes the next target without modifying the supplied SVG geometry.

final result: passed
