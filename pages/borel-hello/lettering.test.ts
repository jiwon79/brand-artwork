import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import * as hb from 'harfbuzzjs';
import opentype from 'opentype.js';
import { composeText, transformPath, unsupportedCharacters, supportedCharacter, type FontCatalog, type TextShaper } from './lettering';

const assets = new URL('./assets/', import.meta.url);
const catalog = JSON.parse(readFileSync(new URL('font-catalog.json', assets), 'utf8')) as FontCatalog;
const bytes = readFileSync(new URL('Borel-Regular.ttf', assets));
const independentFont = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const font = new hb.Font(new hb.Face(new hb.Blob(bytes)));
const buffer = new hb.Buffer();
const shaper: TextShaper = {
  shape(text) {
    buffer.reset(); buffer.addText(text); buffer.guessSegmentProperties(); hb.shape(font, buffer);
    const positions = buffer.getGlyphPositions();
    let x = 0;
    return buffer.getGlyphInfos().map((info, i) => {
      const p = positions[i];
      const glyph = { id: info.codepoint, x: x + p.xOffset, y: p.yOffset, advance: p.xAdvance, outline: font.glyphToPath(info.codepoint) };
      x += p.xAdvance;
      return glyph;
    });
  },
};

// Contours may start at another node. Compare their directed segments rather
// than serialization, keeping every original endpoint and quadratic control.
function segments(path: string): string[] {
  let point = [0, 0], start = point;
  const result: string[] = [];
  for (const command of path.match(/[MLQCZ][^MLQCZ]*/g) ?? []) {
    const type = command[0], values = (command.slice(1).match(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number);
    if (type === 'M') { point = values; start = values; continue; }
    if (type === 'Z') { if (point[0] !== start[0] || point[1] !== start[1]) result.push(JSON.stringify(['L', ...point, ...start])); point = start; }
    else { const end = values.slice(-2); if (type !== 'L' || point[0] !== end[0] || point[1] !== end[1]) result.push(JSON.stringify([type, ...point, ...values])); point = end; }
  }
  return result.sort();
}

const letters = 'abcdefghijklmnopqrstuvwxyz';
const singleCharacters = Object.keys(catalog.cmap).map(cp => String.fromCodePoint(Number(cp))).filter(c => supportedCharacter(c, catalog));
const reachable = new Set<number>();
for (const c of singleCharacters) shaper.shape(c).forEach(g => reachable.add(g.id));
for (const a of letters) for (const b of letters) for (const c of letters) shaper.shape(a + b + c).forEach(g => reachable.add(g.id));

test('every reachable unaccented glyph has exactly the source font outline, using an independent TTF parser', () => {
  for (const id of reachable) {
    const glyph = independentFont.glyphs.get(id);
    // The v2 parser supports output options; the older DefinitelyTyped signature
    // accepts a decimal count only. Numeric 3 disables Y reflection in both.
    expect(segments(font.glyphToPath(id)), catalog.glyphs[id].name).toEqual(segments(glyph.path.toPathData(3)));
    expect(catalog.glyphs[id].advance, catalog.glyphs[id].name).toBe(glyph.advanceWidth);
  }
});

test.each(['hello', 'name', 'won', 'name won', 'n', 'nn', 'an', 'na', 'w', 'ww', 'aw', 'wa', 'window', 'minimum', 'tt', 'letter', 'Hello World', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '0123456789', ...singleCharacters])('layout preserves shaped glyphs, outlines and advances: %s', text => {
  const expected = shaper.shape(text.trim());
  const actual = composeText(text, shaper, catalog, 50000);
  expect(actual.glyphs.map(({ origin: _origin, ...glyph }) => glyph)).toEqual(expected);
  const advance = expected.reduce((sum, g) => sum + g.advance, 0);
  expect(actual.lines[0].advance).toBe(advance);
  for (const [i, glyph] of expected.entries()) {
    expect(actual.outlines[i]).toBe(transformPath(glyph.outline, [1, 0, 0, -1, (50000 - advance) / 2 + glyph.x, -glyph.y]));
  }
});

test('initial, connected and final n/w use distinct source font variants', () => {
  for (const letter of ['n', 'w']) {
    const ids = ['' + letter, letter + 'a', 'a' + letter + 'a', 'a' + letter].map(word => {
      const shaped = shaper.shape(word);
      return shaped[word.startsWith('a') ? 1 : 0].id;
    });
    expect(new Set(ids).size, letter).toBe(4);
    const result = composeText('name won', shaper, catalog);
    expect(result.glyphs.map(g => catalog.glyphs[g.id].name)).toEqual(shaper.shape('name won').map(g => catalog.glyphs[g.id].name));
  }
});

test('all 676 lowercase pairs preserve the original font geometry and fit within the view box', () => {
  for (const a of letters) for (const b of letters) {
    const result = composeText(a + b, shaper, catalog);
    expect(result.bounds.every(Number.isFinite)).toBe(true);
    for (const glyph of result.glyphs) {
      expect(glyph.outline).toBe(font.glyphToPath(glyph.id));
      const bounds = catalog.glyphs[glyph.id].bounds!;
      expect(glyph.origin[0] + glyph.x + bounds[0]).toBeGreaterThan(result.bounds[0]);
      expect(glyph.origin[0] + glyph.x + bounds[2]).toBeLessThan(result.bounds[2]);
    }
  }
});

test('wrapping reshapes each complete line, preserving blank lines and long words', () => {
  const result = composeText('hello\n\nabcdefghijklmnopqrstuvwxyz', shaper, catalog, 2600);
  expect(result.lines.slice(0, 2).map(line => line.text)).toEqual(['hello', '']);
  expect(result.lines.slice(2).map(line => line.text).join('')).toBe(letters);
  for (const line of result.lines) expect(line.advance).toBe(shaper.shape(line.text).reduce((sum, g) => sum + g.advance, 0));
  expect(result.bounds[3]).toBeGreaterThan(1700);
});

test('accents and unsupported Unicode are explicitly excluded', () => {
  expect(unsupportedCharacters('café e\u0301 안녕 😀', catalog)).toEqual(['é', '\u0301', '안', '녕', '😀']);
  expect(() => composeText('café', shaper, catalog)).toThrow('지원하지 않는 문자');
  expect(composeText('', shaper, catalog).glyphs).toEqual([]);
});

test('coordinates and curves survive rotation, reflection and translation without rounding', () => {
  expect(transformPath('M1 2 C3 4 5 6 7 8 Q9 10 11 12 L13 14 Z', [0, -1, 1, 0, 20, 30]))
    .toBe('M22 29 C24 27 26 25 28 23 Q30 21 32 19 L34 17 Z');
  expect(transformPath('M0.125 0.0625', [1, 0, 0, 1, 0, 0])).toBe('M0.125 0.0625');
});
