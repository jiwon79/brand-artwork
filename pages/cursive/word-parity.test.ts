import { expect, test } from 'vitest';
import { textForegroundIoU } from './test-font';
import { wordCases, everydayWords, dictionaryWords } from './word-corpus';

const groups = [...new Set(wordCases.map(sample => sample.group))];

test('word fixtures contain broad vocabulary and are unique within each group', () => {
  expect(everydayWords.length).toBeGreaterThan(900);
  expect(dictionaryWords).toHaveLength(1300);
  for (const letter of 'abcdefghijklmnopqrstuvwxyz') expect(dictionaryWords.filter(word => word[0] === letter)).toHaveLength(50);
  for (const group of groups) {
    const texts = wordCases.filter(sample => sample.group === group).map(sample => sample.text);
    expect(new Set(texts).size, group).toBe(texts.length);
    for (const text of texts) expect(text.trim().length, group).toBeGreaterThan(0);
  }
});

for (const group of groups) test(`complete words retain 95% source ink: ${group}`, () => {
  for (const { text, maxWidth } of wordCases.filter(sample => sample.group === group)) {
    const overlap = textForegroundIoU(text, maxWidth);
    expect(overlap, `${JSON.stringify(text)}: ${(overlap * 100).toFixed(3)}% foreground IoU`).toBeGreaterThanOrEqual(.95);
  }
}, 60_000);
