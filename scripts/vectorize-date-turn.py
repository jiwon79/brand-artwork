"""Rebuild Date Turn's vector poses from the supplied 720 x 1280 reference.

Requires: FFmpeg, opencv-python-headless, numpy, potracer.
Usage: python scripts/vectorize-date-turn.py reference.mp4
"""

import argparse
import gzip
import json
from pathlib import Path
import subprocess
import tempfile

import cv2
import numpy as np
import potrace


def vector_path(image):
    # The captured artwork stays within this crop throughout its first turn.
    image = image[340:920, 120:610].astype(np.float32)
    coverage = np.clip((image[:, :, 0] - (image[:, :, 1] + image[:, :, 2]) * 0.5) / 251, 0, 1)
    coverage = cv2.GaussianBlur(coverage, (3, 3), 0.42)
    curves = potrace.Bitmap(~(coverage >= 0.5)).trace(turdsize=3, alphamax=1, opttolerance=0.12)

    def point(value):
        return f"{value.x + 120:.2f} {value.y + 340:.2f}"

    paths = []
    for curve in curves:
        path = "M" + point(curve.start_point)
        for segment in curve:
            if segment.is_corner:
                path += "L" + point(segment.c) + "L" + point(segment.end_point)
            else:
                path += "C" + point(segment.c1) + " " + point(segment.c2) + " " + point(segment.end_point)
        paths.append(path + "Z")
    return "".join(paths)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "pages/date-turn/assets")
    arguments = parser.parse_args()
    probe = subprocess.run([
        "ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
        "stream=width,height,r_frame_rate", "-of", "json", str(arguments.source),
    ], check=True, capture_output=True, text=True)
    stream = json.loads(probe.stdout)["streams"][0]
    if (stream["width"], stream["height"], stream["r_frame_rate"]) != (720, 1280, "30/1"):
        raise ValueError("The reference must be 720 x 1280 at 30 fps")
    paths = []
    # FFmpeg's PNG conversion keeps regeneration consistent across OpenCV builds.
    with tempfile.TemporaryDirectory(prefix="date-turn-") as temporary:
        subprocess.run([
            "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-i",
            str(arguments.source), "-frames:v", "89", "-vsync", "0",
            str(Path(temporary) / "%03d.png"),
        ], check=True)
        # Frame 89 returns to the first pose; exclude that duplicated endpoint.
        for index in range(89):
            image = cv2.imread(str(Path(temporary) / f"{index + 1:03d}.png"))
            if image is None:
                raise ValueError("The reference has fewer than 89 frames")
            paths.append(vector_path(image))
    data = {"width": 720, "height": 1280, "fps": 30, "color": "#0000fb", "background": "#fdfdfd", "paths": paths}
    content = json.dumps(data, separators=(",", ":"))
    arguments.output.mkdir(parents=True, exist_ok=True)
    (arguments.output / "keyframes.json").write_text(content)
    (arguments.output / "poster.svg").write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 1280">'
        f'<path fill="{data["color"]}" fill-rule="evenodd" d="{paths[0]}"/></svg>\n'
    )
    print(f"Wrote {len(paths)} vector poses, {len(gzip.compress(content.encode()))} bytes gzipped")


if __name__ == "__main__":
    main()
