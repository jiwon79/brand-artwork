import { expect, test } from 'vitest';
import { gradientPieces, gradientPieceGeometry } from './gradient-ink';
import { cubic, preparePen, type PenPoint } from './pen-geometry';
import { catalog, raster, supportedGlyphWitnesses, textForegroundIoU } from './test-font';

const forms = [...supportedGlyphWitnesses()].filter(([id]) => catalog.glyphs[id].name.split('.')[0] === 'h');
// A high entry after b/o/v/w crosses the shoulder instead of following it.
const tangentForms = forms.filter(([id]) => !catalog.glyphs[id].name.includes('cv02'));

function atHeight(points: PenPoint[], y: number) {
  const i = points.findIndex((p, i) => i > 0 && points[i - 1].y <= y && p.y >= y);
  if (i < 0) throw new Error(`No upward crossing at ${y}`);
  const a = points[i - 1], b = points[i], t = (y - a.y) / (b.y - a.y);
  return { x: a.x + (b.x - a.x) * t, radius: a.radius + (b.radius - a.radius) * t };
}

function shoulderPasses(points: PenPoint[]) {
  const top = points.findIndex(p => p.y > 850);
  const bottom = points.findIndex((p, i) => i > top && p.y < 55);
  const shoulder = points.findIndex((p, i) => i > bottom && p.y > 415);
  return { incoming: points.slice(0, top), returning: points.slice(bottom, shoulder + 1), bottom };
}

function cubicCurves(d: string): number[][] {
  const commands = d.match(/[MC][^MC]*/g)!.map(command => command.slice(1).match(/[-+]?(?:\d*\.)?\d+/g)!.map(Number));
  return commands.slice(1).map((command, i) => [...commands[i].slice(-2), ...command]);
}

function curveTangent(c: number[], t: number) {
  const p = [c.slice(0, 2), c.slice(2, 4), c.slice(4, 6), c.slice(6)];
  const v = [0, 1].map(i => 3 * ((1-t)**2 * (p[1][i]-p[0][i]) + 2*(1-t)*t * (p[2][i]-p[1][i]) + t*t * (p[3][i]-p[2][i])));
  return v.map(value => value / Math.hypot(...v));
}

function curveCurvature(c: number[], t: number) {
  const p = [c.slice(0, 2), c.slice(2, 4), c.slice(4, 6), c.slice(6)];
  const v = [0, 1].map(i => 3 * ((1-t)**2 * (p[1][i]-p[0][i]) + 2*(1-t)*t * (p[2][i]-p[1][i]) + t*t * (p[3][i]-p[2][i])));
  const a = [0, 1].map(i => 6 * ((1-t) * (p[2][i]-2*p[1][i]+p[0][i]) + t * (p[3][i]-2*p[2][i]+p[1][i])));
  return (v[0] * a[1] - v[1] * a[0]) / Math.hypot(...v) ** 3;
}

/** Earlier red ink must not survive along the inside edge of the blue arch.
 * The region excludes the separate vertical stem and actual upper-loop fork.
 * This checks color ownership, which final silhouette IoU cannot distinguish.
 */
function exposedEarlierInk(body: string, returning: PenPoint[], weight: number) {
  const left = Math.floor(returning[0].x), bounds = [left, 335, left + 220, 375] as const;
  const scale = 2, pixels = raster(body, bounds, scale), width = 440;
  let exposed = 0;
  for (let row = 0; row < 80; row++) {
    const y = 335 + (row + .5) / scale, edge = atHeight(returning, y);
    for (let col = 0; col < width; col++) {
      const x = left + (col + .5) / scale;
      if (x < edge.x + edge.radius * weight * .7 || x > edge.x + edge.radius * weight + 20) continue;
      const p = (row * width + col) * 4;
      if (pixels[p + 3] > 192 && pixels[p] > 128 && pixels[p + 2] < 100) exposed++;
    }
  }
  return exposed / scale ** 2;
}

for (const [id, witness] of tangentForms) test(`independent h curves meet tangentially without exposed earlier ink: ${catalog.glyphs[id].name}`, () => {
  const strokes = catalog.penPaths![id], pen = preparePen(strokes[0]);
  const { incoming, returning, bottom } = shoulderPasses(pen.points);
  for (const y of [330, 340, 350, 360, 370, 380, 390]) {
    const first = atHeight(incoming, y), last = atHeight(returning, y);
    // The later arch stays on the right of the old path and touches it once.
    // Forcing the two complete arcs to coincide would distort their shapes.
    expect(last.x - first.x, `inside edge at y=${y}`).toBeGreaterThan(-.2);
    expect(first.radius, `nib at y=${y}`).toBeCloseTo(last.radius, 6);
  }
  const pieces = gradientPieces([pen])[0], turn = pen.points[bottom].distance;
  for (const weight of [.5, 1, 1.5]) {
    const body = pieces.map(piece => `<path fill="${piece.start < turn ? '#ff0000' : '#0000ff'}" d="${gradientPieceGeometry(piece, pen.length, 1, weight)}"/>`).join('');
    expect(exposedEarlierInk(body, returning, weight), `exposed old color at weight ${weight}`).toBeLessThan(1);
  }
  expect(strokes).toHaveLength(1);
  expect(strokes[0].ordered && !strokes[0].retrace).toBe(true);
  expect(strokes[0].widths!.length).toBeLessThanOrEqual(8);
  expect(textForegroundIoU(witness)).toBeGreaterThanOrEqual(.95);
  const curves = cubicCurves(strokes[0].d);
  expect(new Set(curves.map(c => JSON.stringify(c))).size).toBe(curves.length);
  const first = curves.find(c => c[1] < 360 && c[7] > 360)!;
  let low = 0, high = 1;
  for (let i = 0; i < 50; i++) {
    const t = (low + high) / 2;
    if (cubic(first[1], first[3], first[5], first[7], t) < 360) low = t;
    else high = t;
  }
  const t = (low + high) / 2;
  const contact = curves.findIndex(c => Math.abs(c[7] - 360) < .0001);
  expect(contact).toBeGreaterThan(0);
  const a = curves[contact], b = curves[contact + 1], tangent = curveTangent(first, t);
  expect(a[6]).toBeCloseTo(cubic(first[0], first[2], first[4], first[6], t), 6);
  for (const [i, direction] of tangent.entries()) {
    expect(curveTangent(a, 1)[i]).toBeCloseTo(direction, 7);
    expect(curveTangent(b, 0)[i]).toBeCloseTo(direction, 7);
  }
  // The arch itself is smooth through the contact, while the first pass has
  // its own curvature: these are independent tangent curves, not a shared arc.
  expect(curveCurvature(a, 1)).toBeCloseTo(curveCurvature(b, 0), 7);
  expect(Math.abs(curveCurvature(first, t) - curveCurvature(a, 1))).toBeGreaterThan(.001);
});

test('tangent fitting preserves the original, approved upward entry instead of bending it toward the arch', () => {
  // Samples of the previous ascender, before any overlap correction. These
  // catch the failed approach that refitted the first pass to the later arch.
  const original: Record<string, number[]> = {
    h: [219.112, 246.7517, 281.6916, 314.8389, 371.387, 430.3013],
    'h.fina': [217.8155, 243.064, 278.2951, 314.0195, 372.9984, 430.538],
    'h.fina.cv01': [178.6309, 211.9252, 247.0001, 281.6204, 343.1086, 399.9728],
    'h.fina.cv03': [85.9169, 120.8608, 155.3645, 191.3375, 256.2092, 310.0017],
    'h.init': [87.166, 151.3704, 197.9641, 236.1705, 296.2185, 354.1826],
    'h.isol': [84.8822, 149.5803, 197.1422, 236.0086, 296.4906, 353.9718],
    'h.medi.cv01': [178.5341, 212.089, 247.1046, 281.7429, 343.1835, 399.824],
    'h.medi.cv03': [86.528, 121.0715, 155.1421, 190.7833, 256.2174, 310.0779],
  };
  for (const [id] of tangentForms) {
    const name = catalog.glyphs[id].name;
    const { incoming } = shoulderPasses(preparePen(catalog.penPaths![id][0]).points);
    for (const [i, y] of [250, 300, 350, 400, 500, 650].entries()) {
      expect(Math.abs(atHeight(incoming, y).x - original[name][i]), `${name} at y=${y}`).toBeLessThan(.2);
    }
  }
});

test('the color-overlap detector rejects a small sideways offset despite almost identical silhouettes', () => {
  const returning = preparePen({ d: 'M100 300L100 420', width: 88 }).points;
  const shifted = '<path d="M108 300V420" stroke="red" stroke-width="88"/>';
  const aligned = '<path d="M100 300V420" stroke="red" stroke-width="88"/>';
  const repaint = '<path d="M100 300V420" stroke="blue" stroke-width="88"/>';
  expect(exposedEarlierInk(shifted + repaint, returning, 1)).toBeGreaterThan(200);
  expect(exposedEarlierInk(aligned + repaint, returning, 1)).toBe(0);
  expect(forms).toHaveLength(10);
  expect(tangentForms).toHaveLength(8);
});
