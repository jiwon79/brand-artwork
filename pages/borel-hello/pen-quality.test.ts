import { expect, test } from 'vitest';
import { composeText, createGlyphResolver, transformPath } from './lettering';
import { penGeometry, preparePen } from './pen-geometry';
import { routeWord } from './pen-routing';
import type { PenStroke } from './stroke-alphabet';
import { catalog, raster, shaper, supportedGlyphWitnesses } from './test-font';
import { auditPen, inkTravelPasses, measureInkTravel, missingNibInterior, type PenIssue } from './test-pen-quality';

const smooth: PenStroke = { d: 'M0 0 C100 0 150 -100 250 -100 C350 -100 400 0 500 0', width: 20 };
const bulge: PenStroke = {
  d: 'M0 0 C40 0 80 0 120 0 C130 0 140 0 150 0 C160 0 170 0 180 0 C220 0 260 0 300 0',
  widths: [[20,20,20,20],[20,20,34,34],[34,34,20,20],[20,20,20,20]],
};

test('a local nib bulge is detected even on a perfectly smooth center curve', () => {
  const issues = auditPen([bulge]);
  expect(issues.map(issue => issue.kind)).toEqual(['width-bulge']);
  expect(issues[0].value).toBeGreaterThan(1.65);
  expect(issues[0].point[0]).toBeGreaterThan(145);
  expect(issues[0].point[0]).toBeLessThan(155);
});

test('the measured my crossing flags both nib inflation and a direction break', () => {
  // A compact reproduction of the first m.init crossing reported at frame
  // 22. Keep the bad fixture independent of future edits to the live glyph.
  const crossing: PenStroke[] = [{
    d: 'M286.498 398 C290.951 388.964 294.276 378.864 297.668 370 C299.42 365.418 302.042 361.705 304.333 358 C308.635 351.039 311.588 345.49 317 340',
    widths: [[88.657,88.195,87.473,91.446],[91.446,93.5,96.412,99.387],[99.387,104.975,112.217,118.502]],
  }, {
    d: 'M317 340 C313.592 334.302 313.969 325.769 312.332 320 C310.428 313.286 309.059 305.101 308.997 298 C308.962 293.611 307.254 290.557 307.032 286 C305 280 303 253 303 230',
    widths: [[118.502,119.732,114.756,112.485],[112.485,109.842,108.789,106.839],[106.839,105.634,103.724,103.409],[103.409,96.5,91.304,91.304]],
  }];
  const issues = auditPen(crossing);
  expect(issues.map(issue => issue.kind)).toContain('width-bulge');
  expect(issues.map(issue => issue.kind)).toContain('tangent-break');
});

test('smooth loops, monotonic pressure and terminal taper do not imply a knot', () => {
  expect(auditPen([smooth])).toEqual([]);
  expect(auditPen([{ d: 'M0 0 C100 0 200 0 300 0', widths: [[20,20,35,40]] }])).toEqual([]);
  expect(auditPen([{ d: 'M0 0 C100 0 200 0 300 0', widths: [[40,35,20,20]] }])).toEqual([]);
});

test('a direction break and a pressure step are independent diagnostics', () => {
  const corner = auditPen([{ d: 'M0 0 L100 0 L100 100', width: 20 }]);
  expect(corner.map(issue => issue.kind)).toEqual(['tangent-break']);
  expect(corner[0].value).toBeCloseTo(90);
  const step = auditPen([{ d: 'M0 0 L100 0', width: 20 }, { d: 'M100 0 L200 0', width: 40 }]);
  expect(step.map(issue => issue.kind)).toEqual(['width-step']);
  expect(step[0].value).toBe(2);
});

test('a real pen lift or retrace is not mistaken for a cursive handoff', () => {
  expect(auditPen([{ d: 'M0 0 L100 0', width: 20 }, { d: 'M300 0 L300 100', width: 20 }])).toEqual([]);
  expect(auditPen([{ d: 'M0 0 L100 0', width: 20 }, { d: 'M100 0 L0 0', width: 20, retrace: true }])).toEqual([]);
});

test('diagnostic thresholds use width ratios and angles rather than glyph coordinates', () => {
  const enlarged: PenStroke = { ...bulge, d: transformPath(bulge.d, [4,0,0,4,50,90]),
    widths: bulge.widths!.map(w => w.map(v => v * 4) as [number,number,number,number]) };
  const original = auditPen([bulge]), scaled = auditPen([enlarged]);
  expect(scaled.map(issue => issue.kind)).toEqual(original.map(issue => issue.kind));
  expect(scaled[0].value).toBeCloseTo(original[0].value, 2);
});

test('the frame oracle rejects an early mark outside the traveled pen footprint', () => {
  const bounds = [-20,-20,320,120] as const, scale = .5;
  const pen = preparePen({ d: 'M0 0 L100 0', width: 20 });
  const blank = raster('', bounds, scale), valid = `<path d="${penGeometry(pen, 50)}"/>`;
  expect(measureInkTravel(blank, raster(valid, bounds, scale), bounds, scale, [pen], 0, 50).fraction).toBe(0);
  const foreign = raster(valid + '<circle cx="250" cy="80" r="15"/>', bounds, scale);
  expect(measureInkTravel(blank, foreign, bounds, scale, [pen], 0, 50).fraction).toBeGreaterThan(.2);
  expect(inkTravelPasses(measureInkTravel(blank, foreign, bounds, scale, [pen], 0, 50))).toBe(false);
});

test('tiny antialias changes do not hide a visible foreign pixel', () => {
  const bounds = [0,0,10,10] as const, previous = new Uint8Array(400), current = new Uint8Array(400);
  current[3] = 5;
  expect(inkTravelPasses(measureInkTravel(previous, current, bounds, 1, [], 0, 1))).toBe(true);
  current[3] = 255;
  expect(inkTravelPasses(measureInkTravel(previous, current, bounds, 1, [], 0, 1))).toBe(false);
});

test('my-style nearly zero nib tips are flagged without forbidding a modest taper', () => {
  // Measured my tips fall to a 2.423-unit diameter beside an 83.608-unit
  // stem. This can fit a flat font edge while losing a rounded pen ending.
  const sharp: PenStroke = { d: 'M0 0 C30 0 60 0 90 0', widths: [[83.608,83.608,40.586,2.423]] };
  expect(auditPen([sharp]).map(issue => issue.kind)).toContain('nib-collapse');
  expect(auditPen([{ ...sharp, widths: [[83.608,83.608,70,60]] }])).toEqual([]);
});

test('a cut-off round cap is detected separately from pressure and direction', () => {
  const bounds = [-20,-20,20,20] as const, point = { x: 0, y: 0, radius: 10, distance: 0 };
  expect(missingNibInterior(raster('<circle r="10"/>', bounds, 2), bounds, 2, point)).toBe(0);
  expect(missingNibInterior(raster('<rect x="-10" y="-10" width="20" height="10"/>', bounds, 2), bounds, 2, point)).toBeGreaterThan(.45);
  expect(missingNibInterior(raster('<ellipse rx="10" ry="5"/>', bounds, 2), bounds, 2, point, [1,.5])).toBe(0);
});

// These shapes have been visually reviewed as smooth writing runs.
// Expand this set after reviewing an audit candidate, rather than blessing
// every existing sharp corner/pressure change with a snapshot baseline.
for (const name of [
  'h.init', 'e', 'l.medi.cv01',
  'm', 'm.fina', 'm.fina.cv01', 'm.fina.cv02', 'm.fina.cv03', 'm.init', 'm.isol', 'm.medi.cv01', 'm.medi.cv02', 'm.medi.cv03',
  'y', 'y.fina', 'y.fina.cv01', 'y.init',
  'n.init', 'n.fina.cv02', 'a', 'e.fina', 'i.init', 'i.medi.cv03', 'j.init', 's.fina', 'w', 'o.medi.cv02',
]) test(`approved smooth glyph has no pressure/flow candidates: ${name}`, () => {
  const id = catalog.glyphs.findIndex(glyph => glyph.name === name);
  expect(id).toBeGreaterThanOrEqual(0);
  const strokes = createGlyphResolver(catalog)(id).strokes;
  // Keep the accepted pen recipes compact instead of fitting dozens of tiny
  // curves to the source pixels. Ink overlap has its own 95% acceptance gate.
  const painted = strokes.filter(stroke => !stroke.retrace);
  const curves = painted.reduce((sum, stroke) => sum + (stroke.d.match(/[LC]/g)?.length ?? 0), 0);
  expect(curves, `over-fragmented pen path: ${name}`).toBeLessThanOrEqual(12);
  // Shared tangents allow at most rounding error, and pressure may vary
  // gently without inflating a small knot around a crossing.
  expect(auditPen(routeWord([strokes]), { turnDegrees: 1, bulgeRatio: 1.15 })).toEqual([]);
});

test('audit all supported contextual forms with reproducible issue positions (advisory)', () => {
  const resolve = createGlyphResolver(catalog);
  const rows = [...supportedGlyphWitnesses()].map(([id, text]) => {
    const strokes = routeWord([resolve(id).strokes, resolve(id).marks].filter(group => group.length));
    return { id, glyph: catalog.glyphs[id].name, text, strokes, issues: auditPen(strokes) };
  });
  expect(rows.length).toBeGreaterThanOrEqual(401);
  for (const row of rows) for (const issue of row.issues) {
    expect(Number.isFinite(issue.value), row.glyph).toBe(true);
    expect(issue.point.every(Number.isFinite), row.glyph).toBe(true);
    expect(issue.distance, row.glyph).toBeGreaterThanOrEqual(0);
    expect(issue.distance, row.glyph).toBeLessThanOrEqual(preparePen(row.strokes[issue.stroke]).length + .2);
  }
  if (process.env.BOREL_PEN_AUDIT === '1') {
    const candidates = rows.filter(row => row.issues.length);
    const count = (kind: PenIssue['kind']) => rows.flatMap(row => row.issues).filter(issue => issue.kind === kind).length;
    console.info(JSON.stringify({ auditedGlyphs: rows.length, candidateGlyphs: candidates.length,
      counts: { bulges: count('width-bulge'), pressureSteps: count('width-step'), turns: count('tangent-break'), collapsedNibs: count('nib-collapse') },
      candidates: candidates.map(({ strokes: _strokes, ...row }) => row),
      my: auditPen(composeText('my', shaper, catalog).strokes) }));
  }
});

// Isolated and connected lowercase contexts. Every actual 60 fps state is
// checked, not just a few favorable screenshots or the finished glyph.
const lowercase = 'abcdefghijklmnopqrstuvwxyz';
for (const text of [...lowercase, ...[...lowercase].map(letter => `a${letter}a`), 'my']) test(`new ink follows only this frame's pen travel: ${text}`, () => {
  const lettering = composeText(text, shaper, catalog), pens = lettering.strokes.map(preparePen);
  const total = pens.reduce((sum, pen) => sum + pen.length, 0), scale = .08;
  const frames = Math.round(Math.max(4, Math.min(60, Math.round(total / 1750 * 2) / 2)) * 60);
  let previous = raster('', lettering.bounds, scale);
  for (let frame = 1; frame <= frames; frame++) {
    let remaining = total * frame / frames;
    const body = pens.map(pen => {
      const d = penGeometry(pen, Math.max(0, Math.min(pen.length, remaining))); remaining -= pen.length;
      return `<path d="${d}"/>`;
    }).join('');
    const current = raster(body, lettering.bounds, scale);
    const result = measureInkTravel(previous, current, lettering.bounds, scale, pens, total * (frame - 1) / frames, total * frame / frames);
    expect(inkTravelPasses(result), `new ink outside pen travel at frame ${frame}/${frames}: ${JSON.stringify(result)}`).toBe(true);
    previous = current;
  }
}, 120_000);
