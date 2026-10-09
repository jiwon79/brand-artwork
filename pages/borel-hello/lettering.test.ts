import { expect, test } from 'vitest';
import { svgPathProperties } from 'svg-path-properties';
import { catalog, shaper } from './test-font';
import { composeText, createGlyphResolver, transformPath, unsupportedCharacters } from './lettering';

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
    if (unsupportedCharacters(character, catalog).length) continue;
    const result = composeText(character, shaper, catalog);
    expect(result.bounds.every(Number.isFinite), character).toBe(true);
  }
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  for (const a of letters) for (const b of letters) {
    const result = composeText(a + b, shaper, catalog);
    // Two letters may now form one continuous writing run. Check that both
    // shaped forms survive rather than requiring an artificial pen lift.
    expect(result.strokes.length, a + b).toBeGreaterThan(0);
    expect(result.outlines.length, a + b).toBe(shaper.shape(a + b).length);
    expect(result.strokes.reduce((sum, stroke) => sum + (stroke.d.match(/C/g)?.length ?? 0), 0), a + b).toBeGreaterThanOrEqual(2);
  }
});

test('accented letters and combining accents are outside the supported scope', () => {
  for (const text of ['café', 'Élève', 'Tiếng Việt', 'Ångström', 'İstanbul', 'e\u0301']) {
    expect(unsupportedCharacters(text, catalog).length).toBeGreaterThan(0);
    expect(() => composeText(text, shaper, catalog)).toThrow('지원하지 않는 문자');
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
  expect(() => composeText('안녕', shaper, catalog)).toThrow('지원하지 않는 문자');
  expect(composeText('', shaper, catalog).strokes).toEqual([]);
});

test('coordinates and curves survive rotation, reflection, and translation', () => {
  expect(transformPath('M1 2 C3 4 5 6 7 8 Q9 10 11 12 L13 14 Z', [0, -1, 1, 0, 20, 30]))
    .toBe('M22 29 C24 27 26 25 28 23 Q30 21 32 19 L34 17 Z');
});

test('supported text selects independent cubic paths for its contextual glyphs', () => {
  for (const text of ['hello', 'name won', 'attb', 'atttta', '0123456789!?']) {
    const result = composeText(text, shaper, catalog);
    for (const stroke of result.strokes) {
      expect(stroke.d).toMatch(/^M/);
      expect(stroke.d).toContain('C');
      expect(stroke.widths?.length).toBe(stroke.d.match(/C/g)?.length);
      expect(stroke.d).not.toMatch(/[QAZ]/);
    }
  }
});
