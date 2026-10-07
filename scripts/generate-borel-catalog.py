"""Regenerate Borel's runtime metrics/composite catalog (requires fonttools).

Run: python3 scripts/generate-borel-catalog.py
The font is the checked-in, licensed source; pen trajectories are authored in
pages/borel-hello/stroke-alphabet.ts, independently of this outline metadata.
"""
from collections import Counter
from pathlib import Path
import json

from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "pages/borel-hello/assets"
font = TTFont(ASSETS / "Borel-Regular.ttf")
names = font.getGlyphOrder()
ids = {name: index for index, name in enumerate(names)}
glyphs = font["glyf"]
records = []

for name in names:
    glyph = glyphs[name]
    record = {"name": name, "advance": font["hmtx"][name][0]}
    if glyph.numberOfContours:
        record["bounds"] = [glyph.xMin, glyph.yMin, glyph.xMax, glyph.yMax]
    if glyph.isComposite():
        record["components"] = [
            [ids[component.glyphName], list(component.getComponentInfo()[1])]
            for component in glyph.components
        ]
    elif glyph.numberOfContours:
        base = name if name.endswith(".case") else name.split(".")[0]
        if base == "t_t":
            base = "t_t.liga"
        record["base"] = base
        if name != base and base in glyphs:
            original = glyphs[base].getCoordinates(glyphs)[0]
            current = glyph.getCoordinates(glyphs)[0]
            # Contextual forms keep the body, while changing entry/exit strokes.
            # Match its repeated outline nodes to register the authored body.
            offsets = Counter(
                x - ox for x, y in current for ox, oy in original
                if y == oy and y > 100
            )
            if offsets:
                record["dx"] = offsets.most_common(1)[0][0]
            else:
                record["dx"] = round((glyph.xMax + glyph.xMin - glyphs[base].xMax - glyphs[base].xMin) / 2)
    records.append(record)

catalog = {
    "unitsPerEm": font["head"].unitsPerEm,
    "cmap": {str(codepoint): ids[name] for codepoint, name in font.getBestCmap().items()},
    "glyphs": records,
}
(ASSETS / "font-catalog.json").write_text(json.dumps(catalog, ensure_ascii=False, separators=(",", ":")) + "\n")
print(f"Borel: {len(catalog['cmap'])} codepoints, {len(records)} glyph records")
