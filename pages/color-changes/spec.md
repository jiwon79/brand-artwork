# Color Changes — implementation spec

## Reference

- Source: `assets/reference.mp4`
- 480 × 600, 4:5, 25 fps, 19.88 seconds
- Static nine-line typography with a colored local goo response

## Rendering model

1. Bake the nine text lines into a static 480 × 600 alpha texture.
2. Multiply the text alpha by a soft radial light centered at the cursor.
3. Blur the activated strokes with horizontal and vertical Gaussian passes.
4. Convert the blurred density into a contrasted alpha field.
5. Map low, middle, and peak density to pink, yellow, and pink-hotspot colors.
6. Animate the complete palette over time.
7. Composite the opaque goo above the unchanged charcoal text.

The light is applied before blur. This preserves the reference's small isolated
glyph fragments around the light boundary instead of clipping a finished blob
with an obvious circle.

## Interaction

- Pointer and touch position control the light center.
- The light eases toward the pointer to avoid noisy movement.
- The last pointer location persists after leaving the artwork.
- The palette completes a smooth cycle every eight seconds.
- `?qa` freezes the palette at the reference's pink/yellow phase.
- Press `g` to reveal the hidden tuning panel.

## Reference-space defaults

- Font: Helvetica Neue Light fallback stack, 43 px
- Character advance: 31.8 px
- Line height: 42.2 px
- Light radius: 175 × 205 px, with horizontal taper toward the vertical edges
- Blur sigma: 8.5 px
- Blur sample step: 1.4 px
- Density threshold: 0.047
