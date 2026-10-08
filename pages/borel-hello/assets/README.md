# Borel source font

- Typeface: Borel Regular by Rosalie Wagner / The Borel Project Authors.
- Source: https://github.com/google/fonts/tree/main/ofl/borel
- Downloaded: 2026-10-07.
- Font blob SHA: `4b440768cc833cd29ee1dc88d4b9fd4d09702336`.
- License: SIL Open Font License 1.1; see `OFL.txt`.

The bundled font has 351 encoded codepoints and 1,514 glyphs. This artwork accepts
159 unaccented English letters, digits, punctuation and symbols, including space.
Accented letters, combining marks and characters absent from the font produce an
input error. Text stays in the browser. FontFace and HarfBuzz use the same bundled
TTF; no system font or external font CDN is used.

HarfBuzz applies default OpenType substitutions and positioning to each complete
line. Its advances determine wrapping and centering; its exact glyph bounds
provide the artwork's view box. `font-catalog.json` contains only source font IDs,
metrics and bounds. Regenerate it with `python3 scripts/generate-borel-catalog.py`
(requires `fonttools`). No hand-authored letter shapes or join corrections remain.

The visible ink is **native Canvas `fillText`**, including the browser's glyph
selection, connections and antialiasing. Playback changes the alpha of those
original pixels. The final frame copies the untouched native image, so the
completed lettering has exactly the same RGBA bytes as native rendering in the
same browser and Canvas configuration. Resizing or changing the ink color renders
fresh native text at the current device pixel ratio.

Writing order is estimated from the actual assembled line: render at a fixed
200 px em size, thin its filled shape to a center graph, then visit graph edges.
Connected words are processed from left to right; bodies precede detached dots.
Nearest center points give each output pixel a reveal time. A small round pen head
covers the center of crossings without opening distant branches. No pre-rendered
animation frames are shipped. This graph walk estimates handwriting order; a font
outline does not encode the designer's prescribed pen movements.

## Verification

- `pnpm test pages/borel-hello`: exact directed outline segments and advances
  against an independent `opentype.js` parser for all 398 glyphs reached by the
  supported characters and 17,576 lowercase triples; layout checks for `name won`,
  initial/medial/final `n` and `w`, symbols and all 676 lowercase pairs.
- `pnpm dev`, then open `/borel-hello/verify.html` in the existing Chrome and click
  **검사 실행**: compares the production canvas output against independently drawn
  native Borel text, with no pixel tolerance. Covers 859 cases and 5,054 intermediate
  frames at desktop and mobile dimensions/device pixel ratios. Intermediate alpha
  must stay within the native font and never decrease. Every nonempty `hello`
  frame must retain one connected stroke component (excluding tiny AA specks).
- The browser verifier is a development-only HTML entry; it is not included in the
  production build. Unit tests also cover nearest-point ownership at crossings,
  graph coverage, line breaks, unsupported input and exact final pixel copying.

Pixel identity is checked within one browser/rendering configuration. Different
browsers, pixel ratios and Canvas backends can rasterize the same outline with
different antialiasing; each comparison creates both images in the same setup.
Temporary screenshots, measurements and QA scripts are not committed.
