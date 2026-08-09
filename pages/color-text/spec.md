# Color Text — implementation spec

## Reference

- Source: `assets/reference.mp4`
- 480 × 600, 4:5, 25 fps, 19.88 seconds
- Static nine-line typography with a colored local goo response

## Rendering model

1. Bake the nine text lines into a static 1440 × 1800 alpha texture, preserving
   the 480 × 600 artwork coordinate system at 3× sampling density.
2. Treat touch drip as the only interaction. Emit one independently anchored
   asymmetric falloff parcel every 130 ms while pressed, up to 32 live parcels.
   Advect every parcel downward from its own creation position with gravity,
   narrow older parcels into traveling necks, and join them with a maximum field.
   Each parcel attacks from zero over 180 ms so the earliest frames stay restrained.
3. Multiply the joined flowing falloff by the glyph alpha and character-center
   mask at each current output position. No glyph snapshot or temporal activation
   texture is retained. Releasing stops new parcels while existing parcels continue
   downward from their frozen origins.
4. Detect the resulting glyph-pixel activation with a low 0.02 threshold and 0.025 transition.
   Detection happens before the liquid field is built, matching the Metaball
   plugin's alpha/luminance input-detection stage instead of first turning every
   glyph pixel into a fixed-radius circle.
5. At every output pixel, sample the detected stroke 192 times on a Fibonacci
   spiral over a 30 px radius. Radial influence falls as
   `(1 - r / radius)^3.2`; the direct source contributes 0.55 and the accumulated
   neighborhood contributes 2.2. Multiple nearby stroke segments therefore add
   into one scalar metaball field. This addition—not nearest-stroke dilation—is
   what forms an isofield saddle between the two arms and stem of `Y`.
6. Apply a separate five-tap Gaussian smoothing pass in each axis with sigma 1.8.
   Sampling and smoothing are independent controls, as in the referenced plugin,
   and the second pass removes the stepped/square boundary without broadening the
   source stroke into an indiscriminate blur.
7. Extract the 0.07 isosurface with 0.012 softness. The nearest-stroke continuity
   core is disabled (`coreMix = 0`), so there is no explicit outline, fixed-radius
   body, or glyph-shaped union hidden underneath the metaball silhouette.
8. Build color in a field independent from silhouette geometry. Measure the
   actual alpha pixels inside every non-space character cell: ink mass, visible
   width and height, and alpha-weighted centroid. Use those measurements to bake
   a different soft vertical ellipse for each character. The 9 × 16 px default
   radii are only a baseline; sparse/narrow characters produce smaller peaks,
   dense/wide characters produce larger peaks, and each peak shifts slightly
   toward its glyph centroid. Multiply this field by the same flowing falloff and
   store it in the touch-drip target's blue channel.
9. Mix 20% of the current drip-activated glyph pixels back into the statistical
   ellipse field so the peaks inherit subtle character-dependent deformation
   without becoming readable letters. Smooth the result with a separable
   Gaussian filter (horizontal sigma 2.5, vertical ratio 1.1). Read this field
   everywhere inside the metaball coverage—there is no nearest-seed validity
   gate—then map it through overlapping rose, pale-pink, and hot-color blends.
10. During a held drag, follow the pointer with time-based easing and stamp each
    new parcel at the emitter's current position. Previously emitted parcels keep
    their original positions and ages, so old streams keep falling while new streams
    start along the drag path. If the final pointer position is over 6 px from the
    latest parcel, emit one final parcel there. Capture the active pointer and
    suppress browser selection/callout behavior for uninterrupted movement.
11. Give all 55 character slots an independent two-value spring state: vertical
    offset and velocity. Probe the actual liquid field at the ink center, edges,
    and corners of every non-space glyph. Contact pulls that entire glyph toward
    a 10 px downward offset; stiffness and damping return it to its original position
    with restrained inertia when contact ends. The text mask used to generate liquid
    remains static.
12. Fully occlude the charcoal underprint inside the colored coverage, add only
   sub-pixel dithering inside that coverage, and animate all three palette anchors
   over time.

Geometry and color are deliberately independent. Geometry is flowing-falloff-masked
stroke alpha → sampled metaball influence → smoothing → isocontour. Color is a
field of glyph-statistics-driven vertical peaks masked by the same flowing falloff
and clipped by that coverage. The old nearest-stroke distance construction could only ask which
source pixel was closest, so the `Y` junction became a convex cap. The
accumulated geometry field preserves the influence of both arms at once; their
competing gradients create the concave saddle visible in the reference.

This interpretation is grounded in the supplied Instagram caption and the
official tools it names: Scenery's [Metaball overview](https://scenery.io/plugins/metaball-7w5Tj0PnVJJ),
its [manual](https://scenery.io/plugins/metaball-7w5Tj0PnVJJ/manual), and Cavalry's
[Falloff documentation](https://cavalry.studio/docs/nodes/utilities/falloff/).

## Silhouette-only validation

The comparison deliberately discards palette details and maps the image to three
classes: background = 0, unaffected text = 1, effect silhouette = 2.

![Reference and implementation three-class silhouettes](qa/silhouette-semantic-comparison-final.png)

| Measurement | Reference | Previous | Final |
| --- | ---: | ---: | ---: |
| Effect pixels | 25,180 | 30,553 | 25,836 |
| Effect bounding box | 215 × 256 | 222 × 242 | 204 × 248 |
| Box occupancy | 0.457 | 0.569 | 0.511 |
| Equivalent strip width | 26.96 px | — | 25.13 px |
| Skeleton-width median | 32.14 px | — | 31.80 px |

The final visible effect area is 2.61% above the reference, versus 21.34% above
in the broad baseline. Its extent is 5.12% narrower and 3.13% shorter, while the
median skeleton width differs by only -1.07%. The focused comparison was the
first acceptance gate: the `Y` now contains a continuous, downward concavity at
the arms/stem junction rather than a convex center hotspot. Only after that gate
passed was the full silhouette measured.

The reproducible measurements and label-map generator are stored in
`qa/silhouette-metrics-final.json` and `qa/analyze-silhouette.mjs`.

## Interaction

- Pointer and touch position control the emitter while the primary pointer is held.
- Metaball source alpha is suppressed below the 0.02 detection threshold with a
  0.025 transition. The 0.05 cutoff applies only to the optional nearest-stroke
  continuity core.
- The palette completes a smooth cycle every eight seconds.
- Touch drip is the only interaction. It advects and vertically stretches the
  touched cursor falloff itself. Holding continuously emits new falloff ages;
  releasing stops emission while the existing stream continues downward. Every
  frame, the joined moving falloff is multiplied by the glyph mask at its current
  position, and those newly activated pixels enter the existing metaball passes.
- The emitter follows a held drag with exponential easing. Each 130 ms emission
  freezes the emitter position at that instant, so already-falling streams do not
  move sideways when the pointer moves.
- Every parcel attacks over 180 ms instead of appearing at full strength on its
  first frame.
- The visible background text moves as rigid glyphs rather than independently
  displaced pixels. Every glyph stores offset and velocity in a 55 × 1 ping-pong
  spring target, while nine surface-field probes determine contact.
- Contact pulls a glyph down by up to 10 px with stiffness 58 and damping 12;
  releasing it lets the original-position spring settle naturally.
- Pointer capture keeps drag updates continuous outside the initial touch point.
  Native selection, callouts, dragging, and the context menu are suppressed on the
  artwork canvas.
- `?qa` freezes the palette at the reference's pink/yellow phase.
- `?qa&qaX=0.37&qaY=0.52` also locks the pointer in normalized artwork space
  for deterministic reference comparisons.
- Add `&qaLabels=1` to render the exact background/text/effect class map without
  palette information.
- Add `&qaDripAge=1.6&qaDrip=1` to freeze a 1.6-second held stream. Add
  `&qaDripReleaseAge=0.9` to inspect that stream 0.9 seconds
  after emission stopped.
- Press `g` to hide or reveal the tuning panel.

## Reference-space defaults

- Font: Helvetica Neue Light fallback stack, 43 px
- Character advance: 31.8 px
- Line height: 42.2 px
- Light radius: 107 × 80 px above and 107 × 160 px below, with 0.55 horizontal
  taper toward the vertical edges
- Geometry/color field resolution: 480 × 600, half-float RGBA render targets
- Metaball input threshold / softness: 0.02 / 0.025
- Metaball sampling: 192 Fibonacci-spiral samples over 30 px
- Metaball falloff power / source gain / field gain: 3.2 / 0.55 / 2.2
- Metaball smoothing: sigma 1.8, five taps per axis
- Surface isovalue / edge softness: 0.07 / 0.012
- Nearest-stroke geometry core: disabled; jump flooding is retained only for
  that optional core
- Character-center color ellipse baseline: 9 × 16 px radius; actual dimensions
  vary by glyph ink mass, bounds, and centroid
- Glyph-pixel deformation mixed into color peaks: 20%
- Color ellipse blur: sigma 2.5 horizontally, 2.75 vertically, 20 taps per side
- Color field floor / range: 0.015 / 0.48
- Touch drip: up to 32 independently anchored parcels emitted every 130 ms,
  78 px/s² gravity, 0.34 vertical stretch,
  0.72 column-flow variation, 0.44 mature width, 0.92 metaball input strength,
  1.45 s stream formation, 4 s per-emission lifetime, 180 ms touch attack,
  and 13 s⁻¹ drag follow rate
- Background-text spring: 55 character slots, nine contact probes per visible
  glyph, 10 px target offset, stiffness 58, damping 12, and 4 px contact padding
