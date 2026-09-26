"""Extract silhouette and appearance frames from a 720px reference clip.

Run: python3 pages/fluffy-peach/generate-motion.py /path/to/reference.mp4
Requires ffmpeg and Pillow. The input clip is only used to generate the two
checked-in assets; it is not loaded by the artwork at runtime.
"""

from __future__ import annotations

import argparse
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory

from PIL import Image, ImageFilter


ROOT = Path(__file__).resolve().parent
FRAME_COUNT = 120
CELL = 256
APPEARANCE_CELL = 360
APPEARANCE_PADDING = 4
APPEARANCE_STEP = APPEARANCE_CELL + APPEARANCE_PADDING * 2
COLS = 11
ROWS = 11


def make_mask(image: Image.Image) -> Image.Image:
    pixels = image.load()
    mask = Image.new("L", image.size)
    output = mask.load()
    for y in range(125, 530):
        left = pixels[25, y][0]
        right = pixels[690, y][0]
        for x in range(90, 630):
            red, green, _ = pixels[x, y]
            background = left + (right - left) * (x - 25) / 665
            if red - background > 35 and red > green * 0.85:
                output[x, y] = 255
    # Close the two tiny eye holes and preserve the measured exterior contour.
    return mask.filter(ImageFilter.MaxFilter(13)).filter(ImageFilter.MinFilter(13))


def centroid(mask: Image.Image) -> tuple[float, float]:
    small = mask.resize((90, 90), Image.Resampling.BILINEAR)
    values = small.load()
    total = x_total = y_total = 0.0
    for y in range(90):
        for x in range(90):
            weight = values[x, y] / 255
            total += weight
            x_total += (x + 0.5) * weight
            y_total += (y + 0.5) * weight
    return x_total * 8 / total, y_total * 8 / total


def main(source: Path) -> None:
    with TemporaryDirectory() as temporary:
        subprocess.run(
            ["ffmpeg", "-v", "error", "-i", str(source), "-vf", "fps=24", f"{temporary}/%03d.png"],
            check=True,
        )
        frames = sorted(Path(temporary).glob("*.png"))[:FRAME_COUNT]
        if len(frames) != FRAME_COUNT:
            raise ValueError(f"Expected {FRAME_COUNT} frames, received {len(frames)}")

        atlas = Image.new("RGB", (COLS * CELL, ROWS * CELL))
        appearance = Image.new("RGB", (COLS * APPEARANCE_STEP, ROWS * APPEARANCE_STEP))
        rows: list[tuple[float, float]] = []
        for index, path in enumerate(frames):
            image = Image.open(path).convert("RGB")
            if image.size != (720, 720):
                raise ValueError(f"Expected 720x720 reference frames, received {image.size}")
            mask = make_mask(image)
            rows.append(centroid(mask))

            core = mask.filter(ImageFilter.GaussianBlur(3)).resize((CELL, CELL), Image.Resampling.LANCZOS)
            halo = mask.filter(ImageFilter.GaussianBlur(19)).resize((CELL, CELL), Image.Resampling.LANCZOS)
            tile = Image.merge("RGB", (core, halo, Image.new("L", (CELL, CELL))))
            atlas.paste(tile, ((index % COLS) * CELL, (index // COLS) * CELL))
            color = image.resize((APPEARANCE_CELL, APPEARANCE_CELL), Image.Resampling.LANCZOS)
            left = (index % COLS) * APPEARANCE_STEP + APPEARANCE_PADDING
            top = (index // COLS) * APPEARANCE_STEP + APPEARANCE_PADDING
            appearance.paste(color, (left, top))
            appearance.paste(color.crop((0, 0, 1, APPEARANCE_CELL)).resize((APPEARANCE_PADDING, APPEARANCE_CELL)), (left - APPEARANCE_PADDING, top))
            appearance.paste(color.crop((APPEARANCE_CELL - 1, 0, APPEARANCE_CELL, APPEARANCE_CELL)).resize((APPEARANCE_PADDING, APPEARANCE_CELL)), (left + APPEARANCE_CELL, top))
            appearance.paste(color.crop((0, 0, APPEARANCE_CELL, 1)).resize((APPEARANCE_CELL, APPEARANCE_PADDING)), (left, top - APPEARANCE_PADDING))
            appearance.paste(color.crop((0, APPEARANCE_CELL - 1, APPEARANCE_CELL, APPEARANCE_CELL)).resize((APPEARANCE_CELL, APPEARANCE_PADDING)), (left, top + APPEARANCE_CELL))
            for dx, dy, sx, sy in (
                (-APPEARANCE_PADDING, -APPEARANCE_PADDING, 0, 0),
                (APPEARANCE_CELL, -APPEARANCE_PADDING, APPEARANCE_CELL - 1, 0),
                (-APPEARANCE_PADDING, APPEARANCE_CELL, 0, APPEARANCE_CELL - 1),
                (APPEARANCE_CELL, APPEARANCE_CELL, APPEARANCE_CELL - 1, APPEARANCE_CELL - 1),
            ):
                corner = Image.new("RGB", (APPEARANCE_PADDING, APPEARANCE_PADDING), color.getpixel((sx, sy)))
                appearance.paste(corner, (left + dx, top + dy))

    (ROOT / "assets").mkdir(exist_ok=True)
    atlas.save(ROOT / "assets" / "motion-atlas.png", optimize=True)
    appearance.save(ROOT / "assets" / "appearance-atlas.webp", quality=91, method=6)
    lines = ["// Measured at 24 fps from the supplied reference clip.", "// [body x, body y] in 720px reference coordinates", "export const motionFrames: readonly (readonly [number, number])[] = ["]
    lines += ["  [" + ", ".join(f"{number:.1f}" for number in row) + "]," for row in rows]
    lines.append("];")
    (ROOT / "motion-data.ts").write_text("\n".join(lines) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    main(parser.parse_args().source)
