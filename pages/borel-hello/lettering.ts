import { alphabet, type PenStroke, type Point } from './stroke-alphabet';

export type Matrix = readonly [number, number, number, number, number, number];
export type Bounds = readonly [number, number, number, number];
export interface GlyphRecord {
  name: string;
  advance: number;
  bounds?: Bounds;
  base?: string;
  dx?: number;
  components?: [number, Matrix][];
}
export interface FontCatalog { unitsPerEm: number; cmap: Record<string, number>; glyphs: GlyphRecord[] }
export interface ShapedGlyph { id: number; x: number; y: number; advance: number; outline: string }
export interface TextShaper { shape(text: string): ShapedGlyph[] }
interface GlyphInk { strokes: PenStroke[]; marks: PenStroke[]; entry?: Point; exit?: Point }
export interface Lettering { strokes: PenStroke[]; outlines: string[]; bounds: Bounds; lines: string[] }

export function transformPoint([x, y]: Point, [a, b, c, d, e, f]: Matrix): Point {
  return [a * x + c * y + e, b * x + d * y + f];
}

/** Authored paths use only absolute M/L/Q/C/Z commands, each with coordinate pairs. */
export function transformPath(path: string, matrix: Matrix): string {
  return path.replace(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?\s*,?\s*([-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?)/gi, pair => {
    const [x, y] = pair.match(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi)!.map(Number);
    return transformPoint([x, y], matrix).map(value => Number(value.toFixed(3))).join(' ');
  });
}

function pointBounds(paths: readonly PenStroke[]): Bounds {
  const xs: number[] = [], ys: number[] = [];
  for (const { d } of paths) {
    const values = d.match(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi)!.map(Number);
    for (let i = 0; i < values.length; i += 2) { xs.push(values[i]); ys.push(values[i + 1]); }
  }
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function moveInk(ink: GlyphInk, matrix: Matrix): GlyphInk {
  const widthScale = Math.sqrt(Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]));
  const move = (stroke: PenStroke): PenStroke => ({ d: transformPath(stroke.d, matrix), width: (stroke.width ?? 90) * widthScale });
  return {
    strokes: ink.strokes.map(move), marks: ink.marks.map(move),
    entry: ink.entry && transformPoint(ink.entry, matrix), exit: ink.exit && transformPoint(ink.exit, matrix),
  };
}

export function createGlyphResolver(catalog: FontCatalog) {
  const cache = new Map<number, GlyphInk>();
  const byName = new Map(catalog.glyphs.map(record => [record.name, record]));
  function resolve(id: number): GlyphInk {
    const cached = cache.get(id);
    if (cached) return cached;
    const record = catalog.glyphs[id];
    if (!record) throw new Error(`Unknown Borel glyph ${id}`);
    let ink: GlyphInk;
    if (record.components) {
      const children = record.components.map(([child, matrix]) => moveInk(resolve(child), matrix));
      const body = children.find(child => child.entry);
      ink = body ? {
        ...body, marks: [...body.marks, ...children.filter(child => child !== body).flatMap(child => [...child.strokes, ...child.marks])],
      } : { strokes: children.flatMap(child => [...child.strokes, ...child.marks]), marks: [] };
    } else if (record.base) {
      // Alternate uppercase forms are not enabled, but still have a drawable
      // interpretation. Contextual lowercase forms use registered body paths.
      const recipe = alphabet[record.base];
      if (!recipe) throw new Error(`Missing pen trajectory for ${record.name}`);
      let matrix: Matrix = [1, 0, 0, 1, record.dx ?? 0, 0];
      if (recipe.normalized) {
        const bounds = (byName.get(record.base)?.bounds ?? record.bounds)!;
        const markBounds = record.base.endsWith('.case') ? byName.get(record.base.slice(0, -5))?.bounds : undefined;
        const values = pointBounds(recipe.strokes);
        // Symbols are authored in a unit box; marks retain their source units.
        const source = markBounds ?? (Math.max(...values.map(Math.abs)) > 3 ? values : [0, 0, 1, 1]);
        const insetX = markBounds ? 0 : Math.min(45, (bounds[2] - bounds[0]) / 4);
        const insetY = markBounds ? 0 : Math.min(45, (bounds[3] - bounds[1]) / 4);
        const sx = (bounds[2] - bounds[0] - insetX * 2) / Math.max(.01, source[2] - source[0]);
        const sy = (bounds[3] - bounds[1] - insetY * 2) / Math.max(.01, source[3] - source[1]);
        matrix = [sx, 0, 0, sy, bounds[0] + insetX - source[0] * sx + (record.dx ?? 0), bounds[1] + insetY - source[1] * sy];
      }
      // Fit path coordinates, then set the pen width in font units. Fitting a
      // symbol's unit box must not scale its brush to hundreds of units wide.
      ink = {
        strokes: recipe.strokes.map(stroke => ({ ...stroke, d: transformPath(stroke.d, matrix) })), marks: [],
        entry: recipe.entry && transformPoint(recipe.entry, matrix), exit: recipe.exit && transformPoint(recipe.exit, matrix),
      };
      if (record.base === 'o' && !/\.(fina|isol)/.test(record.name)) {
        ink.strokes.push({ d: transformPath('M348 442.5 C418 442.5 446 372 552 347', matrix) });
        ink.exit = transformPoint([552, 347], matrix);
      }
    } else ink = { strokes: [], marks: [] }; // Spacing/control glyphs.
    cache.set(id, ink);
    return ink;
  }
  return resolve;
}

export function unsupportedCharacters(text: string, catalog: FontCatalog): string[] {
  return [...new Set([...text.normalize('NFC')].filter(character =>
    !['\n', '\r', '\t'].includes(character) && catalog.cmap[String(character.codePointAt(0))] === undefined,
  ))];
}

/** Wrap at words, or code points for a word longer than the available line. */
export function wrapText(text: string, shaper: TextShaper, maxWidth: number): string[] {
  const lines: string[] = [];
  const width = (value: string) => shaper.shape(value).reduce((sum, glyph) => sum + glyph.advance, 0);
  for (const paragraph of text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').normalize('NFC').split('\n')) {
    let line = '';
    for (const token of paragraph.match(/\S+|\s+/gu) ?? []) {
      if (line && width(line + token) > maxWidth && token.trim()) { lines.push(line.trimEnd()); line = ''; }
      for (const character of token) {
        // Combining marks stay attached to the preceding base at line breaks.
        if (line && width(line + character) > maxWidth && !/\p{M}/u.test(character)) { lines.push(line.trimEnd()); line = ''; }
        if (line || character.trim()) line += character;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

export function composeText(text: string, shaper: TextShaper, catalog: FontCatalog, maxWidth = 6200): Lettering {
  const missing = unsupportedCharacters(text, catalog);
  if (missing.length) throw new Error(`Borel에 없는 문자: ${missing.join(' ')}`);
  const resolve = createGlyphResolver(catalog);
  const lines = wrapText(text, shaper, maxWidth);
  const strokes: PenStroke[] = [], outlines: string[] = [];
  let maxAdvance = 0;
  for (const [lineIndex, line] of lines.entries()) {
    const shaped = shaper.shape(line);
    const advance = shaped.reduce((sum, glyph) => sum + glyph.advance, 0);
    maxAdvance = Math.max(maxAdvance, advance);
    const origin = (maxWidth - advance) / 2;
    let previous: Point | undefined;
    let pendingMarks: PenStroke[] = [];
    const flushMarks = () => { strokes.push(...pendingMarks); pendingMarks = []; };
    for (const glyph of shaped) {
      // Work directly in SVG coordinates after positioning the shaped glyph.
      const matrix: Matrix = [1, 0, 0, -1, origin + glyph.x, lineIndex * 1700 - glyph.y];
      const ink = moveInk(resolve(glyph.id), matrix);
      outlines.push(transformPath(glyph.outline, matrix));
      if (ink.entry && ink.exit) {
        const separation = previous ? Math.hypot(ink.entry[0] - previous[0], ink.entry[1] - previous[1]) : Infinity;
        if (previous && separation <= 4) {
          // Register almost coincident entries to the preceding pen endpoint.
          // This keeps the original hello curves and removes tiny seams caused
          // by reusing one canonical l at consecutive font advances.
          const first = ink.strokes[0];
          const start = first.d.match(/^M([-\d.]+) ([-\d.]+)/);
          if (start && Math.hypot(Number(start[1]) - ink.entry[0], Number(start[2]) - ink.entry[1]) < .01) {
            first.d = first.d.replace(/^M[-\d.]+ [-\d.]+/, `M${previous[0]} ${previous[1]}`);
          }
        } else if (previous) {
          const [x, y] = previous, [ex, ey] = ink.entry;
          const dx = ex - x;
          strokes.push({ d: `M${x} ${y} C${x + dx * .45} ${y} ${ex - dx * .25} ${ey + (y - ey) * .2} ${ex} ${ey}` });
        }
        strokes.push(...ink.strokes);
        pendingMarks.push(...ink.marks);
        previous = ink.exit;
      } else if (glyph.advance === 0 && ink.strokes.length) {
        pendingMarks.push(...ink.strokes, ...ink.marks);
      } else {
        flushMarks();
        previous = undefined;
        strokes.push(...ink.strokes, ...ink.marks);
      }
    }
    flushMarks();
  }
  // Include the complete trajectories and brush caps in the view box even if
  // a line contains only dots, descenders, marks, or wide symbols.
  const bounds = strokes.length ? pointBounds(strokes) : [maxWidth / 2 - 500, -900, maxWidth / 2 + 500, 500];
  const center = maxWidth / 2;
  const half = Math.max(maxAdvance / 2 + 160, center - bounds[0] + 160, bounds[2] - center + 160, 600);
  return { strokes, outlines, lines, bounds: [center - half, bounds[1] - 180, center + half, bounds[3] + 180] };
}
