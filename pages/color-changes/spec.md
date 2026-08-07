# Color Changes — implementation spec

## Reference

- Source: `assets/reference.mp4`
- 480 × 600, 4:5, 25 fps, 19.88 seconds
- Static nine-line typography with a colored local goo response

## Rendering model

1. Bake the nine text lines into a static 1440 × 1800 alpha texture, preserving
   the 480 × 600 artwork coordinate system at 3× sampling density.
2. Multiply the text alpha by a soft radial light centered at the cursor.
3. Retain activation only on the original glyph pixels in a half-float temporal
   buffer. Attack and release use separate exponential rates; the buffer is no
   longer a blurred image-space maximum.
4. Propagate activation only through connected pixels of the same glyph. Eight
   two-pixel max-propagation passes include axial, diagonal, and 2:1 directions.
   A lit `Y` stem therefore reaches both arms, while activation cannot cross the
   white gap to another letter or line. This is geodesic propagation on the text
   mask, not an image-space blur.
5. Threshold the stroke-connected pixels into seeds and run jump flooding down
   to one-pixel steps. Every artwork pixel now stores its nearest active glyph
   coordinate and transported activation.
6. Build a deliberately narrow stroke body from exact nearest-glyph distance.
   Weak seeds start at 2.8 px and strongly lit seeds reach 6 px; a 1.5 strength
   exponent keeps the broad region concentrated near the actual light instead
   of turning every touched character into an equally thick disc.
7. Render that body into a separate surface field, blur it by 5.8 px, and extract
   the 0.36 isosurface with 0.035 softness. A secondary 0.4–1.2 px continuity
   core follows the transported stroke and is unioned with the relaxed surface.
   The surface creates rounded pools; the narrow core prevents weak `Y` arms and
   stems from being erased. There is no separately colored outline or rim pass.
8. Build color in a separate field. A nine-pixel Gaussian filter blurs both
   `activation × glyph` and `glyph`; dividing the two produces a normalized
   energy value that stays smooth without making intersections brighter merely
   because more stroke pixels overlap the kernel.
9. Drive the color core from that low-frequency density field, retaining only a
   4% fine nearest-stroke carrier. Map energy through overlapping rose, pale-pink,
   and hot-color RGB blends instead of a single HSV ramp. The boundary color is
   therefore the low-energy end of the same continuous field, not a fixed stroke.
10. Fully occlude the charcoal underprint inside the colored coverage, add only
   sub-pixel dithering inside that coverage, and animate all three palette anchors
   over time.

Geometry and color are deliberately independent. Geometry is connected-stroke
propagation followed by a nearest-stroke distance field and a short
surface-relaxation pass; color uses a broader normalized energy field. This is
the key difference from the former
thresholded-glyph-blur implementation, which produced a round central blob at
`Y` intersections, and from the constant-radius distance pass, which produced a
row of equally sized circular caps.

## Silhouette-only validation

The comparison deliberately discards palette details and maps the image to three
classes: background = 0, unaffected text = 1, effect silhouette = 2.

![Reference and implementation three-class silhouettes](qa/silhouette-semantic-comparison-final.png)

| Measurement | Reference | Previous | Final |
| --- | ---: | ---: | ---: |
| Effect pixels | 25,180 | 30,553 | 24,824 |
| Effect bounding box | 215 × 256 | 222 × 242 | 222 × 249 |
| Box occupancy | 0.457 | 0.569 | 0.449 |

The final visible effect area is 1.41% below the reference, versus 21.34% above
it previously. Its width is 3.26% wider and height 2.73% shorter than the
reference, while the actual filled area inside that extent is 1.84% lower. This
corrects the former wide, blunt silhouette. The focused comparison confirms that
the `Y` arms and stem belong to one connected effect shape instead of being
replaced by a round center hotspot.

The reproducible measurements and label-map generator are stored in
`qa/silhouette-metrics-final.json` and `qa/analyze-silhouette.mjs`.

## Interaction

- Pointer and touch position control the target of the light center.
- The light uses eased tracking plus a 300 artwork-pixel-per-second speed cap,
  creating the delayed motion visible in the reference instead of snapping.
- Glyph activation attacks over 55 ms and releases over 340 ms. A seed remains
  geometrically present until it crosses the 0.05 cutoff, producing a visible
  hold followed by the reference's comparatively sudden local disappearance.
- The last pointer location persists after leaving the artwork.
- The palette completes a smooth cycle every eight seconds.
- `?qa` freezes the palette at the reference's pink/yellow phase.
- `?qa&qaX=0.39&qaY=0.458` also locks the pointer in normalized artwork space
  for deterministic reference comparisons.
- Add `&qaLabels=1` to render the exact background/text/effect class map without
  palette information.
- Press `g` to reveal the hidden tuning panel.

## Reference-space defaults

- Font: Helvetica Neue Light fallback stack, 43 px
- Character advance: 31.8 px
- Line height: 42.2 px
- Light radius: 145 × 150 px above and 145 × 165 px below, with horizontal
  taper toward the vertical edges
- Geometry/color field resolution: 480 × 600, half-float RGBA render targets
- Nearest-stroke solver: local jump flooding from 16 px to 1 px plus one cleanup
  pass (the complete sequence propagates farther than the visible body)
- Stroke-constrained activation spread: eight passes, two-pixel/2:1 neighborhood
- Activation-weighted stroke radius: 2.8–6 px, strength exponent 1.5
- Stroke continuity core: 0.4–1.2 px, strength exponent 0.25
- Surface-tension blur: sigma 5.8 px, 13 taps per side
- Surface isovalue / edge softness: 0.36 / 0.035
- Normalized color/glyph-density blur sigma: 9 px, 20 taps per side
- Fine nearest-stroke color carrier: 4%
- Pointer maximum speed: 300 reference px/s
- Activation attack/release: 55 ms / 340 ms
