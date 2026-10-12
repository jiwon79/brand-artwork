import { expect, test } from 'vitest';
import { composeText, supportedCharacter } from './lettering';
import { penGeometry, preparePen } from './pen-geometry';
import { catalog, font, foregroundIoU, raster, shaper } from './test-font';

const ink = (paths: string[]) => paths.map(d => `<path d="${d}"/>`).join('');
const lowercase = 'abcdefghijklmnopqrstuvwxyz';

function inkComponents(pixels: Uint8Array, width: number): number {
  const mask = new Uint8Array(pixels.length / 4);
  for (let i = 0; i < mask.length; i++) mask[i] = Number(pixels[i * 4 + 3] >= 128);
  let count = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const queue = [i]; mask[i] = 0;
    let area = 0;
    while (queue.length) {
      const at = queue.pop()!; area++;
      for (const next of [at - width, at + width, at % width ? at - 1 : -1, at % width < width - 1 ? at + 1 : -1]) {
        if (next >= 0 && next < mask.length && mask[next]) { mask[next] = 0; queue.push(next); }
      }
    }
    if (area >= 4) count++; // Ignore subpixel antialias specks.
  }
  return count;
}

// Enumerate the font's actual default shaping, including initial/medial/final
// contextual alternatives and four-letter contexts for the tt ligature.
function reachableGlyphs(): Set<number> {
  const ids = new Set<number>();
  const add = (text: string) => shaper.shape(text).forEach(glyph => ids.add(glyph.id));
  for (const cp of Object.keys(catalog.cmap)) {
    const character = String.fromCodePoint(Number(cp));
    if (supportedCharacter(character, catalog)) add(character);
  }
  for (const a of lowercase) for (const b of lowercase) {
    for (const c of lowercase) add(a + b + c);
    add(a + 'tt' + b);
  }
  return ids;
}

test('every supported contextual glyph overlaps at least 95% of the source font ink', () => {
  const ids = reachableGlyphs();
  expect(ids.size).toBeGreaterThan(400);
  for (const id of ids) {
    const glyph = catalog.glyphs[id];
    if (!glyph.bounds) continue;
    const strokes = catalog.penPaths?.[String(id)];
    expect(strokes?.length, glyph.name).toBeGreaterThan(0);
    const [x0, y0, x1, y1] = glyph.bounds;
    const bounds = [x0 - 25, -y1 - 25, x1 + 25, -y0 + 25] as const;
    const actual = raster(`<g transform="scale(1 -1)">${ink(strokes!.map(stroke => penGeometry(preparePen(stroke))))}</g>`, bounds);
    const expected = raster(`<path d="${font.glyphToPath(id)}" transform="scale(1 -1)"/>`, bounds);
    const overlap = foregroundIoU(actual, expected);
    expect(overlap, `${glyph.name}: ${(overlap * 100).toFixed(2)}% foreground IoU`).toBeGreaterThanOrEqual(.95);
  }
}, 120_000);

const examples = ['hello', 'name won', 'n an na nn', 'w aw wa ww', 'spell', 'little letters', 'attb attc atttta', lowercase, lowercase.toUpperCase(), '0123456789', '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~', 'Hello, world! @ 100%', 'a\n\nwon'];
for (const text of examples) test(`completed Bézier lettering matches the source: ${JSON.stringify(text)}`, () => {
  const lettering = composeText(text, shaper, catalog);
  const actual = raster(ink(lettering.strokes.map(stroke => penGeometry(preparePen(stroke)))), lettering.bounds);
  const expected = raster(ink(lettering.outlines), lettering.bounds);
  expect(foregroundIoU(actual, expected)).toBeGreaterThanOrEqual(.95);
});

test('pixel comparison counts foreground rather than rewarding a blank background', () => {
  const reference = new Uint8Array(4000); reference[3] = 255;
  expect(foregroundIoU(new Uint8Array(4000), reference)).toBe(0);
});

test('curve controls move the pen; elapsed distance does not reveal source pixels', () => {
  const pen = preparePen({ d: 'M0 0 C0 100 100 100 100 0', widths: [[10, 20, 20, 10]] });
  expect(penGeometry(pen, 0)).toBe('');
  expect(pen.points[Math.floor(pen.points.length / 2)].y).toBeGreaterThan(70);
  expect(penGeometry(pen, pen.length / 2)).not.toBe(penGeometry(pen));
  expect(penGeometry(pen, pen.length * 2)).toBe(penGeometry(pen));
});

// Every 60 fps frame is rendered. A crossing cannot erase already written ink;
// later strokes remain absent, and completed paths never change again.
for (const text of ['hello', 'name won']) test(`every frame retains written ink through crossings: ${text}`, () => {
  const lettering = composeText(text, shaper, catalog);
  const pens = lettering.strokes.map(preparePen);
  const total = pens.reduce((sum, pen) => sum + pen.length, 0);
  const frames = Math.round(Math.max(4, Math.min(60, Math.round(total / 1750 * 2) / 2)) * 60);
  let previous: Uint8Array | undefined;
  for (let frame = 0; frame <= frames; frame++) {
    let remaining = total * frame / frames;
    const paths = pens.map(pen => { const d = penGeometry(pen, Math.max(0, Math.min(pen.length, remaining))); remaining -= pen.length; return d; });
    const pixels = raster(ink(paths), lettering.bounds, .1);
    if (text === 'hello' && frame > 0) {
      const width = Math.ceil((lettering.bounds[2] - lettering.bounds[0]) * .1);
      expect(inkComponents(pixels, width), `detached ink at frame ${frame}/${frames}`).toBe(1);
    }
    if (previous) {
      let erased = 0, written = 0;
      for (let i = 3; i < pixels.length; i += 4) { erased += Math.max(0, previous[i] - pixels[i]); written += previous[i]; }
      // Raster antialiasing can move a boundary by a fraction of a pixel.
      expect(erased / Math.max(1, written), `frame ${frame}/${frames}`).toBeLessThan(.002);
    }
    previous = pixels;
  }
}, 120_000);
