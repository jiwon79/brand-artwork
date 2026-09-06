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

function randomAt(x, y, seed) {
  let value = Math.imul(x + 1, 0x1f123bb5) ^ Math.imul(y + 1, 0x5f356495) ^ seed;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

// Add the reference's sparse bright flecks and faint sensor color variation.
// Work in CSS-pixel cells so the noise does not disappear on 2x/3x displays.
export function grainOverlay(base, x, y) {
  const background = 5 / 255;
  const grain = Math.min(64, 8 * (-Math.log1p(-randomAt(x, y, 0x68bc21eb)) - 1));
  const baseBlack = base.gray * base.alpha + background * (1 - base.alpha);
  const floor = background * (1 - base.alpha);
  const targets = [0x3ad29f71, 0x6f18a45d, 0x2795c8b3].map(seed => clamp(Math.max(
    floor, baseBlack + (grain + 4.4 * (randomAt(x, y, seed) - 0.5)) / 255,
  )));
  // Keep the previous transmission except where a bright fleck needs more alpha.
  // This adds grain without turning every dark speck into a hole in the lettering.
  const alpha = Math.max(base.alpha, ...targets.map(value => (value - background) / (1 - background)));
  return [...targets.map(value => alpha > 0 ? clamp((value - background * (1 - alpha)) / alpha) : 0), alpha];
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

export function bakeRelief(rgba, width, height, density = 1) {
  const size = width * height;
  if (rgba.length !== size * 4) throw new Error('Unexpected source texture size');
  const gray = new Float64Array(size);
  const horizontal = new Float64Array(size);
  const radius = Math.max(1, Math.round(2 * density));
  const area = (radius * 2 + 1) ** 2;
  for (let i = 0; i < size; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    if (Math.max(r, g, b) - Math.min(r, g, b) > 1) throw new Error('The source texture must be neutral gray');
    gray[i] = r / 255;
  }
  // Wrapped sampling matches the repeating texture and avoids seams in the tile.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let dx = -radius; dx <= radius; dx++) sum += gray[y * width + (x + dx + width) % width];
      horizontal[y * width + x] = sum;
    }
  }
  const output = Buffer.alloc(size * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let dy = -radius; dy <= radius; dy++) sum += horizontal[((y + dy + height) % height) * width + x];
      const i = y * width + x;
      const detail = clamp(0.5 + 2.5 * (gray[i] - sum / area));
      const base = reliefOverlay(0.85 * detail + 0.15 * gray[i]);
      const pixel = grainOverlay(base, Math.floor(x / density), Math.floor(y / density));
      // 4/255 RGB steps save bandwidth in the low-alpha retina tiles; the
      // displayed difference is at most one channel step at 50% opacity.
      for (let channel = 0; channel < 3; channel++) {
        output[i * 4 + channel] = Math.min(255, Math.round(pixel[channel] * 255 / 4) * 4);
      }
      output[i * 4 + 3] = Math.round(pixel[3] * 255);
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
      '-quality', '100', output], bakeRelief(rgba, width, height, density));
    console.log(`Generated ${width}x${height} relief overlay: ${output}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) generate();
