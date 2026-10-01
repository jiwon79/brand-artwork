# Date Turn

Run `pnpm dev` and open `/date-turn/`. The **설정** button or D key opens controls for the three numbers (1–6 digits per face, preserving leading zeros), size, pointer sensitivity, playback speed, motion, four colors, and outline width. Drag horizontally and vertically for free rotation; click or Space toggles automatic rotation. **현재 렌더 PNG 저장** exports the current canvas, including the chosen numbers, colors, size, and viewing angle.

The WebGL renderer generates numeral distance fields from the selected font and constructs a three-sided solid from those fields. Arial Black and Arial use system fonts with bundled Pretendard ExtraBold as fallback; Pretendard can also be selected directly. Numeral caps stay flat; their supports connect to a rounded white body. Each frame traces the actual rotated volume, resolves occlusion, draws the silhouette, and applies antialiasing. No reference frames, traced frame paths, or source video are used at runtime. The original remains a visual reference; the reconstructed font and body are not a recovered original model.

Font source and license: [`../line-pull/assets/Pretendard-SOURCE.md`](../line-pull/assets/Pretendard-SOURCE.md), [`../line-pull/assets/Pretendard-LICENSE.txt`](../line-pull/assets/Pretendard-LICENSE.txt).
