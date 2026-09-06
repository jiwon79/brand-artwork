import { expect, test } from 'vitest';
import { revealPalette, themeForInteraction } from './palette.ts';

test('keep the original red pair and include each approved additional color', () => {
  expect(revealPalette.map(theme => theme.panelColor)).toStrictEqual([
    '#c61f3f', '#d6df45', '#3555cc', '#aa94c7', '#88b5a0',
  ]);
  expect(themeForInteraction(0)).toStrictEqual({ panelColor: '#c61f3f', textColor: '#f4f0df' });
});

test('cycle all five pairs independently of fixed slot content', () => {
  for (let index = 0; index < 40; index++) {
    expect(themeForInteraction(index)).toStrictEqual(revealPalette[index % 5]);
  }
  for (const repeatInterval of [1, 2, 3]) {
    const colors = Array.from({ length: 5 }, (_, cycle) => themeForInteraction(cycle * repeatInterval).panelColor);
    expect(new Set(colors).size).toBe(5);
  }
});

test('pair each background with readable light or dark lettering', () => {
  const luminance = hex => {
    const rgb = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255)
      .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  for (const { panelColor, textColor } of revealPalette) {
    const [dark, light] = [luminance(panelColor), luminance(textColor)].sort((a, b) => a - b);
    expect((light + 0.05) / (dark + 0.05), `low contrast on ${panelColor}`).toBeGreaterThanOrEqual(4.5);
  }
});
