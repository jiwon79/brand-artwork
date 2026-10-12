import { expect, test } from 'vitest';
import { preparePen } from './pen-geometry';
import { routeWord } from './pen-routing';

test('a short offset between aligned curves is absorbed without a tiny S-shaped bridge or mutating the recipes', () => {
  const a = { d: 'M0 100 C20 80 40 60 100 20', widths: [[90, 90, 90, 90] as [number, number, number, number]], ordered: true };
  const b = { d: 'M125 18 C170 -12 200 -50 200 -100', widths: [[92, 92, 92, 92] as [number, number, number, number]], ordered: true };
  const before = JSON.stringify([a, b]), result = routeWord([[a], [b]]);
  expect(result).toHaveLength(2);
  const left = preparePen(result[0]), right = preparePen(result[1]);
  expect(left.points[left.points.length - 1]).toMatchObject({ x: right.points[0].x, y: right.points[0].y, radius: right.points[0].radius });
  expect(result[0].d.match(/C/g)).toHaveLength(2);
  expect(result[1]).toEqual(b);
  expect(JSON.stringify([a, b])).toBe(before);
});
