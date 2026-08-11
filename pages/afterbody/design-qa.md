# Afterbody Design QA

## Evidence

- Source visual truth: `pages/afterbody/qa/reference-start-photo.jpg`
- Source video: `pages/afterbody/assets/reference.mp4`
- Browser-rendered implementation: `pages/afterbody/qa/implementation-continuous-final.png`
- Full-view comparison: `pages/afterbody/qa/comparison-continuous-final.png`
- Focused line-density comparison: `pages/afterbody/qa/comparison-continuous-focused.png`
- Interaction captures:
  - `pages/afterbody/qa/implementation-continuous-dissolve.png`
  - `pages/afterbody/qa/implementation-continuous-solid.png`
  - `pages/afterbody/qa/implementation-continuous-mobile.png`
- Source pixels: `576 × 318`
- Implementation pixels: `1152 × 636`
- Browser CSS viewport: `1152 × 636`, device pixel ratio `1`
- Mobile CSS viewport: `390 × 844`, device pixel ratio `1`
- Density normalization: the source is enlarged exactly `2×` to `1152 × 636`; the implementation is captured at that same size. The focused comparison crops both normalized views to `980 × 570` before stacking them.
- Compared state: continuous-line figure, six echoes, idle state, black background.

## Findings

No actionable P0, P1, or P2 differences remain for the requested starting-state correction.

- Fonts and typography: the source contains no artwork typography. The low-contrast `TAP TO DISSOLVE` hint stays outside the figure and does not affect the source composition.
- Spacing and layout rhythm: six figures now use independent horizontal centers, vertical centers, width scales, and height scales. The left figure is the largest; the right figures become progressively smaller, closer, and denser. The landscape composition remains centered without overflow at `390 × 844` mobile.
- Colors and visual tokens: red, green, and blue are three copies of the same path with positional offset only. Additive overlap produces yellow, cyan, and white regions on pure black.
- Image quality and asset fidelity: `figure-source-start.png` is cropped from the user-selected start photo. The idle figure is rendered as rounded Canvas strokes at device resolution, not as square points. Echo density is added with path-normal parallel lines; the rightmost upper body reads as a surface while its lower body retains visible dense strands. Square pixels appear only after the dissolve front reaches a path segment.
- Copy and content: `TAP TO DISSOLVE` changes to `TAP TO REPLAY` after the sequence. No additional visible copy is introduced.
- Icons: none are required by the source or implementation.
- Interaction and accessibility: pointer activation completed the right-to-left dissolve and reached `TAP TO REPLAY`. `M` switched to the solid human mode and back. Keyboard activation/reset behavior and reduced-motion handling remain in the implementation.
- Browser verification: the starting state, mid-dissolve state, replay state, line/solid mode switch, desktop view, and `390 × 844` mobile view were tested in the existing Chrome window. Chrome reported no warnings or errors.

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

## Open Questions

- The reference is a photographed TFT, so its optical bloom and camera softness merge some neighboring lines more than a browser canvas. The implementation keeps the underlying strands explicit and uses a small glow rather than reproducing compression blur.

## Implementation Checklist

- [x] Replace idle pixels with continuous rounded paths.
- [x] Use the exact selected starting pose.
- [x] Increase size reduction and overlap toward the right.
- [x] Increase strand density independently for every echo.
- [x] Preserve a surface-like upper body and line-readable lower body on the final echo.
- [x] Preserve RGB offset, right-to-left dissolve, particle drift, replay, and both figure modes.
- [x] Verify desktop/mobile rendering, interactions, build, and console output.

## Follow-up Polish

- [P3] The web rendering is intentionally cleaner than the photographed display; a stronger optical bloom can be added if exact camera softness becomes the next target.

final result: passed
