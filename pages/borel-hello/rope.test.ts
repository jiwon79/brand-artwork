import { expect, test } from 'vitest';
import { FloorRope } from './rope';
import { preparePen, penGeometry } from './pen-geometry';
import { composeText } from './lettering';
import { catalog, shaper } from './test-font';

const line = (x: number, y = 0) => preparePen({ d: `M${x} ${y}L${x + 200} ${y}`, width: 30 });
function pull(rope: FloorRope, x: number, y: number, dx: number, dy: number) {
  expect(rope.pick(x, y, 20)).toBe(true);
  for (let frame = 1; frame <= 120; frame++) {
    rope.move(x + dx * frame / 120, y + dy * frame / 120);
    rope.step(1 / 60);
  }
  rope.release();
  for (let frame = 0; frame < 600; frame++) rope.step(1 / 60);
}
for (const text of ['hello', 'jiwon', 'my name is jiwon', 'Hello, world!\n2026', '']) {
  test(`rope starts with the exact authored silhouette and leaves source paths untouched: ${text}`, () => {
    const pens = composeText(text, shaper, catalog).strokes.map(preparePen);
    const before = JSON.stringify(pens), rope = new FloorRope(pens);
    for (let i = 0; i < pens.length; i++) expect(penGeometry(rope.deformed(i))).toBe(penGeometry(pens[i]));
    rope.step(1);
    expect(JSON.stringify(pens)).toBe(before);
    expect(rope.awake).toBe(false);
  });
}
test('drag propagates through a welded join; it settles without returning home or stretching the rope', () => {
  const rope = new FloorRope([line(0), line(200)]);
  pull(rope, 200, 0, 120, 100);
  const a = rope.deformed(0), b = rope.deformed(1);
  expect(a.points[a.points.length - 1].x).toBe(b.points[0].x);
  expect(a.points[a.points.length - 1].y).toBe(b.points[0].y);
  expect(b.points[0].y).toBeGreaterThan(50);
  expect(rope.awake).toBe(false);
  const snapshot = JSON.stringify(rope.nodes);
  for (let i = 0; i < 120; i++) rope.step(1 / 60);
  expect(JSON.stringify(rope.nodes)).toBe(snapshot);
  for (const pen of [a, b]) {
    const length = pen.points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - pen.points[i].x, p.y - pen.points[i].y), 0);
    expect(length).toBeCloseTo(200, 0);
  }
});
test('spaces, separate dots and crossing interiors are loose pieces, not invisible knots', () => {
  const pens = [line(0), line(400), preparePen({ d: 'M100 -100L100 100', width: 30 }), preparePen({ d: 'M700 100L700 101', width: 30 })];
  const rope = new FloorRope(pens);
  pull(rope, 0, 0, -100, 100);
  for (const index of [1, 2, 3]) expect(penGeometry(rope.deformed(index))).toBe(penGeometry(pens[index]));
});
test('fixed substeps produce the same drag result at 30 and 120Hz and survive stalled frames', () => {
  const a = new FloorRope([line(0)]), b = new FloorRope([line(0)]);
  for (const rope of [a, b]) { rope.pick(0, 0, 20); rope.move(100, 100); }
  for (let i = 0; i < 30; i++) a.step(1 / 30);
  for (let i = 0; i < 120; i++) b.step(1 / 120);
  expect(a.nodes).toEqual(b.nodes);
  a.step(1000); a.release(); a.step(1 / 60);
  expect(a.nodes.every(n => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true);
  expect(new FloorRope([]).pick(0, 0, 100)).toBe(false);
});

test('a stroke endpoint contacting another stroke interior stays attached under a pull', () => {
  const a = preparePen({ d: 'M0 0L200 0', width: 30 });
  const b = preparePen({ d: 'M110 0L110 200', width: 30 });
  const rope = new FloorRope([a, b]);
  pull(rope, 110, 200, 70, 80);
  const body = rope.deformed(0), branch = rope.deformed(1);
  const distance = Math.min(...body.points.map(p => Math.hypot(p.x - branch.points[0].x, p.y - branch.points[0].y)));
  expect(distance).toBeLessThan(15);
  expect(body.points.some(p => Math.abs(p.y) > 10)).toBe(true);
});
