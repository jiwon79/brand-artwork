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
   strokes meet. Derive the dark rim by eroding the complete union silhouette;
   this avoids outlining every character separately where neighboring expansions
   overlap.
6. Build color in a separate field. A small Gaussian filter blurs both
   `activation × glyph` and `glyph`; dividing the two produces a normalized
   energy value that stays smooth without making intersections brighter merely
   because more stroke pixels overlap the kernel.
7. Drive the color core mostly from the six-pixel Gaussian glyph-density field,
   with only a 16% fine nearest-stroke carrier. The low-frequency carrier keeps
   the `Y` response directional but merges adjacent character details, so the
   colored area reads as light/goo rather than as a thick display font.
8. Fully occlude the charcoal underprint inside the colored coverage, add only
   sub-pixel dithering inside that coverage, and animate the palette over time.

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
  pass (the complete sequence propagates farther than the visible body and rim)
- Stroke expansion radius: 13.4 px
- Rim width: 3.6 px with derivative-based antialiasing
- Normalized color/glyph-density blur sigma: 6 px
- Pointer maximum speed: 300 reference px/s
- Activation attack/release: 55 ms / 340 ms
