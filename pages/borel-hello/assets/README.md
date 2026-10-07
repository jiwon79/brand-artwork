# Borel source font

- Typeface: Borel Regular by Rosalie Wagner / The Borel Project Authors.
- Source: https://github.com/google/fonts/tree/main/ofl/borel
- Downloaded: 2026-10-07.
- Font blob SHA: `4b440768cc833cd29ee1dc88d4b9fd4d09702336`.
- License: SIL Open Font License 1.1; see `OFL.txt`.

`lettering.ts` contains outlines derived from this font after shaping the whole
word `hello` with HarfBuzz's default OpenType features. It therefore includes the
initial `h`, contextual `l` forms, and final `o`, rather than unconnected glyphs.
The font is retained as the source asset; the animation renders the derived SVG
outlines without a runtime font download. Hand-authored stroke paths are separate
from those outlines. They describe only `hello`, not arbitrary text input.
