import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const clamp = value => Math.min(1, Math.max(0, value));
const contrast = (value, amount) => clamp((value - 0.5) * amount + 0.5);

// Collapse the old multiply + screen pair into one ordinary alpha overlay.
// Both source layers are neutral gray, so this preserves every backdrop color.
export function reliefOverlay(value) {
  const multiply = clamp(contrast(value, 1.2) * 1.8);
  const screen = contrast(value, 2.2) * 0.32;
  const light = 0.34 * screen;
  const transmission = (1 - 0.5 * (1 - multiply)) * (1 - light);
  const alpha = 1 - transmission;
  return { gray: alpha > 0 ? light / alpha : 0, alpha };
}

function ffmpeg(args, input) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], {
    input, maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Texture generation requires ffmpeg: ${result.error?.message ?? result.stderr.toString()}`);
  }
  return result.stdout;
}

export function bakeRelief(rgba, width, height) {
  const size = width * height;
  if (rgba.length !== size * 4) throw new Error('Unexpected source texture size');
  const gray = new Float64Array(size);
  const horizontal = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    if (Math.max(r, g, b) - Math.min(r, g, b) > 1) throw new Error('The source texture must be neutral gray');
    gray[i] = r / 255;
  }
  // Wrapped sampling matches the repeating texture and avoids seams in the tile.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let dx = -2; dx <= 2; dx++) sum += gray[y * width + (x + dx + width) % width];
      horizontal[y * width + x] = sum;
    }
  }
  const output = Buffer.alloc(size * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let dy = -2; dy <= 2; dy++) sum += horizontal[((y + dy + height) % height) * width + x];
      const i = y * width + x;
      const detail = clamp(0.5 + (25 * gray[i] - sum) / 10);
      const { gray: color, alpha } = reliefOverlay(0.85 * detail + 0.15 * gray[i]);
      output[i * 4] = output[i * 4 + 1] = output[i * 4 + 2] = Math.round(color * 255);
      output[i * 4 + 3] = Math.round(alpha * 255);
    }
  }
  return output;
}

function generate() {
  const source = fileURLToPath(new URL('../pages/line-pull/assets/reference-screen-texture.webp', import.meta.url));
  for (const density of [1, 2, 3]) {
    const width = 384 * density, height = 360 * density;
    const rgba = ffmpeg(['-i', source, '-vf', `scale=${width}:${height}:flags=bilinear`, '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1']);
    const output = fileURLToPath(new URL(`../pages/line-pull/assets/surface-relief@${density}x.webp`, import.meta.url));
    ffmpeg(['-y', '-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', `${width}x${height}`,
      '-i', 'pipe:0', '-frames:v', '1', '-c:v', 'libwebp', '-lossless', '1', '-compression_level', '6',
      '-quality', '100', output], bakeRelief(rgba, width, height));
    console.log(`Generated ${width}x${height} relief overlay: ${output}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) generate();
