# Cat Cursor

## Interaction

- The original cat video is decomposed into a 96-frame circular WebP sequence at 24 fps.
- Thirty-seven keyframes fill the missing cross: one shared center, fifteen center-to-right intermediates, and seven intermediates for each of the other three cardinal directions.
- The fifteen center-to-right poses are generated at 6.25% intervals with FILM using a 16× interpolation multiplier. The center and original right cardinal frame remain unchanged, so only the fifteen model-generated middle frames are added to the path.
- The other three axes use standalone generated poses. All cross-path intermediates use the original 400 × 736 frame size before runtime.
- Each of the 133 source images owns a normalized pointer position: 96 around the circle and 37 along the central cross.
- Pointer coordinates are normalized from the cat's face to the four edges of the stage. The image whose pointer has the smallest two-dimensional distance from the cursor is displayed.
- Debug mode displays every image pointer and highlights the active one. Use the on-screen `Points` button, press `D`, or append `?debug=1` to the URL to enable it.
- Debug pointer screen positions are recalculated from normalized coordinates when the viewport changes size.
- There is no runtime interpolation or blending, and only one photographic frame is visible at a time.
- Runtime images are decoded before interaction, retained in memory, and changed at most once per animation frame.
- Cardinal mapping is frame 1 right, frame 25 up, frame 49 left, and frame 73 down.
- Pointer movement drives the desktop interaction; pointer dragging provides the same behavior on touch devices.

## Loading

- All 133 frames preload and decode before interaction begins.
- The poster remains hidden behind the loading state until the sequence is ready.
- The page then swaps predecoded frame URLs without seeking a video element.
