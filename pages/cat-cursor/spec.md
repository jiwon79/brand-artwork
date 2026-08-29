# Cat Cursor

## Interaction

- GPT Image provides three canonical references: center, screen-right, and screen-left. The left reference is an identity-preserving edit, never a horizontal flip, so asymmetric facial spots and stripes stay on their anatomical sides.
- The active artwork contains one center image, two 49-pose semicircular arcs, and two 24-pose horizontal paths.
- The upper arc follows screen coordinates `RIGHT → TOP → LEFT`; the lower arc follows `LEFT → BOTTOM → RIGHT`.
- The horizontal paths independently follow `CENTER → RIGHT` and `CENTER → LEFT`, so both share the same canonical center without mirroring either side.
- Each LTX source contains 97 native frames. Runtime assets select frames 1, 3, 5, …, 97, producing 49 poses without optical-flow interpolation, crossfades, or synthesized in-between frames.
- Only the 47 interior poses of each arc are WebP files. The two arcs share the exact canonical right and left PNG endpoints.
- Interior frames are encoded at 405 × 720. Their high-luminance range is normalized, and seven poses near each endpoint receive a short direction-specific luminance ramp so exposure converges at the seam.
- Each visible pose owns a normalized pointer position: one center pointer, 49 upper-arc pointers, 47 lower-arc intermediates, and 22 intermediates on each horizontal path. Shared center/left/right endpoints appear only once, for 141 pointer-owned images in total.
- Pointer coordinates are normalized from the cat's face to the four edges of the stage. The image whose pointer has the smallest two-dimensional distance from the cursor is displayed.
- Debug mode displays every image pointer and highlights the active one. Use the on-screen `Points` button, press `D`, or append `?debug=1` to the URL.
- Debug pointer positions are recalculated when the viewport changes size.
- There is no runtime blending: only one predecoded photographic frame is visible at a time, and the URL changes at most once per animation frame.
- Cardinal mapping is upper pose 1 right, upper pose 25 up, upper pose 49 left, and lower pose 25 down.

## Loading

- All 141 pointer-owned images preload and decode before interaction begins.
- The poster remains hidden behind the loading state until the sequence is ready.
- The page swaps predecoded frame URLs instead of seeking a video element.

## Generation

The reusable Comfy Cloud recipe, prompts, endpoint rules, luminance checks, and native-frame processor are documented in [`../../docs/artworks/cat-cursor/generation.md`](../../docs/artworks/cat-cursor/generation.md).

- Generate the upper/lower semicircles and center-to-side paths separately with LTX 2.5 First/Last Frame at 576 × 1024, 4 seconds, and 24 fps.
- Use 49 poses for each semicircle and 24 poses for each horizontal path.
- Use uniquely named current endpoint uploads; do not select an older cloud asset with the same filename.
- Keep prompt enhancement off and require a fixed pure-white background, torso, camera, crop, face scale, exposure, and anatomical markings.
- Inspect one contact sheet, then use one acceptable take rather than repeatedly regenerating for marginal improvements.
- Run `pnpm process:cat-cursor-ltx` to select native frames and produce the runtime WebPs. The script never interpolates or blends frames.
