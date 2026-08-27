# Cat Cursor

## Interaction

- The original cat video is decomposed into a 96-frame circular WebP sequence at 24 fps.
- Twenty-nine generated keyframes fill the missing cross: one shared center plus seven intermediate poses between center and each original cardinal frame.
- Each intermediate pose is generated as a standalone image, then uniformly resized and repositioned to match the midpoint framing of its neighboring keyframes.
- Each of the 125 source images owns a normalized pointer position: 96 around the circle and 29 along the central cross.
- Pointer coordinates are normalized from the cat's face to the four edges of the stage. The image whose pointer has the smallest two-dimensional distance from the cursor is displayed.
- Debug mode displays every image pointer and highlights the active one. Use the on-screen `Points` button, press `D`, or append `?debug=1` to the URL to enable it.
- Debug pointer screen positions are recalculated from normalized coordinates when the viewport changes size.
- There are no motion-interpolated or blended images, and only one photographic frame is visible at a time.
- Runtime images are decoded before interaction, retained in memory, and changed at most once per animation frame.
- Cardinal mapping is frame 1 right, frame 25 up, frame 49 left, and frame 73 down.
- Pointer movement drives the desktop interaction; pointer dragging provides the same behavior on touch devices.

## Loading

- All 125 frames preload and decode before interaction begins.
- The poster remains hidden behind the loading state until the sequence is ready.
- The page then swaps predecoded frame URLs without seeking a video element.
