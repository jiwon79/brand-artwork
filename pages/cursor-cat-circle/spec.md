# Cursor Cat Circle

## Current phase

- This page is a simplified rebuild of Cursor Cat using only a circular pose path.
- The current asset set covers the upper semicircle: screen right → top → screen left.
- Two approved Seedance 2.0 quarter-circle clips are sampled into 61 WebP frames: 31 frames for right → top and 30 additional frames for top → left.
- Every runtime frame is normalized to a 576 × 1024 canvas and keeps the approved white negative space around the cat.

## Interaction

- The cursor is measured from the cat's face center and converted to a polar angle.
- Angles across the upper half of the screen map directly onto the 61-frame upper arc.
- Pointer positions below the face project to the closest available horizontal endpoint. The page does not synthesize missing lower poses.
- Frame changes use a short response curve so fast cursor movement still travels through the intervening poses instead of jumping between directions.
- Left and right arrow keys step through the same arc for keyboard testing.
- The horizontal, vertical, and center paths from the original Cursor Cat are not included.

## Remaining coverage

- A complete circle still requires left → bottom and bottom → right quarter-circle assets.
- Those future quarters should reuse the left and right endpoints and introduce one canonical bottom-facing frame.
