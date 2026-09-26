"""Measure animation curves from a 720x720 reference clip.

Run: python3 pages/fluffy-peach/generate-motion.py /path/to/reference.mp4
Requires ffmpeg and Pillow. Runtime rendering uses only the generated numeric
measurements, never source video frames or frame textures.
"""

from __future__ import annotations

import argparse
import math
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent
FRAME_COUNT = 120
RADIAL_SAMPLES = 64


def make_mask(image: Image.Image) -> Image.Image:
    pixels = image.load()
    mask = Image.new('L', image.size)
    output = mask.load()
    for y in range(125, 530):
        left = pixels[25, y][0]
        right = pixels[690, y][0]
        for x in range(90, 630):
            red, green, _ = pixels[x, y]
            background = left + (right - left) * (x - 25) / 665
            if red - background > 35 and red > green * 0.85:
                output[x, y] = 255
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


def radial_contour(mask: Image.Image, center: tuple[float, float]) -> list[float]:
    pixels = mask.load()
    cx, cy = center
    radii: list[float] = []
    for index in range(RADIAL_SAMPLES):
        angle = (index + 0.5) * 2 * math.pi / RADIAL_SAMPLES
        dx, dy = math.cos(angle), math.sin(angle)
        last_inside = 0.0
        for distance in range(1, 281):
            x = round(cx + dx * distance)
            y = round(cy + dy * distance)
            if 0 <= x < 720 and 0 <= y < 720 and pixels[x, y] > 127:
                last_inside = float(distance)
        radii.append(last_inside)
    # Remove pixel-step noise without losing the cheek and squash silhouettes.
    return [
        sum(radii[(index + offset) % RADIAL_SAMPLES] * weight
            for offset, weight in ((-2, 1), (-1, 2), (0, 4), (1, 2), (2, 1))) / 10
        for index in range(RADIAL_SAMPLES)
    ]


def find_eyes(image: Image.Image) -> tuple[float, float, float, float, float] | None:
    blurred = image.filter(ImageFilter.GaussianBlur(10)).load()
    pixels = image.load()
    candidates: set[tuple[int, int]] = set()
    for y in range(215, 420):
        for x in range(265, 550):
            red, _, blue = pixels[x, y]
            soft_red, _, soft_blue = blurred[x, y]
            if soft_red - red > 30 and blue - soft_blue > 9 and soft_red > 150 and red > 85:
                candidates.add((x, y))

    components: list[tuple[int, float, float, int]] = []
    while candidates:
        stack = [candidates.pop()]
        component = stack[:]
        while stack:
            x, y = stack.pop()
            for neighbor in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if neighbor in candidates:
                    candidates.remove(neighbor)
                    stack.append(neighbor)
                    component.append(neighbor)
        if not 12 < len(component) < 220:
            continue
        xs = [point[0] for point in component]
        ys = [point[1] for point in component]
        width = max(xs) - min(xs) + 1
        height = max(ys) - min(ys) + 1
        if height >= width * 1.15 and height < 30 and width < 18:
            components.append((len(component), sum(xs) / len(xs), sum(ys) / len(ys), height))

    pairs = [
        (a[0] + b[0], a, b)
        for a in components for b in components
        if 26 < b[1] - a[1] < 42 and abs(a[2] - b[2]) < 12
    ]
    if not pairs:
        return None
    _, left, right = max(pairs, key=lambda pair: pair[0])
    return left[1], left[2], right[1], right[2], min(1.0, (left[3] + right[3]) / 38)


def fill_missing_eyes(rows: list[dict]) -> None:
    valid = [index for index, row in enumerate(rows) if row['eyes'] is not None]
    for index, row in enumerate(rows):
        if row['eyes'] is not None:
            continue
        before = max((item for item in valid if item < index), default=valid[0])
        after = min((item for item in valid if item > index), default=valid[-1])
        fraction = (index - before) / (after - before) if after != before else 0.0
        row['eyes'] = tuple(
            rows[before]['eyes'][coordinate] * (1 - fraction)
            + rows[after]['eyes'][coordinate] * fraction
            for coordinate in range(4)
        ) + (0.0,)


def main(source: Path) -> None:
    with TemporaryDirectory() as temporary:
        subprocess.run(
            ['ffmpeg', '-v', 'error', '-i', str(source), '-vf', 'fps=24', f'{temporary}/%03d.png'],
            check=True,
        )
        frames = sorted(Path(temporary).glob('*.png'))[:FRAME_COUNT]
        if len(frames) != FRAME_COUNT:
            raise ValueError(f'Expected {FRAME_COUNT} frames, received {len(frames)}')
        rows: list[dict] = []
        for path in frames:
            image = Image.open(path).convert('RGB')
            if image.size != (720, 720):
                raise ValueError(f'Expected 720x720 reference frames, received {image.size}')
            mask = make_mask(image)
            center = centroid(mask)
            rows.append({
                'center': center,
                'eyes': find_eyes(image),
                'radii': radial_contour(mask, center),
            })

    fill_missing_eyes(rows)
    lines = [
        '// Numeric measurements from the reference clip; no source pixels at runtime.',
        '// center/eyes use 720px reference coordinates; radii are sampled clockwise.',
        'export type MotionFrame = {',
        '  center: readonly [number, number];',
        '  eyes: readonly [number, number, number, number, number];',
        '  radii: readonly number[];',
        '};',
        'export const motionFrames: readonly MotionFrame[] = [',
    ]
    for row in rows:
        center = ', '.join(f'{value:.1f}' for value in row['center'])
        eyes = ', '.join(f'{value:.1f}' for value in row['eyes'])
        radii = ', '.join(f'{value:.1f}' for value in row['radii'])
        lines.append(f'  {{center: [{center}], eyes: [{eyes}], radii: [{radii}]}},')
    lines.append('];')
    (ROOT / 'motion-data.ts').write_text('\n'.join(lines) + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    main(parser.parse_args().source)
