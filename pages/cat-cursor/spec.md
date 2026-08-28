# Cat Cursor

## Interaction

- GPT Image provides the center and screen-right identity references. The screen-left endpoint is a deterministic horizontal mirror of the right reference so scale, crop, and lighting remain identical.
- The current artwork contains one center image, two 49-frame semicircular arcs, and two 49-frame horizontal paths generated with LTX 2.5 First/Last Frame.
- The upper arc follows screen coordinates `RIGHT → TOP → LEFT`; the lower arc follows `LEFT → BOTTOM → RIGHT`.
- The horizontal paths follow `CENTER → RIGHT` and `CENTER → LEFT`. Their canonical center and side endpoints are shared with the existing center and arc pointers.
- Each LTX source contains 97 native frames. Runtime assets use every second interior source frame without optical-flow interpolation, blending, or synthesized in-between frames.
- Interior runtime images are independently encoded at 405 × 720, preserving the generated 9:16 composition while reducing decode memory on tablets. Their high-luminance range is raised by at most two Y levels to match the canonical background without shifting the orange fur's chroma. The seven frames beside each left/right endpoint also use a direction-specific luminance ramp that converges on the canonical cat exposure at the seam. The right and left endpoints load their canonical PNG references directly, so LTX reconstruction and lossy WebP encoding cannot alter their pixels.
- Each visible pose owns a normalized pointer position: one at the center, 49 along the upper semicircle, 47 lower-arc intermediates, and 47 intermediates on each horizontal path. Shared center/left/right endpoints are represented only once, for 191 pointer-owned images in total.
- Pointer coordinates are normalized from the cat's face to the four edges of the stage. The image whose pointer has the smallest two-dimensional distance from the cursor is displayed.
- Debug mode displays every image pointer and highlights the active one. Use the on-screen `Points` button, press `D`, or append `?debug=1` to the URL to enable it.
- Debug pointer screen positions are recalculated from normalized coordinates when the viewport changes size.
- There is no runtime interpolation or blending, and only one photographic frame is visible at a time.
- Runtime images are decoded before interaction, retained in memory, and changed at most once per animation frame.
- Cardinal mapping is upper frame 1 right, upper frame 25 up, upper frame 49 left, and lower frame 25 down. Horizontal frame 1 is the shared center; frame 49 is the shared left or right endpoint.
- Pointer movement drives the desktop interaction; pointer dragging provides the same behavior on touch devices.

## Loading

- All 191 pointer-owned images preload and decode before interaction begins.
- The poster remains hidden behind the loading state until the sequence is ready.
- The page then swaps predecoded frame URLs without seeking a video element.

## LTX generation recipe

- Use the approved screen-right reference and its deterministic horizontal mirror as the two fixed endpoint images.
- Generate each semicircle and horizontal path separately with LTX 2.5 First/Last Frame at 576 × 1024, 4 seconds, and 24 fps, with prompt enhancement disabled.
- Upper generation uses `RIGHT → TOP → LEFT`; lower generation reverses the endpoints and uses `LEFT → BOTTOM → RIGHT`.
- Horizontal generation uses independent `CENTER → RIGHT` and `CENTER → LEFT` runs so both paths begin from the same canonical center.
- Require a flat pure-white background, fixed torso/camera/framing, continuous head-and-eye motion, and the entire face inside the 9:16 frame.
- Inspect a contact sheet before integration. Prefer one acceptable take over repeated attempts for marginal improvements.
- Extract native frames 1, 3, 5, …, 97 to obtain 49 candidate poses. Do not use FFmpeg interpolation, optical flow, crossfades, or blended frames.
- Encode interior runtime frames as WebP at 405 × 720. Replace frames 1 and 49 with the canonical right and left PNG files, then share those exact endpoint assets between the two arcs.
