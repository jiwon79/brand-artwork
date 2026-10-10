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
    // Cubic reconstruction rounds the discrete links; its arc length stays within 1%.
    expect(Math.abs(length / 200 - 1)).toBeLessThan(.01);
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

test('a taut rope reconstructed from an old curve has no repeated residual bumps', () => {
  const pen = preparePen({ d: 'M0 0C80 -160 160 160 240 0C320 -160 400 160 480 0', width: 30 });
  const rope = new FloorRope([pen]);
  // Independent adversarial tension pose: material samples now lie on one
  // horizontal line. Old, rotated per-link arcs must not reappear between them.
  for (const node of rope.nodes) { node.x *= 1.5; node.y = 0; }
  const curve = rope.deformed(0);
  const deviation = Math.max(...curve.points.map(p => Math.abs(p.y)));
  expect(deviation).toBeLessThan(.6);
});

test('adjoining curved intervals have no angular steps at physical particle boundaries', () => {
  const rope = new FloorRope([preparePen({ d: 'M0 0L400 0', width: 30 })]);
  for (const node of rope.nodes) node.y = 70 * Math.sin(node.x / 160);
  const curve = rope.deformed(0);
  let worst = 0;
  for (const node of rope.nodes.slice(1, -1)) {
    const i = curve.points.findIndex(p => p.distance >= node.x);
    const a = curve.points[i - 1], b = curve.points[i], c = curve.points[i + 1];
    const turn = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x);
    worst = Math.max(worst, Math.abs(turn));
  }
  // At four-unit sampling, this smooth sine's genuine curvature is <.012 rad.
  // A separate line for each physical interval produces ~.05-radian steps.
  expect(worst).toBeLessThan(.015);
});

test('straightened ink width does not retain a row of old brush-pressure bumps', () => {
  const pen = preparePen({ d: 'M0 0L400 0', width: 30 });
  for (const p of pen.points) p.radius = 20 + 6 * Math.sin(p.distance / 8);
  const rope = new FloorRope([pen]);
  for (const node of rope.nodes) node.x *= 1.5;
  const points = rope.deformed(0).points.filter(p => p.distance > 100 && p.distance < 300);
  expect(Math.max(...points.map(p => p.radius)) - Math.min(...points.map(p => p.radius))).toBeLessThan(.7);
});

test('splitting a continuous rope into authored strokes creates neither a hinge nor a tangent seam', () => {
  const whole = new FloorRope([preparePen({ d: 'M0 0L400 0', width: 30 })]);
  const split = new FloorRope([line(0), line(200)]);
  for (const rope of [whole, split]) pull(rope, 200, 0, 120, 100);
  expect(split.nodes).toEqual(whole.nodes);
  const a = split.deformed(0).points, b = split.deformed(1).points;
  const left = Math.atan2(a[a.length - 1].y - a[a.length - 2].y, a[a.length - 1].x - a[a.length - 2].x);
  const right = Math.atan2(b[1].y - b[0].y, b[1].x - b[0].x);
  // Includes real curve turning over two four-unit intervals, not just C0.
  expect(Math.abs(right - left)).toBeLessThan(.05);
});

for (const text of ['hello', 'jiwon', 'my name is jiwon', 'we move with the wind']) {
  test(`fast directional drags keep dense smooth curves finite and widths bounded: ${text}`, () => {
    const pens = composeText(text, shaper, catalog).strokes.map(preparePen), rope = new FloorRope(pens);
    const pen = pens.find(p => !p.retrace && p.length > 500)!;
    const point = pen.points[Math.floor(pen.points.length / 2)];
    expect(rope.pick(point.x, point.y, 35)).toBe(true);
    for (let frame = 0; frame < 36; frame++) {
      if (frame < 18) rope.move(point.x + 800 * Math.sin(frame / 6), point.y - frame * 35);
      if (frame === 18) rope.release();
      rope.step(1 / 30);
      for (const [i, original] of pens.entries()) {
        const curve = rope.deformed(i);
        const minRadius = Math.min(...original.points.map(p => p.radius)), maxRadius = Math.max(...original.points.map(p => p.radius));
        const maxSpan = Math.max(32, ...original.points.slice(1).map((p, j) => Math.hypot(p.x - original.points[j].x, p.y - original.points[j].y)));
        for (let j = 0; j < curve.points.length; j++) {
          const p = curve.points[j];
          expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.radius)).toBe(true);
          expect(p.radius).toBeGreaterThanOrEqual(minRadius - 1e-8);
          expect(p.radius).toBeLessThanOrEqual(maxRadius + 1e-8);
          if (j) expect(Math.hypot(p.x - curve.points[j - 1].x, p.y - curve.points[j - 1].y)).toBeLessThanOrEqual(maxSpan);
        }
      }
    }
  });
}
