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
4. Threshold the retained glyph pixels into seeds and run jump flooding down to
   one-pixel steps. Every artwork pixel now stores its nearest active glyph
   coordinate.
5. Build the visible silhouette from the exact distance to that nearest glyph.
   The body expands each stroke by a nearly constant width, including through
   `Y` junctions, instead of accumulating a Gaussian hotspot where multiple
   strokes meet. Coverage ends with a derivative-aware 2.35 px transition; there
   is no separate outline or rim pass.
6. Build color in a separate field. A nine-pixel Gaussian filter blurs both
   `activation × glyph` and `glyph`; dividing the two produces a normalized
   energy value that stays smooth without making intersections brighter merely
   because more stroke pixels overlap the kernel.
7. Drive the color core from that low-frequency density field, retaining only a
   4% fine nearest-stroke carrier. Map energy through overlapping rose, pale-pink,
   and hot-color RGB blends instead of a single HSV ramp. The boundary color is
   therefore the low-energy end of the same continuous field, not a fixed stroke.
8. Fully occlude the charcoal underprint inside the colored coverage, add only
   sub-pixel dithering inside that coverage, and animate all three palette anchors
   over time.

Geometry and color are deliberately independent. Geometry is a nearest-stroke
distance field; Gaussian filtering is used only to smooth the color carried by
those strokes. This is the key difference from the former thresholded-blur
implementation, which produced a round central blob at `Y` intersections.

## Interaction

- Pointer and touch position control the target of the light center.
- The light uses eased tracking plus a 300 artwork-pixel-per-second speed cap,
  creating the delayed motion visible in the reference instead of snapping.
- Glyph activation attacks over 55 ms and releases over 340 ms. A seed remains
  geometrically present until it crosses the 0.085 cutoff, producing a visible
  hold followed by the reference's comparatively sudden local disappearance.
- The last pointer location persists after leaving the artwork.
- The palette completes a smooth cycle every eight seconds.
- `?qa` freezes the palette at the reference's pink/yellow phase.
- `?qa&qaX=0.37&qaY=0.458` also locks the pointer in normalized artwork space
  for deterministic reference comparisons.
- Press `g` to reveal the hidden tuning panel.

## Reference-space defaults

- Font: Helvetica Neue Light fallback stack, 43 px
- Character advance: 31.8 px
- Line height: 42.2 px
- Light radius: 175 × 155 px above and 175 × 180 px below, with horizontal
  taper toward the vertical edges
- Geometry/color field resolution: 480 × 600, half-float RGBA render targets
- Nearest-stroke solver: local jump flooding from 16 px to 1 px plus one cleanup
  pass (the complete sequence propagates farther than the visible body)
- Stroke expansion radius: 13.4 px
- Silhouette antialiasing: minimum 2.35 px with derivative scaling
- Normalized color/glyph-density blur sigma: 9 px, 20 taps per side
- Fine nearest-stroke color carrier: 4%
- Pointer maximum speed: 300 reference px/s
- Activation attack/release: 55 ms / 340 ms
