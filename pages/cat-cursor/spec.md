# Cat Cursor

## Interaction

- GPT Image provides only the initial cat identity reference. Every visible pose is selected from Seedance-generated video frames.
- The 96-frame circle combines a Seedance 2.5 right-to-top-to-left clip with a Seedance 2.0 first/last-frame left-to-bottom-to-right clip.
- Seventy-seven keyframes fill the cross: one center, twenty-three intermediates on each horizontal arm, and fifteen intermediates on each vertical arm.
- The horizontal path comes from one Seedance left-to-center-to-right clip. The center is extracted from that clip, while the four cardinal endpoints are owned by the circle so joins use one shared image.
- The upward path uses the clean centered portion of a Seedance center-to-top clip. The downward path reuses the clean descent from the lower semicircle after three neutral center-adjacent points; the failed direct upward-moving take is not used.
- All runtime frames are independently encoded at 405 × 720, preserving the generated 9:16 composition while reducing decode memory on tablets.
- Each of the 173 source images owns a normalized pointer position: 96 around the circle and 77 along the central cross.
- Pointer coordinates are normalized from the cat's face to the four edges of the stage. The image whose pointer has the smallest two-dimensional distance from the cursor is displayed.
- Debug mode displays every image pointer and highlights the active one. Use the on-screen `Points` button, press `D`, or append `?debug=1` to the URL to enable it.
- Debug pointer screen positions are recalculated from normalized coordinates when the viewport changes size.
- There is no runtime interpolation or blending, and only one photographic frame is visible at a time.
- Runtime images are decoded before interaction, retained in memory, and changed at most once per animation frame.
- Cardinal mapping is frame 1 right, frame 25 up, frame 49 left, and frame 73 down.
- Pointer movement drives the desktop interaction; pointer dragging provides the same behavior on touch devices.

## Loading

- All 173 frames preload and decode before interaction begins.
- The poster remains hidden behind the loading state until the sequence is ready.
- The page then swaps predecoded frame URLs without seeking a video element.
