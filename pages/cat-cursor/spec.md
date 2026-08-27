# Cat Cursor

## Interaction

- The supplied cat videos are decomposed into three WebP frame sequences at 24 fps: a 96-frame circle, a 73-frame horizontal sweep, and a 73-frame vertical sweep.
- Pointer coordinates are normalized from the cat's face to the four edges of the stage.
- The nearest of the circular, horizontal, and vertical gaze paths selects the active sequence. A hysteresis margin prevents rapid switching at path boundaries.
- Two stacked image layers crossfade for 200 ms whenever the active sequence changes, so different source videos never meet in a hard cut.
- The pointer angle around the cat's face maps to the circular frame sequence.
- Cardinal mapping is frame 1 right, frame 25 up, frame 49 left, and frame 73 down.
- Normalized x maps right-to-left across the horizontal sequence, while normalized y maps top-to-bottom across the vertical sequence.
- Smoothed x/y coordinates drive every sequence continuously, including the circular frame 96 → 1 boundary.
- Pointer movement drives the desktop interaction; pointer dragging provides the same behavior on touch devices.

## Loading

- All 242 frames preload before interaction begins.
- The poster remains hidden behind the loading state until the sequence is ready.
- The page then swaps predecoded frame URLs without seeking a video element.
