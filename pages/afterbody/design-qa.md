# Afterbody Design QA

## Evidence

- Source visual truth: `pages/afterbody/assets/reference-display.png`
- Source video: `pages/afterbody/assets/reference.mp4`
- Browser-rendered implementation: `pages/afterbody/qa/implementation-stable.jpg`
- Full-view comparison: `pages/afterbody/qa/comparison-full.png`
- Focused figure comparison: `pages/afterbody/qa/comparison-figure.png`
- Interaction captures:
  - `pages/afterbody/qa/implementation-dissolve-mid.jpg`
  - `pages/afterbody/qa/implementation-cloud.jpg`
  - `pages/afterbody/qa/implementation-solid.jpg`
  - `pages/afterbody/qa/implementation-mobile.jpg`
- Source pixels: `960 × 430`
- Implementation pixels: `1265 × 860`
- Browser CSS viewport: `1265 × 860`, device pixel ratio `1`
- Mobile CSS viewport: `390 × 844`, device pixel ratio `1`
- Density normalization: the full comparison fits each source into a `640 × 450` black frame; the focused comparison normalizes both figure regions to `720 × 340`.
- Compared state: line figure, six echoes, idle state, black background.

## Findings

No actionable P0, P1, or P2 differences remain.

- Fonts and typography: the source artwork has no text. The implementation adds only a low-contrast, monospaced interaction hint outside the figure composition; it does not collide with or alter the artwork.
- Spacing and layout rhythm: six figures preserve the source's left-to-right reduction and overlap. The composition remains centered and intact at desktop and `390 × 844` mobile sizes.
- Colors and visual tokens: the source's red, green, and blue channel ordering, colored left edge, cyan right edge, additive white overlap, black background, and right-to-left dissolve direction are present.
- Image quality and asset fidelity: the human pose comes from `figure-source.png`, extracted from the provided video rather than replaced with an unrelated illustration. The line and solid modes share the same recovered mask. The deliberate low internal resolution, square particles, small glow, and scanlines preserve the TFT character without reproducing camera compression artifacts.
- Copy and content: `TAP TO DISSOLVE` changes to `TAP TO REPLAY` after the sequence. There is no additional app copy in the default view.
- Icons: none are required by the source or implementation.
- Interaction and accessibility: pointer/touch starts the sequence; `Space` and `Enter` also start it; `M` switches line/solid figures; `R` resets; the canvas has a focus indicator, semantic label, and reduced-motion adjustments.
- Browser verification: pointer dissolve, mid-sweep state, residual cloud, replay state, both figure modes, keyboard trigger/reset, desktop responsiveness, and mobile responsiveness were tested. The Chrome console reported no errors or warnings.

## Comparison History

### Pass 1

- [P1] The first implementation sampled the already RGB-separated source as a single mask and split it again, creating washed-out grey, overly dense stripes.
- Fix: isolated the green source pass as a neutral centerline, then generated red, green, and blue passes once with echo-dependent separation.
- Post-fix evidence: `pages/afterbody/qa/comparison-figure.png` shows distinct RGB bands and bright overlap matching the reference hierarchy.

### Pass 2

- [P2] The collapsed lil-gui header remained visible in the default artwork even though it was absent from the source.
- Fix: hid debug controls by default and retained access through `G` or `?debug=1`.
- Post-fix evidence: `pages/afterbody/qa/implementation-stable.jpg` contains only the artwork and the small interaction hint.

### Pass 3

- No P0, P1, or P2 findings. Type checking, production build, browser interaction tests, mobile layout, and console checks passed.

## Open Questions

- The video does not expose a clean master silhouette, so minor line gaps and compression-derived edge changes are expected. They do not change the pose, echo order, RGB behavior, or dissolve sequence.

## Implementation Checklist

- [x] Match the source pose and six-echo composition.
- [x] Provide line and solid versions from one mask.
- [x] Implement RGB separation and additive overlap.
- [x] Implement the right-to-left dissolve and rightward particle drift.
- [x] Support pointer, touch, keyboard, replay, and reduced motion.
- [x] Verify desktop and mobile rendering in Chrome.
- [x] Pass type checking and production build.

## Follow-up Polish

- [P3] The hint is intentionally retained for discoverability; it can be removed for a completely installation-like presentation.

final result: passed
