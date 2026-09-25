import { expect, test } from 'vitest';
import { colorwayIndex, colorways } from './colorways';

test('Rose stays the default and photo colorways have stable shader indices', () => {
  expect(colorways.map(colorway => colorway.id)).toEqual(['rose', 'yellow', 'green', 'blue', 'black']);
  expect(colorwayIndex(null)).toBe(0);
  expect(colorwayIndex('unknown')).toBe(0);
  expect(colorwayIndex('blue')).toBe(3);
});
