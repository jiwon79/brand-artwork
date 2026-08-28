# Cat Cursor

## Interaction

- GPT Image provides the center and screen-right identity references. The screen-left endpoint is a deterministic horizontal mirror of the right reference so scale, crop, and lighting remain identical.
- The current artwork contains one center image and two 49-frame arcs generated with LTX 2.5 First/Last Frame.
- The upper arc follows screen coordinates `RIGHT → TOP → LEFT`; the lower arc follows `LEFT → BOTTOM → RIGHT`.
- Each LTX source contains 97 native frames. Runtime assets use every second interior source frame without optical-flow interpolation, blending, or synthesized in-between frames.
- Interior runtime images are independently encoded at 405 × 720, preserving the generated 9:16 composition while reducing decode memory on tablets. The right and left endpoints load their canonical PNG references directly, so LTX reconstruction and lossy WebP encoding cannot alter their pixels.
- Each visible pose owns a normalized pointer position: one at the center, 49 along the upper semicircle, and 47 lower-arc intermediates. The lower arc reuses the upper arc's exact left and right endpoint images so the circle has no duplicate seam pose.
- Pointer coordinates are normalized from the cat's face to the four edges of the stage. The image whose pointer has the smallest two-dimensional distance from the cursor is displayed.
- Debug mode displays every image pointer and highlights the active one. Use the on-screen `Points` button, press `D`, or append `?debug=1` to the URL to enable it.
- Debug pointer screen positions are recalculated from normalized coordinates when the viewport changes size.
- There is no runtime interpolation or blending, and only one photographic frame is visible at a time.
- Runtime images are decoded before interaction, retained in memory, and changed at most once per animation frame.
- Cardinal mapping is upper frame 1 right, upper frame 25 up, upper frame 49 left, and lower frame 25 down.
- Pointer movement drives the desktop interaction; pointer dragging provides the same behavior on touch devices.

## Loading

- All 97 pointer-owned images preload and decode before interaction begins.
- The poster remains hidden behind the loading state until the sequence is ready.
- The page then swaps predecoded frame URLs without seeking a video element.

## LTX generation recipe

- Use the approved screen-right reference and its deterministic horizontal mirror as the two fixed endpoint images.
- Generate each semicircle separately with LTX 2.5 First/Last Frame at 576 × 1024, 4 seconds, and 24 fps, with prompt enhancement disabled.
- Upper generation uses `RIGHT → TOP → LEFT`; lower generation reverses the endpoints and uses `LEFT → BOTTOM → RIGHT`.
- Require a flat pure-white background, fixed torso/camera/framing, continuous head-and-eye motion, and the entire face inside the 9:16 frame.
- Inspect a contact sheet before integration. Prefer one acceptable take over repeated attempts for marginal improvements.
- Extract native frames 1, 3, 5, …, 97 to obtain 49 candidate poses. Do not use FFmpeg interpolation, optical flow, crossfades, or blended frames.
- Encode interior runtime frames as WebP at 405 × 720. Replace frames 1 and 49 with the canonical right and left PNG files, then share those exact endpoint assets between the two arcs.
