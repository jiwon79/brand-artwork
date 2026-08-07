import { execFileSync, spawnSync } from 'node:child_process';
import { basename, dirname, extname, join } from 'node:path';
import { writeFileSync } from 'node:fs';

const WIDTH = 480;
const HEIGHT = 600;
const semanticInput = process.argv.includes('--semantic');
const inputs = process.argv.slice(2).filter((argument) => argument !== '--semantic');

if (inputs.length === 0) {
  console.error('Usage: node analyze-silhouette.mjs [--semantic] image [image ...]');
  process.exit(1);
}

function decode(path) {
  return execFileSync('ffmpeg', [
    '-v', 'error',
    '-i', path,
    '-vf', `scale=${WIDTH}:${HEIGHT}:flags=lanczos`,
    '-f', 'rawvideo',
    '-pix_fmt', 'rgb24',
    '-',
  ], { maxBuffer: WIDTH * HEIGHT * 4 });
}

function percentile(values, ratio) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.round((sorted.length - 1) * ratio)];
}

function classify(rgb) {
  const effect = new Uint8Array(WIDTH * HEIGHT);
  const text = new Uint8Array(WIDTH * HEIGHT);

  for (let pixel = 0; pixel < WIDTH * HEIGHT; pixel += 1) {
    const offset = pixel * 3;
    const r = rgb[offset];
    const g = rgb[offset + 1];
    const b = rgb[offset + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const chroma = max - min;
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const saturation = chroma / Math.max(max, 1);

    if (semanticInput) {
      if (luminance < 64) effect[pixel] = 1;
      else if (luminance < 220) text[pixel] = 1;
      continue;
    }

    // The artwork effect is the only chromatic layer. This deliberately ignores hue.
    if (chroma >= 10 && saturation >= 0.045 && luminance < 253) {
      effect[pixel] = 1;
    } else if (luminance < 225) {
      text[pixel] = 1;
    }
  }

  return { effect, text };
}

function labelPreview(path, effect, text) {
  const ppm = Buffer.alloc(WIDTH * HEIGHT * 3 + 32);
  const header = Buffer.from(`P6\n${WIDTH} ${HEIGHT}\n255\n`);
  header.copy(ppm, 0);
  let writeOffset = header.length;

  for (let pixel = 0; pixel < WIDTH * HEIGHT; pixel += 1) {
    // Semantic labels: background=0 (white), text=1 (gray), effect=2 (black).
    const value = effect[pixel] ? 0 : text[pixel] ? 128 : 255;
    ppm[writeOffset] = value;
    ppm[writeOffset + 1] = value;
    ppm[writeOffset + 2] = value;
    writeOffset += 3;
  }

  const ppmPath = `${path}.ppm`;
  writeFileSync(ppmPath, ppm.subarray(0, writeOffset));
  const result = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', ppmPath, path]);
  if (result.status !== 0) throw new Error(result.stderr.toString());
  spawnSync('rm', [ppmPath]);
}

function thin(source) {
  const pixels = Uint8Array.from(source);
  const removable = [];
  const at = (x, y) => pixels[y * WIDTH + x];
  let changed = true;

  while (changed) {
    changed = false;
    for (let phase = 0; phase < 2; phase += 1) {
      removable.length = 0;
      for (let y = 1; y < HEIGHT - 1; y += 1) {
        for (let x = 1; x < WIDTH - 1; x += 1) {
          if (!at(x, y)) continue;
          const p2 = at(x, y - 1);
          const p3 = at(x + 1, y - 1);
          const p4 = at(x + 1, y);
          const p5 = at(x + 1, y + 1);
          const p6 = at(x, y + 1);
          const p7 = at(x - 1, y + 1);
          const p8 = at(x - 1, y);
          const p9 = at(x - 1, y - 1);
          const neighbors = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (neighbors < 2 || neighbors > 6) continue;
          const transitions = Number(!p2 && p3) + Number(!p3 && p4)
            + Number(!p4 && p5) + Number(!p5 && p6)
            + Number(!p6 && p7) + Number(!p7 && p8)
            + Number(!p8 && p9) + Number(!p9 && p2);
          if (transitions !== 1) continue;
          const conditionA = phase === 0 ? p2 * p4 * p6 : p2 * p4 * p8;
          const conditionB = phase === 0 ? p4 * p6 * p8 : p2 * p6 * p8;
          if (!conditionA && !conditionB) removable.push(y * WIDTH + x);
        }
      }
      if (removable.length > 0) {
        changed = true;
        for (const index of removable) pixels[index] = 0;
      }
    }
  }

  return pixels;
}

function distanceTransform(mask) {
  const diagonal = Math.SQRT2;
  const distance = new Float32Array(mask.length);
  distance.fill(1e6);
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) distance[index] = 0;
  }

  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const index = y * WIDTH + x;
      if (!mask[index]) continue;
      if (x > 0) distance[index] = Math.min(distance[index], distance[index - 1] + 1);
      if (y > 0) distance[index] = Math.min(distance[index], distance[index - WIDTH] + 1);
      if (x > 0 && y > 0) distance[index] = Math.min(distance[index], distance[index - WIDTH - 1] + diagonal);
      if (x + 1 < WIDTH && y > 0) distance[index] = Math.min(distance[index], distance[index - WIDTH + 1] + diagonal);
    }
  }
  for (let y = HEIGHT - 1; y >= 0; y -= 1) {
    for (let x = WIDTH - 1; x >= 0; x -= 1) {
      const index = y * WIDTH + x;
      if (!mask[index]) continue;
      if (x + 1 < WIDTH) distance[index] = Math.min(distance[index], distance[index + 1] + 1);
      if (y + 1 < HEIGHT) distance[index] = Math.min(distance[index], distance[index + WIDTH] + 1);
      if (x + 1 < WIDTH && y + 1 < HEIGHT) distance[index] = Math.min(distance[index], distance[index + WIDTH + 1] + diagonal);
      if (x > 0 && y + 1 < HEIGHT) distance[index] = Math.min(distance[index], distance[index + WIDTH - 1] + diagonal);
    }
  }
  return distance;
}

function measure(mask) {
  let area = 0;
  let sumX = 0;
  let sumY = 0;
  let perimeter = 0;
  let minX = WIDTH;
  let minY = HEIGHT;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const index = y * WIDTH + x;
      if (!mask[index]) continue;
      area += 1;
      sumX += x;
      sumY += y;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      if (x === 0 || !mask[index - 1]) perimeter += 1;
      if (x === WIDTH - 1 || !mask[index + 1]) perimeter += 1;
      if (y === 0 || !mask[index - WIDTH]) perimeter += 1;
      if (y === HEIGHT - 1 || !mask[index + WIDTH]) perimeter += 1;
    }
  }

  const skeleton = thin(mask);
  const distance = distanceTransform(mask);
  const widths = [];
  let skeletonPixels = 0;
  let endpoints = 0;
  let branchPixels = 0;
  for (let y = 1; y < HEIGHT - 1; y += 1) {
    for (let x = 1; x < WIDTH - 1; x += 1) {
      const index = y * WIDTH + x;
      if (!skeleton[index]) continue;
      skeletonPixels += 1;
      widths.push(distance[index] * 2);
      let neighbors = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx || dy) neighbors += skeleton[(y + dy) * WIDTH + x + dx];
        }
      }
      if (neighbors === 1) endpoints += 1;
      if (neighbors >= 3) branchPixels += 1;
    }
  }

  const bboxWidth = maxX >= minX ? maxX - minX + 1 : 0;
  const bboxHeight = maxY >= minY ? maxY - minY + 1 : 0;
  const sampleRows = {};
  for (const y of [196, 205, 215, 225, 235, 245, 255, 275, 300, 325, 350, 375, 400, 425, 450]) {
    const runs = [];
    let start = -1;
    for (let x = 0; x <= WIDTH; x += 1) {
      const filled = x < WIDTH && mask[y * WIDTH + x];
      if (filled && start < 0) start = x;
      if (!filled && start >= 0) {
        if (x - start >= 2) runs.push([start, x - 1]);
        start = -1;
      }
    }
    sampleRows[y] = runs;
  }
  return {
    area,
    centroid: [sumX / Math.max(1, area), sumY / Math.max(1, area)],
    bbox: [minX, minY, bboxWidth, bboxHeight],
    occupancy: area / Math.max(1, bboxWidth * bboxHeight),
    perimeter,
    equivalentStripWidth: (2 * area) / Math.max(1, perimeter),
    skeletonPixels,
    endpoints,
    branchPixels,
    skeletonWidthP25: percentile(widths, 0.25),
    skeletonWidthMedian: percentile(widths, 0.5),
    skeletonWidthP75: percentile(widths, 0.75),
    skeletonWidthP90: percentile(widths, 0.9),
    skeletonWidthMax: percentile(widths, 1),
    sampleRows,
  };
}

for (const input of inputs) {
  const rgb = decode(input);
  const { effect, text } = classify(rgb);
  const output = join(dirname(input), `${basename(input, extname(input))}-labels.png`);
  labelPreview(output, effect, text);
  console.log(JSON.stringify({ input, output, ...measure(effect) }, null, 2));
}
