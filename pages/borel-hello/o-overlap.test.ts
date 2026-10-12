import { expect, test } from 'vitest';
import { preparePen, penGeometry, type PenPoint } from './pen-geometry';
import { catalog, raster, supportedGlyphWitnesses, textForegroundIoU } from './test-font';

const forms = [...supportedGlyphWitnesses()].filter(([id]) => catalog.glyphs[id].name.split('.')[0] === 'o');
const ascendingForms = forms.filter(([id]) => !/cv02|init|isol/.test(catalog.glyphs[id].name));

function xAt(points: PenPoint[], y: number) {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (y < Math.min(a.y, b.y) || y > Math.max(a.y, b.y)) continue;
    const t = (y - a.y) / (b.y - a.y);
    return a.x + (b.x - a.x) * t;
  }
  throw new Error(`Missing bowl crossing at ${y}`);
}

function passes(id: number) {
  const stroke = catalog.penPaths![id][0], commands = stroke.d.match(/[MC][^MC]*/g)!;
  const top = commands[2].match(/-?\d+(?:\.\d+)?/g)!.slice(-2).join(' ');
  return {
    ascending: preparePen({ ...stroke, d: commands.slice(0, 3).join(' '), widths: stroke.widths!.slice(0, 2) }),
    bowl: preparePen({ ...stroke, d: `M${top} ${commands.slice(3).join(' ')}`, widths: stroke.widths!.slice(2) }),
  };
}

function oldColorArea(ascending: ReturnType<typeof preparePen>, bowl: ReturnType<typeof preparePen>, weight: number) {
  const points = bowl.points, bottom = points.findIndex(p => p.y < 35), returning = points.slice(0, bottom + 1);
  const left = Math.floor(Math.min(...points.map(p => p.x))) - 90, bounds = [left, 150, left + 350, 420] as const;
  const scale = 2, width = 700;
  const pixels = raster(`<path fill="red" d="${penGeometry(ascending, ascending.length, 1, weight)}"/><path fill="blue" d="${penGeometry(bowl, bowl.length, 1, weight)}"/>`, bounds, scale);
  let area = 0;
  for (let row = 0; row < 540; row++) {
    const y = 150 + (row + .5) / scale, edge = xAt(returning, y) + points[0].radius * weight;
    for (let col = 0; col < width; col++) {
      const x = left + (col + .5) / scale, p = (row * width + col) * 4;
      if (x > edge - .5 && x < edge + 30 && pixels[p + 3] > 192 && pixels[p] > 128 && pixels[p + 2] < 100) area++;
    }
  }
  return area / scale ** 2;
}

for (const [id, witness] of ascendingForms) test(`o returning bowl covers earlier ink: ${catalog.glyphs[id].name}`, () => {
  const { ascending, bowl } = passes(id), bottom = bowl.points.findIndex(p => p.y < 35);
  for (const y of [150, 175, 200, 225, 250, 300, 350, 400, 415]) {
    expect(xAt(ascending.points, y) - xAt(bowl.points.slice(0, bottom + 1), y), `inner edge at ${y}`).toBeLessThan(.25);
  }
  for (const weight of [.5, 1, 1.5]) expect(oldColorArea(ascending, bowl, weight), `old ink at weight ${weight}`).toBeLessThan(1);
  expect(textForegroundIoU(witness)).toBeGreaterThanOrEqual(.95);
});

test('the inner-edge test detects displaced old ink even when the final outline barely changes', () => {
  const { ascending, bowl } = passes(ascendingForms[0][0]);
  const displaced = { ...ascending, points: ascending.points.map(p => ({ ...p, x: p.x + 12 })) };
  expect(oldColorArea(displaced, bowl, 1)).toBeGreaterThan(100);
  expect(forms).toHaveLength(10);
  expect(ascendingForms).toHaveLength(6);
});

for (const text of ['hello', 'jiwon', 'on', 'no', 'love', 'follow', 'my lovely world']) test(`o correction retains source ink: ${text}`, () => {
  expect(textForegroundIoU(text)).toBeGreaterThanOrEqual(.95);
});
