# Cat Cursor LTX generation

## Canonical images

- `center` and `right` are GPT Image references.
- `left` is generated as an identity-preserving edit of `center`, with `right` used only as a three-dimensional identity and marking reference.
- Never create `left` by horizontally flipping `right`. A flip swaps the cat's asymmetric facial spots and stripes.
- Every runtime path replaces its generated first and last frames with the canonical endpoint files.
- The vertical paths use the exact native midpoint frames from the accepted upper and lower circle videos as their `top` and `bottom` last-frame inputs. Runtime still lets the circle pointers own those endpoints.
- Give every uploaded canonical image a unique versioned filename. Comfy Cloud can retain an older asset under the same visible name, which makes a valid generation start from the wrong crop or scale.

## Comfy Cloud settings

Use the `video_ltx2_5_flf2v` workflow with LTX 2.5 First/Last Frame:

- resolution: `576 × 1024`
- duration: `4 seconds` for semicircles; `2 seconds` for horizontal and vertical paths
- frame rate: `24 fps`
- prompt enhancement: off
- output: 97 native frames for 4-second paths; 49 native frames for 2-second paths
- background: flat pure white `#FFFFFF`
- camera, torso, crop, face scale, exposure, and anatomical left/right markings remain fixed

### Upper arc prompt

```text
Use the provided exact screen-right-facing first frame and exact screen-left-facing last frame as fixed anchors. Create one smooth continuous UPPER semicircular head-and-eye tracking motion in SCREEN coordinates: 0% look clearly RIGHT, 50% look clearly UP toward the TOP EDGE with the muzzle and pupils raised and the head gently tilted upward, 100% look clearly LEFT. The gaze must travel only along the upper arc RIGHT → TOP → LEFT. At no point should the cat look straight forward at the camera as the main midpoint pose, and it must never look downward. The head and pupils move continuously at a steady speed without pause, reversal, or shortcut. Keep both eyes naturally visible during the upward pose. Only the head, eyes, and ears move as anatomically necessary. Keep the neck base, torso, shoulders, camera, framing, face scale, crop, orange-and-white cat identity, exact asymmetric facial markings, fur detail, exposure, and flat pure white #FFFFFF background fixed. Do not mirror or swap the cat's anatomical left/right markings. Preserve both endpoint compositions exactly. Keep the entire face, both ears, nose, chin, muzzle, and whiskers inside the strict 9:16 frame. No body sway, camera motion, zoom, reframing, cuts, morphing, facial deformation, gray tint, gradient, shadow, floor, or lighting change.
```

### Lower arc prompt

```text
Use the provided exact screen-left-facing first frame and exact screen-right-facing last frame as fixed anchors. Create one smooth continuous LOWER semicircular head-and-eye tracking motion in SCREEN coordinates: 0% look clearly LEFT, 50% look clearly DOWN toward the BOTTOM EDGE with the muzzle and pupils lowered and the head gently tilted downward, 100% look clearly RIGHT. The gaze must travel only along the lower arc LEFT → BOTTOM → RIGHT. At no point should the cat look straight forward at the camera as the main midpoint pose, and it must never look upward. The head and pupils move continuously at a steady speed without pause, reversal, or shortcut. Keep both eyes naturally visible during the downward pose; do not bury the face into the chest. Only the head, eyes, and ears move as anatomically necessary. Keep the neck base, torso, shoulders, camera, framing, face scale, crop, orange-and-white cat identity, exact asymmetric facial markings, fur detail, exposure, and flat pure white #FFFFFF background fixed. Do not mirror or swap the cat's anatomical left/right markings. Preserve both endpoint compositions exactly. Keep the entire face, both ears, nose, chin, muzzle, and whiskers inside the strict 9:16 frame. No body sway, camera motion, zoom, reframing, cuts, morphing, facial deformation, gray tint, gradient, shadow, floor, or lighting change.
```

### Center-to-right prompt

```text
Throughout this short two-second motion, the cat holds a bright, alert, wide-eyed attentive expression identical to the endpoint photographs. Both eye openings stay consistently round and equally open, with both irises continuously clear and unobstructed. Use the provided exact forward-facing CENTER first frame and exact screen-right-facing last frame as fixed anchors. Create one smooth continuous STRAIGHT HORIZONTAL gaze transition in SCREEN coordinates: 0% look straight ahead at CENTER, 100% look clearly RIGHT. The head orientation and pupils move continuously CENTER → RIGHT at a steady speed. Preserve the same relaxed brow, eyelid height, eye aperture, mouth, and facial expression throughout. The ears remain naturally attached to the rotating head without independent movement. Keep the neck base, torso, shoulders, camera, framing, face scale, crop, orange-and-white cat identity, exact asymmetric facial markings, fur detail, exposure, and flat pure white #FFFFFF background fixed. Preserve both endpoint compositions exactly. Keep the entire face, both bright open eyes, both ears, nose, chin, muzzle, and whiskers inside the strict 9:16 frame. The result is one clean studio reference turn with constant alert eye openness and only a horizontal change in gaze direction.
```

### Center-to-left prompt

```text
Throughout this short two-second motion, the cat holds a bright, alert, wide-eyed attentive expression identical to the endpoint photographs. Both eye openings stay consistently round and equally open, with both irises continuously clear and unobstructed. Use the provided exact forward-facing CENTER first frame and exact screen-left-facing last frame as fixed anchors. Create one smooth continuous STRAIGHT HORIZONTAL gaze transition in SCREEN coordinates: 0% look straight ahead at CENTER, 100% look clearly LEFT. The head orientation and pupils move continuously CENTER → LEFT at a steady speed. Preserve the same relaxed brow, eyelid height, eye aperture, mouth, and facial expression throughout. The ears remain naturally attached to the rotating head without independent movement. Keep the neck base, torso, shoulders, camera, framing, face scale, crop, orange-and-white cat identity, exact asymmetric facial markings, fur detail, exposure, and flat pure white #FFFFFF background fixed. Preserve both endpoint compositions exactly. Keep the entire face, both bright open eyes, both ears, nose, chin, muzzle, and whiskers inside the strict 9:16 frame. The result is one clean studio reference turn with constant alert eye openness and only a horizontal change in gaze direction.
```

### Center-to-top prompt

```text
Throughout this short two-second motion, the cat stays awake, alert, and attentive with both eyes continuously open; there is no blink, squint, eyelid droop, or eye closure at any intermediate frame. Use the provided exact forward-facing CENTER first frame and exact upward-looking TOP last frame as fixed anchors. Create one smooth continuous STRAIGHT VERTICAL gaze transition in SCREEN coordinates: 0% look straight ahead at CENTER, 100% look clearly UP toward the TOP EDGE. The head orientation, muzzle, and pupils move continuously CENTER → TOP at a steady speed, with no sideways detour, pause, reversal, or overshoot. Preserve the same relaxed brow, eye aperture, mouth, and facial expression as far as anatomically possible while looking upward. The ears remain naturally attached to the rotating head without independent movement. Keep the neck base, torso, shoulders, camera, framing, face scale, crop, orange-and-white cat identity, exact asymmetric facial markings, fur detail, exposure, and flat pure white #FFFFFF background fixed. Preserve both endpoint compositions exactly. Keep the entire face, both open eyes, both ears, nose, chin, muzzle, and whiskers inside the strict 9:16 frame. No body sway, camera motion, zoom, reframing, cuts, morphing, facial deformation, gray tint, gradient, shadow, floor, lighting change, or blinking.
```

### Center-to-bottom prompt

```text
Throughout this short two-second motion, the cat stays awake and attentive; it never blinks or deliberately closes its eyes. Both eyes remain continuously visible and open as far as anatomically possible while the gaze turns downward, with any eyelid lowering caused only by the final downward head angle. Use the provided exact forward-facing CENTER first frame and exact downward-looking BOTTOM last frame as fixed anchors. Create one smooth continuous STRAIGHT VERTICAL gaze transition in SCREEN coordinates: 0% look straight ahead at CENTER, 100% look clearly DOWN toward the BOTTOM EDGE. The head orientation, muzzle, and pupils move continuously CENTER → BOTTOM at a steady speed, with no sideways detour, pause, reversal, or overshoot. Preserve the same relaxed brow, mouth, and facial expression while the head gently tilts downward; do not add a blink, sleepy expression, or squint. The ears remain naturally attached to the rotating head without independent movement. Keep the neck base, torso, shoulders, camera, framing, face scale, crop, orange-and-white cat identity, exact asymmetric facial markings, fur detail, exposure, and flat pure white #FFFFFF background fixed. Preserve both endpoint compositions exactly. Keep the entire face, both eyes, both ears, nose, chin, muzzle, and whiskers inside the strict 9:16 frame; do not bury the face into the chest. No body sway, camera motion, zoom, reframing, cuts, morphing, facial deformation, gray tint, gradient, shadow, floor, lighting change, or blink.
```

## Native-frame processing

The checked-in processor selects evenly spaced native source frames without interpolation. It excludes the two generated endpoint frames from runtime output because canonical PNG files own those pointers.

```sh
pnpm process:cat-cursor-ltx \
  --video .qa/cat-cursor-ltx-circle-v3/upper/video/ltx25_cat_orbit_upper_right_left_v3_00001_.mp4 \
  --output pages/cat-cursor/assets/cat-upper-frames \
  --poses 49 \
  --start-offset 4 \
  --end-offset 8
```

Measure background, face, and torso luminance before choosing the endpoint offsets. The processor applies the offset only near each seam, tapers it over seven interior poses, and preserves chroma. It also raises the high-luminance range by at most two Y levels so generated white backgrounds match the canonical PNG files.

The same command is reusable for another LTX path: change `--video`, `--output`, and `--poses`. The script calculates evenly distributed native source indices rather than using FFmpeg interpolation, optical flow, or blended frames.

The horizontal paths use 24 poses:

```sh
pnpm process:cat-cursor-ltx \
  --video .qa/cat-cursor-ltx-horizontal-v4/right/video/ltx25_cat_center_right_v4_short_alert_00001_.mp4 \
  --output pages/cat-cursor/assets/cat-center-right-frames \
  --poses 24 \
  --start-offset 4 \
  --start-hold 3 \
  --end-offset 4

pnpm process:cat-cursor-ltx \
  --video .qa/cat-cursor-ltx-horizontal-v4/left/video/ltx25_cat_center_left_v4_short_alert_00001_.mp4 \
  --output pages/cat-cursor/assets/cat-center-left-frames \
  --poses 24 \
  --start-offset 4 \
  --start-hold 3 \
  --end-offset 4
```

The vertical paths also use 24 poses. Their endpoint inputs are native frame 49 from the corresponding accepted 97-frame circle video:

```sh
pnpm process:cat-cursor-ltx \
  --video .qa/cat-cursor-ltx-vertical-v1/top/video/video/ltx25_cat_center_top_v1_alert_00001_.mp4 \
  --output pages/cat-cursor/assets/cat-center-top-frames \
  --poses 24 \
  --start-offset 4 \
  --start-hold 3 \
  --end-offset 3

pnpm process:cat-cursor-ltx \
  --video .qa/cat-cursor-ltx-vertical-v1/bottom/video/video/ltx25_cat_center_bottom_v1_attentive_00001_.mp4 \
  --output pages/cat-cursor/assets/cat-center-bottom-frames \
  --poses 24 \
  --start-offset 5 \
  --start-hold 3 \
  --end-offset 4
```
