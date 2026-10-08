import { readFileSync } from 'node:fs';
import * as hb from 'harfbuzzjs';
import { Resvg } from '@resvg/resvg-js';
import type { Bounds, FontCatalog, TextShaper } from './lettering';

const assets = new URL('./assets/', import.meta.url);
export const catalog: FontCatalog = {
  ...JSON.parse(readFileSync(new URL('font-catalog.json', assets), 'utf8')),
  penPaths: JSON.parse(readFileSync(new URL('pen-paths.json', assets), 'utf8')),
};
export const font = new hb.Font(new hb.Face(new hb.Blob(readFileSync(new URL('Borel-Regular.ttf', assets)))));
const buffer = new hb.Buffer();
export const shaper: TextShaper = {
  shape(text) {
    buffer.reset(); buffer.addText(text); buffer.guessSegmentProperties(); hb.shape(font, buffer);
    const positions = buffer.getGlyphPositions();
    let x = 0;
    return buffer.getGlyphInfos().map((info, i) => {
      const position = positions[i];
      const glyph = { id: info.codepoint, x: x + position.xOffset, y: position.yOffset, advance: position.xAdvance, outline: font.glyphToPath(info.codepoint) };
      x += position.xAdvance;
      return glyph;
    });
  },
};

export function raster(body: string, bounds: Bounds, scale = .35): Uint8Array {
  const [left, top, right, bottom] = bounds;
  const width = Math.ceil((right - left) * scale), height = Math.ceil((bottom - top) * scale);
  return new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${left} ${top} ${right - left} ${bottom - top}">${body}</svg>`, { font: { loadSystemFonts: false } }).render().pixels;
}

/** Soft-alpha foreground IoU: empty background contributes nothing. */
export function foregroundIoU(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) throw new Error('Raster dimensions differ');
  let intersection = 0, union = 0;
  for (let i = 3; i < a.length; i += 4) {
    intersection += Math.min(a[i], b[i]);
    union += Math.max(a[i], b[i]);
  }
  return union ? intersection / union : 1;
}
