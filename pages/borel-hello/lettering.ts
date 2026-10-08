export type Point = readonly [number, number];
export type Matrix = readonly [number, number, number, number, number, number];
export type Bounds = readonly [number, number, number, number];
export interface GlyphRecord { name: string; advance: number; bounds?: Bounds }
export interface FontCatalog { unitsPerEm: number; cmap: Record<string, number>; glyphs: GlyphRecord[] }
export interface ShapedGlyph { id: number; x: number; y: number; advance: number; outline: string }
export interface TextShaper { shape(text: string): ShapedGlyph[] }
export interface PositionedGlyph extends ShapedGlyph { origin: Point }
export interface TextLine { text: string; origin: Point; advance: number }
export interface Lettering { glyphs: PositionedGlyph[]; outlines: string[]; bounds: Bounds; lines: TextLine[] }

export function transformPoint([x, y]: Point, [a, b, c, d, e, f]: Matrix): Point {
  return [a * x + c * y + e, b * x + d * y + f];
}

/** HarfBuzz returns absolute M/L/Q/C/Z commands with coordinate pairs. */
export function transformPath(path: string, matrix: Matrix): string {
  return path.replace(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?\s*,?\s*([-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?)/gi, pair => {
    const [x, y] = pair.match(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi)!.map(Number);
    return transformPoint([x, y], matrix).map(String).join(' ');
  });
}

/** English alphabet and the font's punctuation/symbols; accents are out of scope. */
export function supportedCharacter(character: string, catalog: FontCatalog): boolean {
  const codepoint = character.codePointAt(0)!;
  return catalog.cmap[String(codepoint)] !== undefined &&
    (codepoint >= 32 && codepoint <= 126 || !/[\p{L}\p{M}\p{C}\p{Z}]/u.test(character));
}

export function unsupportedCharacters(text: string, catalog: FontCatalog): string[] {
  return [...new Set([...text].filter(character =>
    !['\n', '\r', '\t'].includes(character) && !supportedCharacter(character, catalog),
  ))];
}

/** Wrap at words, or code points for a word longer than the available line. */
export function wrapText(text: string, shaper: TextShaper, maxWidth: number): string[] {
  const lines: string[] = [];
  const width = (value: string) => shaper.shape(value).reduce((sum, glyph) => sum + glyph.advance, 0);
  for (const paragraph of text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n')) {
    let line = '';
    for (const token of paragraph.match(/\S+|\s+/gu) ?? []) {
      if (line && width(line + token) > maxWidth && token.trim()) { lines.push(line.trimEnd()); line = ''; }
      for (const character of token) {
        if (line && width(line + character) > maxWidth) { lines.push(line.trimEnd()); line = ''; }
        if (line || character.trim()) line += character;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

/** Layout uses the font's substitutions, advances and offsets without modification. */
export function composeText(text: string, shaper: TextShaper, catalog: FontCatalog, maxWidth = 6200): Lettering {
  const missing = unsupportedCharacters(text, catalog);
  if (missing.length) throw new Error(`지원하지 않는 문자: ${missing.join(' ')}`);
  const glyphs: PositionedGlyph[] = [], outlines: string[] = [], lines: TextLine[] = [];
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const [lineIndex, line] of wrapText(text, shaper, maxWidth).entries()) {
    const shaped = shaper.shape(line);
    const advance = shaped.reduce((sum, glyph) => sum + glyph.advance, 0);
    const origin: Point = [(maxWidth - advance) / 2, lineIndex * 1700];
    lines.push({ text: line, origin, advance });
    for (const glyph of shaped) {
      glyphs.push({ ...glyph, origin });
      const x = origin[0] + glyph.x, y = origin[1] - glyph.y;
      outlines.push(transformPath(glyph.outline, [1, 0, 0, -1, x, y]));
      const bounds = catalog.glyphs[glyph.id].bounds;
      if (bounds) {
        left = Math.min(left, x + bounds[0]); top = Math.min(top, y - bounds[3]);
        right = Math.max(right, x + bounds[2]); bottom = Math.max(bottom, y - bounds[1]);
      }
    }
  }
  if (!Number.isFinite(left)) [left, top, right, bottom] = [maxWidth / 2 - 500, -900, maxWidth / 2 + 500, 500];
  return { glyphs, outlines, lines, bounds: [left - 160, top - 180, right + 160, bottom + 180] };
}
