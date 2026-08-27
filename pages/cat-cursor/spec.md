# Cat Cursor

## Interaction

- The original cat video is decomposed into a 96-frame circular WebP sequence at 24 fps.
- Thirteen generated keyframes fill the missing cross: one shared center plus three intermediate poses between center and each original cardinal frame.
- Motion-compensated interpolation expands those keyframes into a 33-frame horizontal sequence and a 33-frame vertical sequence.
- Pointer coordinates are normalized from the cat's face to the four edges of the stage.
- The nearest of the circle, horizontal axis, and vertical axis selects the active path. Hysteresis keeps the current path near equal-distance boundaries.
- The generated axes share the exact center pose, while their endpoints are derived from the original cardinal frames. Only one photographic frame is visible at a time, so cats never ghost over each other.
- The pointer angle around the cat's face maps to the circular frame sequence.
- Cardinal mapping is frame 1 right, frame 25 up, frame 49 left, and frame 73 down.
- Normalized x maps right-to-left across 33 horizontal frames, while normalized y maps top-to-bottom across 33 vertical frames.
- Smoothed x/y coordinates drive every path, including the circular frame 96 → 1 boundary.
- Pointer movement drives the desktop interaction; pointer dragging provides the same behavior on touch devices.

## Loading

- All 162 frames preload before interaction begins.
- The poster remains hidden behind the loading state until the sequence is ready.
- The page then swaps predecoded frame URLs without seeking a video element.
