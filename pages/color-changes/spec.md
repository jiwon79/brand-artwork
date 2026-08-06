# Color Changes — implementation spec

## Reference

- Source: `assets/reference.mp4`
- 480 × 600, 4:5, 25 fps, 19.88 seconds
- Static nine-line typography with a colored local goo response

## Rendering model

1. Bake the nine text lines into a static 1440 × 1800 alpha texture, preserving
   the 480 × 600 artwork coordinate system at 3× sampling density.
2. Multiply the text alpha by a soft radial light centered at the cursor.
3. Retain the activated strokes briefly in a half-float temporal buffer so a
   letter stays excited for a moment after the light begins moving away.
4. Blur the retained strokes with horizontal and vertical Gaussian passes.
5. Convert the half-float density into an antialiased, thresholded alpha field.
6. Map low, middle, and peak density to pink, yellow, and pink-hotspot colors.
7. Add sub-pixel dithering only inside the colored field to prevent banding.
8. Animate the complete palette over time.
9. Composite the opaque goo above the unchanged charcoal text.

The light is applied before blur. This preserves the reference's small isolated
glyph fragments around the light boundary instead of clipping a finished blob
with an obvious circle.

## Interaction

- Pointer and touch position control the target of the light center.
- The light uses eased tracking plus a 360 artwork-pixel-per-second speed cap,
  creating the delayed motion visible in the reference instead of snapping.
- Excited strokes persist for 0.22 seconds and then cross a tight density
  threshold, producing a short hold followed by a comparatively sudden cutoff.
- The last pointer location persists after leaving the artwork.
- The palette completes a smooth cycle every eight seconds.
- `?qa` freezes the palette at the reference's pink/yellow phase.
- Press `g` to reveal the hidden tuning panel.

## Reference-space defaults

- Font: Helvetica Neue Light fallback stack, 43 px
- Character advance: 31.8 px
- Line height: 42.2 px
- Light radius: 175 × 205 px, with horizontal taper toward the vertical edges
- Field resolution: 1440 × 1800, half-float single-channel render targets
- Blur sigma: 8.5 px
- Blur sample step: 1.4 px
- Density threshold: 0.047
- Pointer maximum speed: 360 reference px/s
- Temporal persistence: 0.22 s
