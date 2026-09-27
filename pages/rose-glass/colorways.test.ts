import { expect, test } from 'vitest';
import { colorwayIndex, colorways } from './colorways';

test('Rose stays the default and all colorways have stable shader indices', () => {
  expect(colorways.map(colorway => colorway.id)).toEqual([
    'rose', 'yellow', 'green', 'blue', 'black',
    'orange', 'lilac', 'teal', 'plum', 'navy',
  ]);
  expect(colorwayIndex(null)).toBe(0);
  expect(colorwayIndex('unknown')).toBe(0);
  expect(colorwayIndex('blue')).toBe(3);
  expect(colorwayIndex('navy')).toBe(9);
});
