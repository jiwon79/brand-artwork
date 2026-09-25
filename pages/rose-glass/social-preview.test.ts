import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const pageUrl = 'https://studio.jiiwon.com/rose-glass/';
const meta = (name: string) => {
  const tags = [...html.matchAll(/<meta\s[^>]*>/g)]
    .map(([tag]) => Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)]
      .map(([, key, value]) => [key, value])))
    .filter(tag => (tag.property ?? tag.name) === name);
  expect(tags, `one static ${name} tag`).toHaveLength(1);
  return tags[0].content;
};

test('social crawlers can read the Rose Glass card without JavaScript', () => {
  expect(html).toContain(`<link rel="canonical" href="${pageUrl}"`);
  expect(meta('og:type')).toBe('website');
  expect(meta('og:url')).toBe(pageUrl);
  expect(meta('og:title')).toBe('Rose Glass');
  expect(meta('twitter:title')).toBe(meta('og:title'));
  expect(meta('twitter:card')).toBe('summary_large_image');
  expect(meta('og:image')).toBe(`${pageUrl}assets/og-image.png`);
  expect(meta('twitter:image')).toBe(meta('og:image'));
});

test('share descriptions and accessible image text remain consistent', () => {
  expect(meta('description')).toContain('Rose Glass');
  expect(meta('og:description')).toBe(meta('description'));
  expect(meta('twitter:description')).toBe(meta('description'));
  expect(meta('og:image:alt')).toContain('Rose Glass');
  expect(meta('og:image:alt')).toContain('왼쪽 위');
  expect(meta('twitter:image:alt')).toBe(meta('og:image:alt'));
});

test('the bundled PNG matches the declared 1200 by 630 card dimensions', () => {
  const image = readFileSync(new URL('./assets/og-image.png', import.meta.url));
  expect(image.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(image.readUInt32BE(8)).toBe(13);
  expect(image.subarray(12, 16).toString('ascii')).toBe('IHDR');
  expect(image.subarray(-12).toString('hex')).toBe('0000000049454e44ae426082');
  expect(image.length).toBeLessThan(5_000_000);
  expect(meta('og:image:type')).toBe('image/png');
  const dimensions = [image.readUInt32BE(16), image.readUInt32BE(20)];
  expect(dimensions).toEqual([1200, 630]);
  expect([Number(meta('og:image:width')), Number(meta('og:image:height'))]).toEqual(dimensions);
});
