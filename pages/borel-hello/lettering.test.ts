import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import * as hb from 'harfbuzzjs';
import { svgPathProperties } from 'svg-path-properties';
import { composeText, createGlyphResolver, transformPath, unsupportedCharacters, type FontCatalog, type TextShaper } from './lettering';

const assets = new URL('./assets/', import.meta.url);
const catalog = JSON.parse(readFileSync(new URL('font-catalog.json', assets), 'utf8')) as FontCatalog;
const font = new hb.Font(new hb.Face(new hb.Blob(readFileSync(new URL('Borel-Regular.ttf', assets)))));
const buffer = new hb.Buffer();
const shaper: TextShaper = {
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

test('every drawable glyph in the licensed font has finite, nonempty pen trajectories', () => {
  const resolve = createGlyphResolver(catalog);
  for (const [id, glyph] of catalog.glyphs.entries()) {
    const ink = resolve(id);
    const strokes = [...ink.strokes, ...ink.marks];
    if (glyph.bounds) expect(strokes.length, glyph.name).toBeGreaterThan(0);
    for (const stroke of strokes) {
      const length = new svgPathProperties(stroke.d).getTotalLength();
      expect(Number.isFinite(length), `${glyph.name}: ${stroke.d}`).toBe(true);
      expect(length, glyph.name).toBeGreaterThan(0);
    }
  }
});

test('all encoded characters and contextual lowercase pairs compose without missing shapes', () => {
  for (const codepoint of Object.keys(catalog.cmap)) {
    const character = String.fromCodePoint(Number(codepoint));
    const result = composeText(character, shaper, catalog);
    expect(result.bounds.every(Number.isFinite), character).toBe(true);
  }
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  for (const a of letters) for (const b of letters) {
    const result = composeText(a + b, shaper, catalog);
    expect(result.strokes.length, a + b).toBeGreaterThan(1);
  }
});

test('equivalent precomposed and decomposed accents produce the same lettering', () => {
  for (const word of ['café', 'Élève', 'Tiếng Việt', 'Ångström', 'İstanbul']) {
    expect(composeText(word.normalize('NFD'), shaper, catalog)).toEqual(composeText(word, shaper, catalog));
  }
});

test('line wrapping and explicit blank lines retain the complete input', () => {
  const result = composeText('hello\n\nabcdefghijklmnopqrstuvwxyz', shaper, catalog, 2600);
  expect(result.lines.slice(0, 2)).toEqual(['hello', '']);
  expect(result.lines.slice(2).join('')).toBe('abcdefghijklmnopqrstuvwxyz');
  expect(result.lines.length).toBeGreaterThan(3);
  expect(result.bounds[3]).toBeGreaterThan(1700);
});

test('unsupported Unicode is identified before layout and cannot silently become a placeholder', () => {
  expect(unsupportedCharacters('hello 안녕 😀 안', catalog)).toEqual(['안', '녕', '😀']);
  expect(() => composeText('안녕', shaper, catalog)).toThrow('Borel에 없는 문자');
  expect(composeText('', shaper, catalog).strokes).toEqual([]);
});

test('coordinates and curves survive rotation, reflection, and translation', () => {
  expect(transformPath('M1 2 C3 4 5 6 7 8 Q9 10 11 12 L13 14 Z', [0, -1, 1, 0, 20, 30]))
    .toBe('M22 29 C24 27 26 25 28 23 Q30 21 32 19 L34 17 Z');
});

test('hello retains the verified trajectories through both l crossings', () => {
  const original = ["M54 353 C132 316 189 213 189 125 C189 49 96 45 96 130", "M96 130 L96 440", "M96 374 C103 303 143 273 173 273 C205 273 224 296 224 333 L224 375 C224 429 243 429 268 429", "M268 429 C315 429 368 395 401 356 C439 312 418 263 375 263", "M375 263 C319 263 305 340 342 395 C359 420 384 429 405 429", "M405 429 C480 429 554 365 593 275 C613 228 613 179 611 142", "M611 142 C610 36 512 47 512 133 L512 324 C512 393 522 429 581 429", "M581 429 C657 429 731 365 770 275 C790 228 790 179 788 142", "M788 142 C787 36 689 47 689 133 L689 324 C689 393 699 429 758 429", "M758 429 C804 429 832 402 854 375", "M854 375 C847 326 870 263 930 263 C979 263 1005 299 1005 346 C1005 397 976 429 930 429 C880 429 854 397 854 345"];
  const current = composeText('hello', shaper, catalog);
  expect(current.strokes).toHaveLength(11);
  const advance = shaper.shape('hello').reduce((sum, glyph) => sum + glyph.advance, 0);
  const origin = (6200 - advance) / 2;
  for (const [index, path] of original.entries()) {
    const expected = new svgPathProperties(transformPath(path, [2.5, 0, 0, 2.5, origin - 100, -1100]));
    const actual = new svgPathProperties(current.strokes[index].d);
    for (let sample = 0; sample <= 100; sample++) {
      const a = actual.getPointAtLength(actual.getTotalLength() * sample / 100);
      const b = expected.getPointAtLength(expected.getTotalLength() * sample / 100);
      // The repeated l reuses one canonical letter: registration differs by at
      // most 3 font units (1.2 units in the original SVG). Its curve is retained.
      expect(Math.hypot(a.x - b.x, a.y - b.y), 'stroke ' + index + ', sample ' + sample).toBeLessThanOrEqual(3.1);
    }
  }
});
