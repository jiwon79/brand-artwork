# Cat Cursor

## Interaction

- The supplied 9:16 cat video is decomposed into 96 WebP frames at 24 fps.
- The pointer angle around the cat's face maps to the circular frame sequence.
- Cardinal mapping is frame 1 right, frame 25 up, frame 49 left, and frame 73 down.
- Circular interpolation chooses the shortest path across the frame 96 → 1 boundary.
- Pointer movement drives the desktop interaction; pointer dragging provides the same behavior on touch devices.

## Loading

- All frames preload before interaction begins.
- The poster remains hidden behind the loading state until the sequence is ready.
- The page then swaps predecoded frame URLs without seeking a video element.
