# Color Changes — Design QA

## Comparison target

- Source visual truth: `pages/color-changes/assets/reference-frame.png`
- Source motion reference: `pages/color-changes/assets/reference.mp4`
- Browser-rendered implementation: `pages/color-changes/qa/implementation-final.jpg`
- Combined full-view evidence: `pages/color-changes/qa/compare-final.jpg`
- Route: `/pages/color-changes/?qa=1`
- Browser: existing user Chrome window
- State: palette frozen at the opening pink/yellow phase; light centered at the
  calibrated QA pointer position `(177.6, 325.2)` in the 480 × 600 artwork
  coordinate system

## Normalization

- Source pixels: 480 × 600 PNG extracted from the first video frame
- Implementation pixels: 480 × 600 browser screenshot
- CSS viewport: 480 × 600
- Density normalization: source and implementation are both compared at 1×
- Combined comparison: 960 × 600, source on the left and implementation on the
  right, without additional crop or device frame
- The tiny cursor remnant at the extreme top-left of Chrome screenshots is
  browser-automation chrome, outside the artwork content and excluded from the
  comparison.

## Full-view comparison

`pages/color-changes/qa/compare-final.jpg` shows the complete 4:5 composition at
matched size and interaction state.

- The nine lines use the same copy, fixed character rhythm, line breaks, and
  central alignment as the source.
- The text block begins and ends at the same reference-space positions.
- The active goo spans the same central group of lines and preserves the main
  negative-space holes, horizontal bands, and vertical joins.
- The opening palette preserves the source hierarchy: mauve fringe, milky pink
  body, yellow inner density, and small returning pink hotspots.
- Background and charcoal text contrast match the source without adding UI or
  decorative elements.

No additional focused crop was needed because the source is already 480 × 600,
the typography and goo edges remain readable in the 1× full-view comparison,
and there are no smaller icons or controls to inspect separately.

## Required fidelity surfaces

### Fonts and typography

- Result: passed.
- Helvetica Neue Light with manual 31.8 px character advance reproduces the
  source's thin uppercase rhythm, centered widths, 43 px optical scale, and
  42.2 px line height.
- P3: the source font file is unavailable, so a few terminal shapes differ
  subtly from the compressed reference. Block geometry and visual weight match.

### Spacing and layout rhythm

- Result: passed.
- The artwork uses a fixed 480 × 600 reference coordinate system and scales with
  `contain`, preserving the source's margins and central composition.
- No clipping or unintended wrapping was found at 480 × 600, 900 × 700, or
  390 × 844.

### Colors and visual tokens

- Result: passed.
- The background, charcoal type, pink/mauve body, yellow cores, cyan/green/red
  moving phases, and dark fringe follow the reference palette.
- P3: the implementation is slightly cleaner than the 213 kbps H.264 source;
  source compression noise and chroma macroblocking were intentionally not
  reproduced.

### Image quality and asset fidelity

- Result: passed.
- The user-supplied video and extracted reference frame are preserved as QA
  assets. The visible artwork itself is procedural WebGL, as required for the
  cursor-driven interaction; no placeholder, CSS drawing, SVG substitute, or
  generated raster replacement is present.
- The broad Gaussian field is rendered in two separable passes at reference
  resolution and uses linear filtering at responsive sizes.

### Copy and content

- Result: passed.
- Copy and line breaks exactly match the source:
  `COLOR / CHANGES / EVERYTHING / DEPENDING / ON / THE LIGHT / THAT / TOUCHES / IT`.

### States, interactions, and accessibility

- Result: passed.
- Cursor and touch positions directly control the light center with eased
  tracking and no persistent trail.
- Interaction evidence:
  `pages/color-changes/qa/interaction-upper-right.jpg` and
  `pages/color-changes/qa/interaction-lower-left.jpg`.
- Responsive evidence:
  `pages/color-changes/qa/responsive-wide.jpg` and
  `pages/color-changes/qa/responsive-mobile.jpg`.
- The canvas has a semantic artwork label and WebGL fallback message.
- Reduced-motion mode freezes palette animation and restores the platform cursor.
- Chrome console was checked after the reference state, both pointer states, and
  both responsive states; no warnings or errors were present.

## Comparison history

1. Initial field pass — `pages/color-changes/qa/compare-v2.jpg`
   - Earlier P1: circular light produced an oversized, nearly flat green field;
     the source required separate rows, holes, and pink/yellow density bands.
   - Fix: changed to a strongly falling elliptical light, raised the density
     threshold, reduced blur, and remapped the palette.
2. Color-band pass — `pages/color-changes/qa/compare-v6.jpg`
   - Earlier P2: density colors formed hard contour rings and the broad pink body
     was too saturated.
   - Fix: separated body/fringe treatment, lowered body saturation, and added a
     nonlinear peak return toward pink.
3. Spatial pass — `pages/color-changes/qa/compare-v11.jpg`
   - Earlier P2: a fixed-width ellipse made the distant upper rows too wide and
     the central/lower rows too narrow.
   - Fix: added vertical-position-dependent horizontal taper and recalibrated the
     pointer, radii, blur, and threshold against matched frames.
4. Final pass — `pages/color-changes/qa/compare-final.jpg`
   - Post-fix evidence: typography, overall active bounds, primary holes, color
     hierarchy, interaction, and responsive composition have no actionable
     P0/P1/P2 mismatch.

## Findings

- No actionable P0, P1, or P2 findings remain.
- P3: exact font outlines may differ slightly because the source font is not
  embedded in the reference.
- P3: the WebGL output is cleaner than the low-bitrate source video.

## Implementation checklist

- [x] Match 480 × 600 typography and copy
- [x] Drive the light from pointer and touch position
- [x] Build the goo from activated text density
- [x] Match the animated neon palette
- [x] Test upper-right and lower-left pointer positions
- [x] Test reference, wide, and tall viewports
- [x] Check Chrome console errors
- [x] Compare source and implementation side by side

final result: passed
