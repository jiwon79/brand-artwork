# Borel source font

- Typeface: Borel Regular by Rosalie Wagner / The Borel Project Authors.
- Source: https://github.com/google/fonts/tree/main/ofl/borel
- Downloaded: 2026-10-07.
- Font blob SHA: `4b440768cc833cd29ee1dc88d4b9fd4d09702336`.
- License: SIL Open Font License 1.1; see `OFL.txt`.

`lettering.ts` contains outlines derived from this font after shaping the whole
word `hello` with HarfBuzz's default OpenType features. It therefore includes the
initial `h`, contextual `l` forms, and final `o`, rather than unconnected glyphs.
The font is retained as the source asset; the derived SVG outlines are used only
for the optional comparison overlay, without a runtime font download. Hand-authored stroke paths are separate
from those outlines. They describe only `hello`, not arbitrary text input.

The visible ink is a round, 36-unit stroke following hand-authored center paths
matched to Borel. It is a Borel-based lettering interpretation, not an exact
outline reveal. Drawing the trajectory directly prevents future branches of a
font's self-crossings from appearing early. The debug panel can overlay the exact
Borel outlines for comparison. No font-outline mask or pre-rendered frames are
used in playback.
