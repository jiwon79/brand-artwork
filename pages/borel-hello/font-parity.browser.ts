/** Run in the existing Chrome, e.g. /borel-hello/verify.html.
 * Uses the real FontFace, native fillText, and the production frame renderer.
 * Throws on even one changed final-frame byte; AA is not given a tolerance.
 */
import { composeText, supportedCharacter, type FontCatalog, type TextShaper } from './lettering';
import { paintFontFrame, prepareFontRaster, type FontRaster } from './renderer';

interface ParityResult { cases: number; frames: number; changedBytes: number; pixelsOutsideFont: number; lostAlpha: number; brokenHelloFrames: number; widestAdvanceError: number }

function reference(raster: FontRaster, lines: ReturnType<typeof composeText>['lines'], unitsPerEm: number): ImageData {
  const canvas = document.createElement('canvas'); canvas.width = raster.source.width; canvas.height = raster.source.height;
  const context = canvas.getContext('2d')!;
  // Intentionally independent of the production drawing code and its source image.
  context.font = `${unitsPerEm * raster.scale}px "Borel Handwriting"`;
  context.fontKerning = 'normal'; context.textBaseline = 'alphabetic'; context.fillStyle = '#6f4031';
  for (const line of lines) context.fillText(line.text, raster.offset[0] + line.origin[0] * raster.scale, raster.offset[1] + line.origin[1] * raster.scale);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

/** Ignore isolated antialias specks smaller than four pixels; actual stroke
 * components use 8-neighbour connectivity at alpha >= 64.
 */
function componentCount(data: Uint8ClampedArray, width: number, height: number, seen: Uint8Array, queue: Int32Array): number {
  seen.fill(0);
  let count = 0;
  for (let i = 0; i < seen.length; i++) if (data[i * 4 + 3] >= 64 && !seen[i]) {
    let head = 0, tail = 1; queue[0] = i; seen[i] = 1;
    while (head < tail) {
      const p = queue[head++], x = p % width, y = Math.floor(p / width);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy || x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) continue;
        const next = p + dy * width + dx;
        if (!seen[next] && data[next * 4 + 3] >= 64) { seen[next] = 1; queue[tail++] = next; }
      }
    }
    if (tail >= 4) count++;
  }
  return count;
}

export async function runFontParity(shaper: TextShaper, catalog: FontCatalog, report: (message: string) => void = () => { }): Promise<ParityResult> {
  const result: ParityResult = { cases: 0, frames: 0, changedBytes: 0, pixelsOutsideFont: 0, lostAlpha: 0, brokenHelloFrames: 0, widestAdvanceError: 0 };
  const characters = Object.keys(catalog.cmap).map(cp => String.fromCodePoint(Number(cp))).filter(c => supportedCharacter(c, catalog));
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const words = ['hello', 'name', 'won', 'name won', 'n', 'nn', 'an', 'na', 'w', 'ww', 'aw', 'wa', 'window', 'minimum', 'letter', 'tt', 'Hello World', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '0123456789', '!? & @ # $ % + =', '() [] {} < > / \\ | _ ~ ^ `', '., : ; " \' - – — …', '© ® ™ € £ ¥ ¢ × ÷ ± ° § ¶ •'];
  words.push('hello\nname won\n0123456789 !?', 'name\n\nwon', letters.repeat(3));
  const cases = [...new Set([...words, ...characters, ...[...letters].flatMap(a => [...letters].map(b => a + b))])];
  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = `${catalog.unitsPerEm}px "Borel Handwriting"`; measure.fontKerning = 'normal';
  const frameWords = new Set(['hello', 'name won', 'n', 'w', 'minimum', 'letter', '!? & @ # $ % + =']);
  for (const text of cases) {
    const lettering = composeText(text, shaper, catalog, text === letters.repeat(3) ? 2600 : 50000);
    for (const line of lettering.lines) {
      const advanceError = Math.abs(measure.measureText(line.text).width - line.advance);
      result.widestAdvanceError = Math.max(result.widestAdvanceError, advanceError);
      if (advanceError > .001) throw new Error(`Native/HarfBuzz advance mismatch for ${text}: ${advanceError}`);
    }
    for (const [width, height, ratio] of frameWords.has(text) ? [[560, 240, 1], [390, 280, 2]] : [[320, 180, 1]]) {
      const raster = prepareFontRaster(lettering, catalog, width, height, ratio, '#6f4031');
      const canvas = document.createElement('canvas'); canvas.width = raster.source.width; canvas.height = raster.source.height;
      const context = canvas.getContext('2d')!, output = context.createImageData(canvas.width, canvas.height);
      const expected = reference(raster, lettering.lines, catalog.unitsPerEm);
      paintFontFrame(context, raster, 1, output);
      const displayed = context.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 0; i < displayed.length; i++) if (displayed[i] !== expected.data[i]) result.changedBytes++;
      if (result.changedBytes) throw new Error(`Final pixel mismatch for ${text}: ${result.changedBytes} bytes`);
      if (frameWords.has(text)) {
        const previous = new Uint8ClampedArray(output.data.length);
        const seen = new Uint8Array(canvas.width * canvas.height), queue = new Int32Array(seen.length);
        for (let frame = 0; frame <= 360; frame++) {
          paintFontFrame(context, raster, frame / 360, output);
          for (let i = 3; i < output.data.length; i += 4) {
            if (output.data[i] > expected.data[i]) result.pixelsOutsideFont++;
            if (output.data[i] < previous[i]) result.lostAlpha++;
          }
          if (text === 'hello' && componentCount(output.data, canvas.width, canvas.height, seen, queue) > 1) result.brokenHelloFrames++;
          previous.set(output.data); result.frames++;
          if (frame % 120 === 0) await new Promise(resolve => setTimeout(resolve, 0));
        }
      }
      result.cases++;
    }
    if (result.cases % 25 === 0) { report(`${result.cases} cases · ${result.frames} frames`); await new Promise(resolve => setTimeout(resolve, 0)); }
  }
  if (result.pixelsOutsideFont || result.lostAlpha || result.brokenHelloFrames) throw new Error(JSON.stringify(result));
  report(JSON.stringify(result)); return result;
}
