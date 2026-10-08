"""Regenerate exact Borel glyph IDs, advances and bounds from the bundled TTF.

Run: python3 scripts/generate-borel-catalog.py (requires fonttools).
No hand-authored registration, letter fitting or pen trajectories are stored.
"""
from pathlib import Path
import json
from fontTools.ttLib import TTFont

ASSETS = Path(__file__).resolve().parents[1] / "pages/borel-hello/assets"
font = TTFont(ASSETS / "Borel-Regular.ttf")
names = font.getGlyphOrder()
ids = {name: index for index, name in enumerate(names)}
records = []
for name in names:
    glyph = font["glyf"][name]
    record = {"name": name, "advance": font["hmtx"][name][0]}
    if glyph.numberOfContours:
        record["bounds"] = [glyph.xMin, glyph.yMin, glyph.xMax, glyph.yMax]
    records.append(record)
catalog = {
    "unitsPerEm": font["head"].unitsPerEm,
    "cmap": {str(codepoint): ids[name] for codepoint, name in font.getBestCmap().items()},
    "glyphs": records,
}
(ASSETS / "font-catalog.json").write_text(json.dumps(catalog, ensure_ascii=False, separators=(",", ":")) + "\n")
print(f"Borel: {len(catalog['cmap'])} codepoints, {len(records)} glyph records")
