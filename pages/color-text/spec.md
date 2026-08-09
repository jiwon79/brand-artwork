# Color Text — implementation spec

## Reference

- Source: `assets/reference.mp4`
- 480 × 600, 4:5, 25 fps, 19.88 seconds
- Static nine-line typography with a colored local goo response

## Rendering model

1. Bake the nine text lines into a static 1440 × 1800 alpha texture, preserving
   the 480 × 600 artwork coordinate system at 3× sampling density.
2. Treat touch as a liquid source rather than a rendered head. Emit one physical
   particle every 130 ms, up to 32 particles. Each particle stores current position,
   horizontal and downward velocity, mass, energy, age, and a variation seed. Update
   position on the CPU with 78 px/s² gravity, viscous damping, and pairwise cohesion.
   Cohesion only attracts separating neighbours; compressed particles are not repelled
   because the Metaball surface already resolves their overlap. Age narrows and
   vertically stretches a particle's Falloff but never fades it out. Remove a particle
   only after it has moved fully below the artwork. If the 32-particle capacity is
   reached, merge the closest pair while conserving mass and momentum. Initial-source
   particles attack from zero over 360 ms; particles emitted after an 8 px drag start
   at full energy.
3. Rebuild the text mask each frame from the previous frame's per-glyph vertical
   offset and angle into a 1440 × 1800 unsigned-byte target. Keeping this target at
   the original 3× bake resolution prevents the visible underprint from being
   rasterized through the 480 × 600 geometry field. Measure each glyph's true
   half-width and inspect the nearest output cell plus both neighbours during
   inverse deformation, so wide glyphs such as W cannot be cropped at the fixed
   tracking-cell boundary. Source every candidate from its own 64 × 64 cell in a
   3×-resolution 8 × 8 glyph atlas instead of the combined text mask. Neighbouring
   glyph pixels therefore cannot be copied into the moving candidate or overlap
   the existing letter. Multiply the joined flowing
   falloff by that transformed glyph alpha and character-center mask at each current
   output position. At each pixel, track the strongest and second-strongest values
   across the flowing particles. Join near-tied winners with a
   monotonic smooth union over a 0.08 gap, then use the strongest value outside
   that gap. Because the union never falls below either input, it removes both
   dark overlap seams and hard maximum
   switching without the excessive broadening of an additive union. No glyph
   snapshot or temporal activation texture is retained.
   Releasing stops particle emission only. Existing particles keep their current
   position, velocity, and mass and continue through the same simulation until they
   leave the bottom of the artwork. No lifetime fade, in-place wipe, special released
   head, or rear-edge gate is used.
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
   store it in the touch-drip target's blue channel. This legacy ellipse field is
   retained for comparison but its final contribution defaults to zero.
9. Mix 20% of the current drip-activated glyph pixels back into the statistical
   ellipse field, then smooth it with a separable Gaussian filter (horizontal
   sigma 2.5, vertical ratio 1.1). In the final pass, also measure distance to the
   nearest active glyph pixel. Keep a glyph-shaped core out to 3.2 px with strength
   0.68, then transition to zero over a bounded 1 px edge. Unlike the previous
   Gaussian tail, no residual halo remains farther away. Attenuate the old ellipse
   energy at the same time. With the default ellipse influence of 0, the hottest
   area therefore follows letter branches and counters instead of remaining a row
   of identical vertical ovals. Read the combined field everywhere inside the
   metaball coverage, then map it through overlapping rose, pale-pink, and hot-color
   blends. Scale all HSV saturation by 0.72 and brightness by 0.96, then mix 12%
   warm cream into the result—slightly more at the hottest core—to prevent green,
   yellow, and magenta phases from becoming neon.
10. During a held drag, follow the pointer with time-based easing and emit each
    new particle at the source's current position. Previously emitted particles keep
    their physical state, so old streams keep falling while new streams start along
    the drag path. Accumulate one unit of source mass per 130 ms. Every 8 px of
    pointer travel may spend only the mass accumulated so far, clamped to 0.08–0.35
    per path particle. If less than 0.08 is available, move only the newest still-young
    source packet to the pointer instead of adding mass. Apply the same budget rule
    to the final pointer position.
    Capture the active pointer and suppress browser selection/callout behavior for
    uninterrupted movement. After release, stop supply and let every existing
    particle leave through the lower off-screen sink.
11. Give all 64 character slots an independent four-value spring state: vertical
    offset, vertical velocity, angle, and angular velocity. Test a 9 × 9 grid over
    every transformed non-space glyph and only count samples where current glyph
    alpha overlaps the visible liquid surface.
    Overall contact pulls that rigid glyph toward a 10 px downward offset. The
    left-versus-right contact difference produces torque toward an angle of up to
    9 degrees. Separate translation and rotation springs return the glyph to its
    original pose with restrained inertia when contact ends.
12. Render the transformed glyph mask into its own target before building the
    next liquid field. Use that same target for final underprint compositing, so
    both the visible text and the Metaball source follow the current glyph pose.
    The feedback is delayed by one animation frame to avoid a pass reading its own
    in-progress output.
13. Fully occlude the charcoal underprint inside the colored coverage, add only
   sub-pixel dithering inside that coverage, and animate all three palette anchors
   over time.

Geometry and color are deliberately independent. Geometry is flowing-falloff-masked
stroke alpha → sampled metaball influence → smoothing → isocontour. Color uses a
nearest-active-glyph distance core by default, with the old glyph-statistics-driven
vertical peaks available only as an optional mix, then clips that energy by the
geometry coverage. The old nearest-stroke distance
construction could only ask which
source pixel was closest, so the `Y` junction became a convex cap. The
accumulated geometry field preserves the influence of both arms at once; their
competing gradients create the concave saddle visible in the reference.

This interpretation is grounded in the supplied Instagram caption and the
official tools it names: Scenery's [Metaball overview](https://scenery.io/plugins/metaball-7w5Tj0PnVJJ),
its [manual](https://scenery.io/plugins/metaball-7w5Tj0PnVJJ/manual), and Cavalry's
[Falloff documentation](https://cavalry.studio/docs/nodes/utilities/falloff/).

## Silhouette-only validation — original-copy baseline

The comparison deliberately discards palette details and maps the image to three
classes: background = 0, unaffected text = 1, effect silhouette = 2.

These measurements were recorded before the copy changed from `COLOR CHANGES ...`
to `PRESS AND HOLD THE SURFACE ...`. They remain the geometry-acceptance baseline
for the Metaball method, not a pixel-count claim for the current letter layout.

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
- Touch drip is the only interaction. The held pointer is a source and is not
  rendered as a separate head. Holding continuously emits physical liquid particles;
  releasing stops emission while every existing particle continues downward. Every
  frame, the joined moving falloff is multiplied by the glyph mask at its current
  position, and those newly activated pixels enter the existing metaball passes.
- The emitter follows a held drag with exponential easing. Each 130 ms of held time
  supplies one unit of mass, so total liquid depends on elapsed time rather than
  pointer distance. Crossing each 8 px drag interval resamples the path immediately,
  but spends at most 0.35 of the accumulated mass. If there is not yet 0.08 available,
  only the newest source packet moves to the pointer. Already-falling streams remain
  at their physical positions.
- Before the first drag movement, particles at the initial touch origin attack over
  360 ms. Releasing freezes growing particles at their current energy so supply
  cannot increase after the finger lifts. Once the pointer has moved 8 px, newly
  created particles skip the birth delay.
- Gravity, viscous damping, and non-repulsive neighbour cohesion update all particle
  positions with simulation steps no larger than 1/60 s. Near-equal first and second field
  values crossfade over 0.08 instead of switching through a hard `max()`.
- Lower-stream temporal flutter defaults to 0.3. It reduces the amplitude of fast
  lane-speed, neck-width, meander, and density changes while retaining downward
  advection and the full spatial lane-speed differences.
- On release, the source only stops emitting. There is no lifetime or release fade;
  particles are removed only after their full Falloff is below the artwork.
- The visible background text moves as rigid glyphs rather than independently
  displaced pixels. Every glyph stores offset, velocity, angle, and angular
  velocity in a 64 × 1 ping-pong spring target. A 9 × 9 grid tests the product
  of the current transformed glyph alpha and the visible surface mask, so nearby
  invisible field and empty bounding-box space cannot move the glyph. The left
  and right four columns determine torque; the center column only contributes
  to vertical contact.
- Contact pulls a glyph down by up to 10 px with stiffness 58 and damping 12;
  releasing it lets the original-position spring settle naturally.
- Asymmetric contact rotates a glyph by up to 9 degrees. Rotation stiffness 46
  and damping 10 make it lean under off-center weight and settle back naturally.
- The transformed text mask feeds both the next Metaball field and the final
  underprint, so the silhouette cannot remain at the glyph's original pose.
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
- Add `&qaHasDragged=1` to make post-drag particles skip the initial birth delay.
- Press `g` to hide or reveal the tuning panel.

## Process View

- The five text buttons live in `index.html`; there is no separate process page.
  Switching views preserves the same pointer, particle, and glyph-spring state.
- The fixed bottom control moves through Falloff, active pixels, Metaball field,
  thresholded silhouette, and the final composite. Final is the default view.
- The interaction target alpha channel stores raw `streamLight` before it is
  multiplied by the text mask. The regular pipeline does not consume this channel;
  the debug Falloff view reads it directly and draws four contour bands.
- The other views read `interactionTarget.r`, `surfaceSourceTarget.r`, and
  `surfaceFieldTarget.r`, so the debug output cannot drift from the artwork's
  actual intermediate values.
- Active also draws the outermost Falloff contour from `interactionTarget.a`, so
  the influence boundary remains visible around the activated glyph pixels.
- Number keys 1–5 and the arrow keys mirror the bottom buttons.

## Reference-space defaults

- Font: Helvetica Neue Light fallback stack, 43 px
- Character advance: 31.8 px
- Line height: 42.2 px
- Light radius: 107 × 80 px above and 107 × 160 px below, with 0.55 horizontal
  taper toward the vertical edges
- Geometry/color field resolution: 480 × 600, half-float RGBA render targets
- Transformed visible-text mask: 1440 × 1800 unsigned-byte RGBA target, sampled
  directly by the final underprint pass
- Metaball input threshold / softness: 0.02 / 0.025
- Metaball sampling: 192 Fibonacci-spiral samples over 30 px
- Metaball falloff power / source gain / field gain: 3.2 / 0.55 / 2.2
- Metaball smoothing: sigma 1.8, five taps per axis
- Surface isovalue / edge softness: 0.07 / 0.012
- Nearest-stroke geometry core: disabled; jump flooding is retained only for
  that optional core
- Character-center color ellipse baseline: 9 × 16 px radius; actual dimensions
  vary by glyph ink mass, bounds, and centroid
- Character-center ellipse contribution: 0 by default
- Glyph-pixel deformation mixed into color peaks: 20%
- Glyph-shaped hot core: strength 0.68, 3.2 px radius, and 1 px bounded edge
- Color ellipse blur: sigma 2.5 horizontally, 2.75 vertically, 20 taps per side
- Color field floor / range: 0.015 / 0.48
- Palette saturation / brightness / warm pastel mix: 0.72 / 0.96 / 0.12
- Touch drip: up to 32 mass-carrying particles emitted every 130 ms,
  78 px/s² gravity, 18 px/s initial downward speed, 0.65 viscous damping,
  0.9 cohesion over 92 px, 0.34 vertical stretch,
  0.72 shape variation, 0.3 lower-stream temporal flutter,
  0.44 mature width, 0.92 metaball input strength,
  1.45 s stream formation, 360 ms initial-source attack,
  0.08 particle winner blend, 8 px drag path resampling distance,
  0.08–0.35 path-particle mass, 4% horizontal source-velocity transfer,
  off-screen-only removal, closest-pair mass/momentum-preserving merge, and
  13 s⁻¹ source follow rate
- Background-text spring: 64 character slots, 81 ink-and-surface overlap samples
  per visible glyph, 10 px target offset, translation stiffness 58, translation
  damping 12, 0 px contact padding, 9 degree target rotation, rotation stiffness
  46, and rotation damping 10
