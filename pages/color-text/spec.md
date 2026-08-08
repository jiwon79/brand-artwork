# Color Text — implementation spec

## Reference

- Source: `assets/reference.mp4`
- 480 × 600, 4:5, 25 fps, 19.88 seconds
- Static nine-line typography with a colored local goo response

## Rendering model

1. Bake the nine text lines into a static 1440 × 1800 alpha texture, preserving
   the 480 × 600 artwork coordinate system at 3× sampling density.
2. Multiply the text alpha by an asymmetric elliptical falloff centered at the
   delayed cursor. This is the Cavalry-style “reveal the typography stroke using
   a falloff” stage described by the artist.
3. Retain activation only on the original glyph pixels in a half-float temporal
   buffer. Attack and release use separate exponential rates; the buffer is no
   longer a blurred image-space maximum.
4. Detect the retained alpha with a low 0.02 threshold and 0.025 transition.
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
   toward its glyph centroid. Multiply this field by the same cursor falloff and
   retain it in the temporal buffer's blue channel.
9. Mix 20% of the remembered glyph-pixel activation back into the statistical
   ellipse field so the peaks inherit subtle character-dependent deformation
   without becoming readable letters. Smooth the result with a separable
   Gaussian filter (horizontal sigma 2.5, vertical ratio 1.1). Read this field
   everywhere inside the metaball coverage—there is no nearest-seed validity
   gate—then map it through overlapping rose, pale-pink, and hot-color blends.
10. Route the remembered glyph and color fields through one mutually exclusive
    interaction mode. `viscous` writes a directional 96 px wake opposite cursor
    velocity into a separate alpha field, retains it for about 0.2 seconds, and
    composites three antialiased necks plus bead seeds after the broad metaball
    pass so they stay thin. `thermal` builds dwell over 0.62 seconds below
    54 px/s, then locally stretches the field vertically before metaball
    accumulation and amplifies its color centers. `classic` passes the remembered
    field through unchanged. The two extensions never mix.
11. Fully occlude the charcoal underprint inside the colored coverage, add only
   sub-pixel dithering inside that coverage, and animate all three palette anchors
   over time.

Geometry and color are deliberately independent. Geometry is falloff-masked
stroke alpha → sampled metaball influence → smoothing → isocontour. Color is a
temporally remembered field of glyph-statistics-driven vertical peaks, clipped
by that coverage. The old nearest-stroke distance construction could only ask which
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

- Pointer and touch position control the target of the light center.
- The light uses eased tracking plus a 300 artwork-pixel-per-second speed cap,
  creating the delayed motion visible in the reference instead of snapping.
- Glyph and color-center activation attack over 55 ms and release over 340 ms. Metaball source
  alpha is suppressed below the 0.02 detection threshold (with a 0.025
  transition), producing a visible hold followed by the reference's
  comparatively sudden local disappearance. The 0.05 cutoff applies only to the
  optional nearest-stroke continuity core.
- The last pointer location persists after leaving the artwork.
- The palette completes a smooth cycle every eight seconds.
- `interaction=viscous` is the default. Fast motion creates an elastic wake in
  the opposite direction; key `1` selects it.
- `interaction=thermal` grows taller, hotter color centers after a local dwell;
  key `2` selects it.
- `interaction=classic` preserves the approved reference recreation without an
  extension. Only one interaction mode is evaluated per frame.
- `?qa` freezes the palette at the reference's pink/yellow phase.
- `?qa&qaX=0.37&qaY=0.52` also locks the pointer in normalized artwork space
  for deterministic reference comparisons.
- Add `&qaLabels=1` to render the exact background/text/effect class map without
  palette information.
- Add `&qaInteractionSpeed=1&qaVelocityX=1&qaVelocityY=0` to freeze a viscous
  wake, or `&qaDwell=1` to freeze a fully heated thermal bloom.
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
- Pointer maximum speed: 300 reference px/s
- Activation attack/release: 55 ms / 340 ms
- Viscous wake: 96 px length, 2.6 px source width, 0.65 strength, 0.2 s release,
  0.46 breakup
- Thermal bloom: 0.9 vertical stretch, 0.82 energy, 72 × 110 px local radius,
  0.62 s heat buildup, 0.2 s cooling, 54 px/s dwell threshold
