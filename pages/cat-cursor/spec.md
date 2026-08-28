# Cat Cursor

## Interaction

- GPT Image provides the center and screen-right identity references. The screen-left endpoint is a deterministic horizontal mirror of the right reference so scale, crop, and lighting remain identical.
- The current test contains one center image and a 49-frame upper arc generated with LTX 2.5 First/Last Frame.
- The upper arc follows screen coordinates `RIGHT → TOP → LEFT`. The lower arc has intentionally not been generated yet.
- The LTX source contains 97 native frames. Runtime uses every second source frame, including both endpoints, without optical-flow interpolation, blending, or synthesized in-between frames.
- All runtime images are independently encoded at 405 × 720, preserving the generated 9:16 composition while reducing decode memory on tablets.
- Each of the 50 visible images owns a normalized pointer position: one at the center and 49 along the upper semicircle.
- Pointer coordinates are normalized from the cat's face to the four edges of the stage. The image whose pointer has the smallest two-dimensional distance from the cursor is displayed.
- Debug mode displays every image pointer and highlights the active one. Use the on-screen `Points` button, press `D`, or append `?debug=1` to the URL to enable it.
- Debug pointer screen positions are recalculated from normalized coordinates when the viewport changes size.
- There is no runtime interpolation or blending, and only one photographic frame is visible at a time.
- Runtime images are decoded before interaction, retained in memory, and changed at most once per animation frame.
- Upper-arc cardinal mapping is frame 1 right, frame 25 up, and frame 49 left.
- Pointer movement drives the desktop interaction; pointer dragging provides the same behavior on touch devices.

## Loading

- All 50 images preload and decode before interaction begins.
- The poster remains hidden behind the loading state until the sequence is ready.
- The page then swaps predecoded frame URLs without seeking a video element.
