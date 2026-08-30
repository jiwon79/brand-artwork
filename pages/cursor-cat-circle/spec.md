# Cursor Cat Circle

## Current phase

- This page is a simplified rebuild of Cursor Cat using only a circular pose path.
- The current asset set covers the upper semicircle: screen right → top → screen left.
- Two approved Seedance 2.0 quarter-circle clips are pose-calibrated into 61 WebP frames: 31 frames for right → top and 30 additional frames for top → left.
- Every runtime frame is normalized to a 576 × 1024 canvas and keeps the approved white negative space around the cat.
- Sampling follows equal gaze-angle steps rather than equal video-time steps, removing the generated holds around the top and left poses.
- The second quarter receives a 0.7% bottom-anchored display correction so its subject scale meets the canonical top frame without a visible seam.

## Interaction

- The cursor angle is measured from an eye origin that travels with the head from the right pose through the top pose to the left pose.
- Each cursor position is matched against the calibrated gaze ray of all 61 frames; the closest ray becomes the target pose.
- Pointer positions below the face project to the closest available horizontal endpoint. The page does not synthesize missing lower poses.
- Frame changes use a short response curve so fast cursor movement still travels through the intervening poses instead of jumping between directions.
- Left and right arrow keys step through the same arc for keyboard testing.
- The horizontal, vertical, and center paths from the original Cursor Cat are not included.

## Remaining coverage

- A complete circle still requires left → bottom and bottom → right quarter-circle assets.
- Those future quarters should reuse the left and right endpoints and introduce one canonical bottom-facing frame.
