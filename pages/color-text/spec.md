# Color Text — implementation spec

## Reference

- Source: `assets/reference.mp4`
- 480 × 600, 4:5, 25 fps, 19.88 seconds
- Static nine-line typography with a colored local goo response

## Rendering model

1. Bake the nine text lines into a static 1440 × 1800 alpha texture, preserving
   the 480 × 600 artwork coordinate system at 3× sampling density.
2. Treat touch as a liquid source rather than a rendered head. Supply one unit of
   mass every 130 ms, up to 32 particles. Fill the first attached source particle
   continuously from zero to one mass. Move that full-size packet toward the pointer
   with a 7.5 s⁻¹ exponential follow rate and keep its age at zero until another full
   unit is ready. Then atomically swap in an identical full source packet and release
   the previous one. Each particle stores current position,
   horizontal and downward velocity, mass, energy, age, and a variation seed. Update
   position on the CPU with 78 px/s² gravity, viscous damping, and pairwise cohesion.
   Cohesion only attracts separating neighbours; compressed particles are not repelled
   because the Metaball surface already resolves their overlap. Age narrows and
   vertically stretches a particle's Falloff but never fades it out. Remove a particle
   only after it has moved fully below the artwork. If the 32-particle capacity is
   reached, compact the closest pair at their mass-weighted position and velocity,
   but retain the larger existing display mass instead of summing both radii.
   Initial-source energy attacks from zero over 360 ms; the active source skips this
   delay after an 8 px drag.
3. Rebuild the text mask each frame from the previous frame's per-glyph vertical
   offset and angle into a 1440 × 1800 unsigned-byte target. Keeping this target at
   the original 3× bake resolution prevents the visible underprint from being
   rasterized through the 480 × 600 geometry field. Measure each glyph's true
   half-width, calculate each home position from Canvas font advances and pair
   kerning, and inspect the estimated output slot plus two neighbours on each side
   during inverse deformation. Wide glyphs such as W therefore cannot be cropped
   by the lookup estimate. Source every candidate from its own 64 × 64 cell in a
   3×-resolution 8 × 8 glyph atlas instead of the combined text mask. Neighbouring
   glyph pixels therefore cannot be copied into the moving candidate or overlap
   the existing letter. Multiply the joined flowing
   falloff by that transformed glyph alpha at each current
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
7. Extract the 0.07 isosurface with 0.012 softness. This field is the complete
   geometry: there is no explicit outline, fixed-radius body, or glyph-shaped
   union hidden underneath the metaball silhouette.
8. Build color independently from silhouette geometry. Spread active glyph pixels
   within the text mask, use bounded jump flooding to retain the nearest active
   glyph coordinate, and measure the distance to it in the final pass. Keep the
   glyph-shaped color energy out to 3.2 px with strength 0.68, then transition to
   zero over a bounded 1 px edge. Because the energy has a finite distance bound,
   no Gaussian tail remains around the letters. Read this energy everywhere inside
   the metaball coverage, then map it through overlapping rose, pale-pink, and hot-color
   blends. Scale all HSV saturation by 0.72 and brightness by 0.96, then mix 12%
   warm cream into the result—slightly more at the hottest core—to prevent green,
   yellow, and magenta phases from becoming neon.
9. During a held drag, move only the full attached source particle with an eased
    emitter. Previously detached particles keep their physical state, so old streams
    keep falling while new packets start at the emitter. Supply mass
    continuously at one unit per 130 ms regardless of pointer distance. Crossing an
    8 px accumulated drag distance removes the initial source-energy delay. Do not
    resample the pointer path or emit small drag packets; the large source itself
    traverses the eased path. On release, detach the current source packet without
    injecting pointer momentum or another endpoint particle.
    Capture the active pointer and suppress browser selection/callout behavior for
    uninterrupted movement. After release, stop supply and let every existing
    particle leave through the lower off-screen sink.
10. Give all 64 character slots an independent four-value spring state: vertical
    offset, vertical velocity, angle, and angular velocity. Test a 9 × 9 grid over
    every transformed non-space glyph and only count samples where current glyph
    alpha overlaps the visible liquid surface.
    Overall contact pulls that rigid glyph toward a 10 px downward offset. The
    left-versus-right contact difference produces torque toward an angle of up to
    9 degrees. Separate translation and rotation springs return the glyph to its
    original pose with restrained inertia when contact ends.
11. Render the transformed glyph mask into its own target before building the
    next liquid field. Use that same target for final underprint compositing, so
    both the visible text and the Metaball source follow the current glyph pose.
    The feedback is delayed by one animation frame to avoid a pass reading its own
    in-progress output.
12. Fully occlude the charcoal underprint inside the colored coverage, add only
   sub-pixel dithering inside that coverage, and animate all three palette anchors
   over time.

Geometry and color are deliberately independent. Geometry is flowing-falloff-masked
stroke alpha → sampled metaball influence → smoothing → isocontour. Color uses a
nearest-active-glyph distance energy and clips it by the geometry coverage. The old nearest-stroke distance
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
  0.025 transition. The 0.05 cutoff selects active glyph seeds for the color distance
  search and does not add geometry.
- The palette completes a smooth cycle every eight seconds.
- Touch drip is the only interaction. The held pointer is a source and is not
  rendered as a separate head. Holding continuously emits physical liquid particles;
  releasing stops emission while every existing particle continues downward. Every
  frame, the joined moving falloff is multiplied by the glyph mask at its current
  position, and those newly activated pixels enter the existing metaball passes.
- The full source packet follows the held pointer through a 7.5 s⁻¹ exponential
  emitter. Each 130 ms
  of held time supplies one unit of mass, so total liquid depends on elapsed time
  rather than pointer distance. Only the first packet radius grows continuously from
  zero. Later handoffs replace a full source with another full source at the same
  position, while the outgoing packet starts falling. Hold the attached packet at
  age zero and exclude it from cohesion and capacity compaction so its upper boundary
  stays stable and dragging cannot pull detached packets sideways.
- Do not resample drag segments into small path particles. The single full source
  moves continuously along the eased emitter path, while only full-size timed
  handoffs remain behind and fall.
- Before the first drag movement, source energy attacks over 360 ms. Detached packets
  keep the energy present when they left the source, so energy cannot increase after
  the finger lifts. Once the pointer has moved 8 px, the active source skips the
  birth delay.
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
- `/common/touch-cursor.ts` renders a 54 px translucent contact-area ring, center
  dot, and short start/end ripple for every touch. It is a DOM-only recording aid:
  `pointer-events: none` keeps it out of pointer capture, liquid simulation, and
  Process View button input.
- `?qa` freezes the palette at the reference's pink/yellow phase.
- `?qa&qaX=0.37&qaY=0.52` also locks the pointer in normalized artwork space
  for deterministic reference comparisons.
- Add `&qaLabels=1` to render the exact background/text/effect class map without
  palette information.
- Add `&qaDripAge=1.6&qaDrip=1` to freeze a 1.6-second held stream. Add
  `&qaDripReleaseAge=0.9` to inspect that stream 0.9 seconds
  after emission stopped.
- Add `&qaHasDragged=1` to make post-drag particles skip the initial birth delay.
- `?og&qa...` hides Process View, adds the social-card title treatment, and enlarges
  the poster by 1.28× for deterministic 1200 × 630 Open Graph image capture.
- Press `g` to hide or reveal the tuning panel.

## Process View

- The four text buttons live in `index.html`; there is no separate process page.
  Switching views preserves the same pointer, particle, and glyph-spring state.
- The fixed bottom control moves through Solver, Contact, Contour, and the final
  composite. Final is the default view.
- The interaction target alpha channel stores raw `streamLight` before it is
  multiplied by the text mask. The regular pipeline does not consume this channel;
  Contact reads it directly and draws its four contour bands at low opacity behind
  the accepted text pixels.
- Contact reads `interactionTarget.r` and `surfaceSourceTarget.r`, drawing the
  accepted text pixels as a clean cobalt/cyan fill without threshold outlines or
  sample dots. The four raw Falloff contours remain behind it at low opacity.
- Solver reads the live particle positions, mass, age, velocity, source state,
  and cohesion range. It draws compact packet envelopes, velocity vectors, and
  the strongest 16 neighbour links over a pale trace of the raw Falloff.
- Contour draws the deformed text clearly and only the final `surfaceThreshold`
  outline. Adding the Final palette and surface fill is therefore the last step.
- Number keys 1–4 and the arrow keys mirror the bottom buttons.
- Process buttons switch on `pointerdown`, not delayed `click`. A second touch can
  therefore change Solver, Contact, Contour, or Final while the primary captured
  pointer keeps dragging and emitting liquid on the canvas.
- Solver keeps the same particles, cohesion links, packet envelopes, and velocity
  vectors, but reconstructs their strokes with derivative-based antialiasing so
  line quality stays stable across screen scales. Contact likewise combines the
  low-resolution activation energy with the 3× deformed text mask, keeping the
  accepted-pixel boundary aligned to the high-resolution glyph edge.

## Reference-space defaults

- Font: Helvetica Neue Light fallback stack, 43 px
- Horizontal layout: Canvas natural advances and pair kerning, plus 4 px letter spacing
- Line height: 42.2 px
- Light radius: 107 × 80 px above and 107 × 160 px below, with 0.55 horizontal
  taper toward the vertical edges
- Interaction and geometry field resolution: 480 × 600, half-float RGBA render targets
- Transformed visible-text mask: 1440 × 1800 unsigned-byte RGBA target, sampled
  directly by the final underprint pass
- Metaball input threshold / softness: 0.02 / 0.025
- Metaball sampling: 192 Fibonacci-spiral samples over 30 px
- Metaball falloff power / source gain / field gain: 3.2 / 0.55 / 2.2
- Metaball smoothing: sigma 1.8, five taps per axis
- Surface isovalue / edge softness: 0.07 / 0.012
- Glyph-shaped color energy: strength 0.68, 3.2 px radius, and 1 px bounded edge
- Palette saturation / brightness / warm pastel mix: 0.72 / 0.96 / 0.12
- Touch drip: up to 32 mass-carrying particles, with one mass unit supplied every 130 ms,
  78 px/s² gravity, 18 px/s initial downward speed, 0.65 viscous damping,
  0.9 cohesion over 92 px, 0.34 vertical stretch,
  0.72 shape variation, 0.3 lower-stream temporal flutter,
  0.44 mature width, 0.92 metaball input strength,
  1.45 s stream formation, 360 ms initial-source attack,
  0.08 particle winner blend, 8 px drag activation distance,
  zero-to-one first source, full-to-full source handoff, no drag-trail particles,
  no pointer-velocity transfer,
  off-screen-only removal, closest-pair envelope-preserving compaction, and
  7.5 s⁻¹ source follow rate
- Background-text spring: 64 character slots, 81 ink-and-surface overlap samples
  per visible glyph, 10 px target offset, translation stiffness 58, translation
  damping 12, 9 degree target rotation, rotation stiffness
  46, and rotation damping 10
