# Date Turn assets

`keyframes.json` contains compound Bézier paths for one turn of the supplied reference: 89 poses at 30 fps, in the original 720 × 1280 coordinate system. `poster.svg` is the first pose. Both the numerals and the fine blue silhouette are drawn as filled paths with even-odd counters.

The reference contains `14 → 09 → 26 → 14`, with simultaneous faces visible during each turn, and vertical motion throughout the cycle. These contours preserve that captured trajectory. The page renders vectors on Canvas; it does not load or play the source video. Dragging scrubs this trajectory. These assets are not a freely rotatable 3D mesh or editable text geometry.

The reference file was `CFNetworkDownload_vUDYJw.tmp.mp4`, SHA-256 `04d6a2f32a15e6860b96533a3322b77dcf69b56c65c6d0c387bcf2b018579a23`. Compression halos are removed with a blue-chroma threshold; Potrace fits the remaining contours with straight and cubic segments.

To regenerate, install FFmpeg and `opencv-python-headless`, `numpy`, and `potracer` in a Python environment and run `python scripts/vectorize-date-turn.py /path/to/reference.mp4` from the repository root. Production rendering has no Python dependency.
