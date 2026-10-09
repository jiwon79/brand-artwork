import { expect, test } from 'vitest';
import { composeText } from './lettering';
import { preparePen, type PenPoint } from './pen-geometry';
import { createPenPlayback } from './pen-playback';
import { teachingReference, teachingStrokes } from './teaching-model';
import { catalog, shaper, textForegroundIoU } from './test-font';
import { auditPen, isLocalStemReturn } from './test-pen-quality';

// Independent, coarse waypoints transcribed from the teaching diagrams.
// x/y are fractions of the source glyph's ink box; y increases upward.
// Matching final pixels cannot make a reversed or reordered run pass these.
type Spot = readonly [number, number];
const traces: Record<string, Spot[][]> = {
  A: [[[.5,.96],[.08,.06]], [[.5,.96],[.92,.06]], [[.26,.33],[.75,.33]]],
  B: [[[.1,.95],[.1,.06]], [[.1,.94],[.8,.8],[.12,.5],[.87,.3],[.1,.07]]],
  C: [[[.87,.84],[.1,.5],[.9,.18]]],
  D: [[[.08,.94],[.08,.06]], [[.1,.93],[.9,.5],[.13,.07]]],
  E: [[[.1,.94],[.1,.06],[.91,.06]], [[.1,.94],[.89,.94]], [[.1,.5],[.84,.5]]],
  F: [[[.11,.93],[.11,.06]], [[.1,.94],[.91,.94]], [[.11,.51],[.83,.51]]],
  G: [[[.83,.86],[.1,.5],[.5,.07],[.92,.38]], [[.54,.49],[.92,.48],[.92,.38]]],
  H: [[[.09,.94],[.09,.06]], [[.09,.51],[.91,.51]], [[.91,.94],[.91,.06]]],
  I: [[[.5,.93],[.5,.09]], [[.1,.06],[.9,.06]], [[.1,.94],[.9,.94]]],
  J: [[[.63,.92],[.63,.45],[.49,.08],[.09,.3]], [[.28,.94],[.93,.94]]],
  K: [[[.08,.94],[.08,.06]], [[.35,.54],[.9,.07]], [[.79,.93],[.11,.33]]],
  L: [[[.1,.94],[.1,.06],[.91,.06]]],
  M: [[[.07,.96],[.07,.06]], [[.07,.96],[.5,.21],[.93,.96],[.93,.06]]],
  N: [[[.08,.96],[.08,.06]], [[.08,.96],[.92,.06],[.92,.94]]],
  O: [[[.79,.84],[.47,.93],[.09,.5],[.5,.07],[.9,.5],[.79,.84]]],
  P: [[[.1,.94],[.1,.06]], [[.1,.93],[.7,.9],[.85,.6],[.12,.44]]],
  Q: [[[.79,.86],[.5,.94],[.1,.5],[.5,.2],[.9,.5],[.79,.86]], [[.51,.44],[.86,.06]]],
  R: [[[.1,.94],[.1,.06]], [[.1,.93],[.75,.87],[.85,.62],[.16,.45]], [[.54,.45],[.89,.07]]],
  S: [[[.87,.85],[.37,.92],[.15,.67],[.88,.29],[.4,.07],[.12,.2]]],
  T: [[[.51,.93],[.51,.06]], [[.08,.94],[.94,.94]]],
  U: [[[.08,.94],[.08,.5],[.5,.06],[.92,.5],[.92,.94]]],
  V: [[[.09,.93],[.5,.04],[.91,.93]]],
  W: [[[.06,.94],[.26,.03],[.5,.78],[.75,.03],[.94,.94]]],
  X: [[[.88,.93],[.09,.07]], [[.12,.93],[.91,.06]]],
  Y: [[[.09,.93],[.49,.42]], [[.91,.94],[.53,.44],[.51,.06]]],
  Z: [[[.09,.94],[.91,.94],[.07,.06],[.93,.06]]],
  '0': [[[.54,.94],[.1,.5],[.5,.06],[.9,.5],[.54,.94]]],
  '1': [[[.14,.74],[.86,.92],[.87,.06]]],
  '2': [[[.12,.74],[.5,.93],[.83,.71],[.45,.28],[.1,.09],[.91,.09]]],
  '3': [[[.13,.8],[.5,.93],[.88,.7],[.38,.5],[.9,.3],[.5,.06],[.12,.15]]],
  '4': [[[.45,.94],[.1,.35],[.93,.32]], [[.7,.59],[.7,.06]]],
  '5': [[[.3,.94],[.85,.94]], [[.3,.94],[.23,.57],[.8,.45],[.65,.08],[.09,.16]]],
  '6': [[[.83,.84],[.5,.94],[.1,.5],[.3,.08],[.85,.17],[.91,.35],[.58,.54],[.15,.41]]],
  '7': [[[.08,.93],[.9,.93],[.43,.07]]],
  '8': [[[.5,.94],[.17,.77],[.5,.52],[.9,.27],[.5,.06],[.1,.27],[.5,.52],[.84,.77],[.5,.94]]],
  '9': [[[.87,.67],[.47,.94],[.1,.68],[.45,.45],[.87,.67],[.9,.3],[.5,.06],[.15,.17]]],
};
const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const separation = (a: Spot, b: Spot) => Math.hypot(a[0]-b[0], a[1]-b[1]);
const area = (points: PenPoint[]) => points.reduce((sum,a,i) => {
  const b = points[(i+1)%points.length]; return sum+a.x*b.y-b.x*a.y;
},0)/2;

for (const character of letters) test(`French teaching movements and source shape: ${character}`, () => {
  const id = shaper.shape(character)[0].id, strokes = catalog.penPaths![id];
  expect(strokes).toHaveLength(traces[character].length);
  expect(teachingStrokes[character]).toHaveLength(strokes.length);
  const [x0,y0,x1,y1] = catalog.glyphs[id].bounds!;
  const normalize = (p: PenPoint): Spot => [(p.x-x0)/(x1-x0),(p.y-y0)/(y1-y0)];
  for (const [index, stroke] of strokes.entries()) {
    expect(stroke.ordered && !stroke.retrace && !stroke.mark).toBe(true);
    const pen = preparePen(stroke), points = pen.points.map(normalize), expected = traces[character][index];
    expect(separation(points[0],expected[0]), `stroke ${index+1} start`).toBeLessThan(.16);
    expect(separation(points[points.length-1],expected[expected.length-1]), `stroke ${index+1} finish`).toBeLessThan(.16);
    let cursor = 0;
    for (const spot of expected) {
      const next = points.findIndex((p,i) => i>=cursor && separation(p,spot)<.17);
      expect(next, `stroke ${index+1} must visit ${spot} after point ${cursor}`).toBeGreaterThanOrEqual(cursor);
      cursor = next;
    }
    expect(pen.length).toBeGreaterThan(100);
    expect(Math.min(...pen.points.map(p=>p.radius))).toBeGreaterThan(38);
    expect(Math.max(...pen.points.map(p=>p.radius))).toBeLessThan(51);
  }
  expect(strokes.reduce((n,s)=>n+s.widths!.length,0)).toBeLessThanOrEqual(12);
  expect(textForegroundIoU(character)).toBeGreaterThanOrEqual(.95);
  // Actual composed playback, not only the stored source paths, retains order.
  const composed = composeText(character,shaper,catalog).strokes;
  expect(composed).toHaveLength(strokes.length);
  const playback = createPenPlayback(composed.map(preparePen));
  for (let i=1;i<playback.strokes.length;i++) expect(playback.strokes[i].start-playback.strokes[i-1].end).toBeGreaterThanOrEqual(.1);
});

test('rounded capitals and 0 turn left; 6 and 8 follow continuous loops', () => {
  for (const character of 'COQ0') {
    const pen = preparePen(catalog.penPaths![shaper.shape(character)[0].id][0]);
    expect(area(pen.points), character).toBeGreaterThan(100_000);
  }
  const six=preparePen(catalog.penPaths![shaper.shape('6')[0].id][0]);
  expect(area(six.points.filter(p=>p.y<390))).toBeGreaterThan(40_000);
  const eight=preparePen(catalog.penPaths![shaper.shape('8')[0].id][0]);
  expect(area(eight.points.filter(p=>p.y>375))).toBeGreaterThan(40_000);
  expect(area(eight.points.filter(p=>p.y<375))).toBeLessThan(-50_000);
});

test('digit paths have no width steps, spikes, tiny patches or accidental tangent breaks', () => {
  for (const character of '0123456789') {
    const strokes=catalog.penPaths![shaper.shape(character)[0].id];
    for (const issue of auditPen(strokes,{turnDegrees:2})) {
      expect(issue.kind,`${character} at ${issue.distance}`).toBe('tangent-break');
      // Only the 1 apex, 2 baseline corner, 3 middle return, 5 shoulder
      // and 9 loop-to-descender reversal are intentional turns.
      const p=issue.point;
      const intended=character==='1'&&p[1]>630 || character==='2'&&p[1]<90
        || character==='3'&&p[0]<250&&p[1]>330&&p[1]<380
        || character==='5'&&p[0]<180&&p[1]>370&&p[1]<440
        || character==='9'&&isLocalStemReturn(strokes[issue.stroke],issue);
      expect(intended,`${character}: ${JSON.stringify(issue)}`).toBe(true);
    }
  }
});

test('inspection links use roman-capital and digit references and disclose Borel shape adaptations', () => {
  expect(Object.keys(teachingStrokes).sort()).toEqual([...letters].sort());
  for(const letter of letters) {
    const reference=teachingReference(letter);
    expect(reference.href).toContain('eduscol.education.');
    expect(reference.href).toContain(letter==='A'?'#page=5':'#page=21');
    expect(reference.text).toContain('1.');
  }
  expect(teachingReference('7').note).toContain('추가하지 않습니다');
  expect(teachingReference('x').note).toContain('다릅니다');
});
